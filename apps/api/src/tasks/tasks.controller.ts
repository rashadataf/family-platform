import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Controller,
  Inject,
  Logger,
  NotFoundException,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AppRoute, ServerInferResponses } from '@ts-rest/core';
import { TsRestHandler, tsRestHandler, type TsRestRequestShape } from '@ts-rest/nest';
import { tasksContract } from '@fp/contracts';
import { tasks, type family } from '@fp/core';
import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type Clock,
  type DomainError,
  type IdempotencyPort,
  type JsonValue,
} from '@fp/kernel';
import { formatLocalDate } from '@fp/kernel/recurrence';
import { SkipGlobalRateLimit } from '../common/global-rate-limit.guard.js';
import { hashIdempotentRequest, readIdempotencyKey } from '../common/idempotency.js';
import { PerUserThrottlerGuard } from '../common/per-user-throttler.guard.js';
import { CapabilityGuard, RequiresCapability } from '../family/capability.guard.js';
import {
  FamilyMembershipGuard,
  type RequestWithFamilyContext,
} from '../family/family-membership.guard.js';
import { UsesProblemNamespace } from '../family/problem-namespace.js';
import { SessionGuard } from '../identity/session.guard.js';
import {
  TASKS_CLOCK,
  TASKS_IDEMPOTENCY_STORE,
  TASKS_MEMBER_VISIBILITY,
  TASKS_UNIT_OF_WORK,
} from './tasks.tokens.js';

type RouteHandler<T extends AppRoute> = (
  args: TsRestRequestShape<T>,
) => Promise<ServerInferResponses<T>>;

interface TasksRequest extends RequestWithFamilyContext {
  headers: RequestWithFamilyContext['headers'] & { 'idempotency-key'?: string };
}

const NOT_FOUND = { type: 'task/not_found' } as const;

/** The wire's 422 bodies for a write the domain refused. `NotFound` is thrown, never returned. */
type FieldError =
  | { type: 'task/unknown_time_zone' }
  | { type: 'task/invalid_due'; field: string; reason: string }
  | { type: 'task/recurrence_invalid'; reason: string }
  | { type: 'task/recurrence_unsupported'; part: string }
  | { type: 'task/recurrence_requires_due' }
  | { type: 'task/assignee_invalid' };

/** The wire's 409 bodies. Both mean "your view of this task is out of date". */
type ConflictError =
  | { type: 'task/invalid_transition'; from: 'open' | 'completed' | 'cancelled'; command: string }
  | { type: 'task/version_conflict'; currentVersion: number };

function isTaskStatus(value: string): value is 'open' | 'completed' | 'cancelled' {
  return value === 'open' || value === 'completed' || value === 'cancelled';
}

/**
 * Domain failure → wire response, in one place, so every write route maps the
 * same kind to the same type. A kind no Tasks command produces is a defect, not
 * a response a client should be handed.
 *
 * `NotFound` throws rather than returns: FR-014 makes it the answer to "missing",
 * "another family's" and "assigned to a child you do not guard" alike, and a
 * route that could forget to map it would leak the difference.
 */
function toFieldError(error: DomainError): FieldError {
  switch (error.kind) {
    case 'UnknownTimeZone':
      // The zone the caller sent is not echoed: they have it, and a log line
      // assembled from this body should not carry request input.
      return { type: 'task/unknown_time_zone' };
    case 'InvalidDue':
      return { type: 'task/invalid_due', field: error.field, reason: error.reason };
    case 'RecurrenceInvalid':
      return { type: 'task/recurrence_invalid', reason: error.reason };
    case 'RecurrenceUnsupported':
      return { type: 'task/recurrence_unsupported', part: error.part };
    case 'RecurrenceRequiresDue':
      return { type: 'task/recurrence_requires_due' };
    case 'AssigneeInvalid':
      return { type: 'task/assignee_invalid' };
    case 'NotFound':
      throw new NotFoundException(NOT_FOUND);
    case 'NameRequired':
      // Unreachable through the contract (`title` has `.min(1)` after trim).
      throw new BadRequestException({ type: 'task/invalid_request' });
    default:
      throw new Error(`A Tasks route received an unexpected domain error: ${error.kind}`);
  }
}

function toConflictError(error: DomainError): ConflictError {
  if (error.kind === 'InvalidTransition') {
    if (!isTaskStatus(error.from)) {
      throw new Error(`InvalidTransition carried an unknown status: ${error.from}`);
    }
    return { type: 'task/invalid_transition', from: error.from, command: error.command };
  }
  if (error.kind === 'VersionConflict') {
    return { type: 'task/version_conflict', currentVersion: error.currentVersion };
  }
  if (error.kind === 'NotFound') throw new NotFoundException(NOT_FOUND);
  return toConflictNever(error);
}

function toConflictNever(error: DomainError): never {
  throw new Error(`A Tasks transition route received an unexpected domain error: ${error.kind}`);
}

function isConflict(error: DomainError): boolean {
  return error.kind === 'InvalidTransition' || error.kind === 'VersionConflict';
}

/**
 * Assigning refuses exactly one way (FR-016), so its contract declares exactly
 * one 422. Narrowing here rather than reusing `toFieldError` keeps that promise
 * checked by the compiler: a command that grew a second field failure would
 * fail to build instead of returning a type the contract never declared.
 */
function toAssigneeError(error: DomainError): { type: 'task/assignee_invalid' } {
  if (error.kind === 'AssigneeInvalid') return { type: 'task/assignee_invalid' };
  if (error.kind === 'NotFound') throw new NotFoundException(NOT_FOUND);
  throw new Error(`The assign route received an unexpected domain error: ${error.kind}`);
}

/**
 * Keyset cursors cross the wire opaque. Base64url of the position, not an
 * offset: a client cannot turn it into "how many rows are there", which on a
 * visibility-filtered list would be an inference channel (FR-014).
 */
function encodeCursor(cursor: unknown): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeOpenCursor(value: string | undefined): tasks.OpenCursor | undefined {
  if (value === undefined) return undefined;
  const raw = decodeCursor(value);
  let dueAt: Date | null = null;
  if (raw.dueAt !== null && raw.dueAt !== undefined) {
    if (typeof raw.dueAt !== 'string') throw badCursor();
    dueAt = new Date(raw.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw badCursor();
  }
  if (typeof raw.id !== 'string') throw badCursor();
  return { dueAt, id: asTaskId(raw.id) };
}

function decodeClosedCursor(value: string | undefined): tasks.ClosedCursor | undefined {
  if (value === undefined) return undefined;
  const raw = decodeCursor(value);
  if (typeof raw.closedAt !== 'string' || typeof raw.id !== 'string') throw badCursor();
  const closedAt = new Date(raw.closedAt);
  if (Number.isNaN(closedAt.getTime())) throw badCursor();
  return { closedAt, id: asTaskId(raw.id) };
}

function decodeCursor(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw badCursor();
  }
  if (typeof parsed !== 'object' || parsed === null) throw badCursor();
  return parsed as Record<string, unknown>;
}

function badCursor(): BadRequestException {
  return new BadRequestException({
    type: 'task/invalid_range',
    reason: 'That cursor is not one this endpoint issued.',
  });
}

/** The wire shape of a task. Assignees are only ever here for a reader allowed all of them. */
function toTaskBody(task: tasks.Task, now: Date) {
  const due = task.due;
  const state = task.state;
  return {
    taskId: task.id,
    version: task.version,
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    category: task.category,
    status: task.status,
    due:
      due === null
        ? null
        : due.kind === 'date'
          ? { kind: 'date' as const, date: formatLocalDate(due.date), timeZone: due.timeZone }
          : {
              kind: 'date_time' as const,
              date: formatLocalDate(due.date),
              time: tasks.formatLocalTime(due.time),
              timeZone: due.timeZone,
            },
    dueAt: task.dueAt?.toISOString() ?? null,
    // FR-025: read against the clock on every response, never a stored state,
    // so a task is overdue the moment it is due whether or not a sweep has run.
    isOverdue: task.isOverdue(now),
    recurrenceRule: task.recurrenceRule?.toString() ?? null,
    seriesId: task.seriesId,
    isSeriesHead: task.isSeriesHead,
    predecessorId: task.predecessorId,
    assigneeIds: [...task.assignees],
    createdByMemberId: task.createdByMemberId,
    completedAt: state.status === 'completed' ? state.at.toISOString() : null,
    completedByMemberId: state.status === 'completed' ? state.by : null,
    cancelledAt: state.status === 'cancelled' ? state.at.toISOString() : null,
    cancelledByMemberId: state.status === 'cancelled' ? state.by : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

/**
 * Tasks' HTTP surface (contracts/tasks-api.md). Every route is family-scoped
 * and runs spec 008's guard chain unchanged — session, then standing (`404` for
 * none), then capability (`403`) — before any handler or body validation runs.
 * `@UsesProblemNamespace('task')` makes those guards answer in this contract's
 * types.
 *
 * Handlers hold no rule. FR-014's guardian filter, FR-015's audit, the lifecycle
 * and the successor all live in `packages/core/tasks`, so a second consumer of
 * the same commands cannot apply a laxer version.
 *
 * Every route carries `PerUserThrottlerGuard`, including the ones that take the
 * DEFAULT limit rather than an explicit `@Throttle` — contracts/tasks-api.md's
 * rate-limiting table says "everything else: default per-USER limit", and
 * without the guard those routes fall back to the global per-SOURCE bucket.
 * That is wrong twice over: a household behind one NAT would throttle its own
 * members, and the integration tier (every request from 127.0.0.1) starts
 * failing in ways that look like unrelated flakiness.
 *
 * `@SkipGlobalRateLimit()` on the class, not just the guard on each route:
 * `GlobalRateLimitGuard` runs as `APP_GUARD` regardless of what a route's own
 * `@UseGuards` lists, so `PerUserThrottlerGuard` alone does not stop it —
 * both would enforce the *same* `@Throttle()` limit, one per user and one per
 * source IP, and the household-behind-one-NAT failure above happens anyway
 * (quickstart Scenario 7 caught this: a fresh user's very first request was
 * rejected because another family member's earlier calls, from the same IP,
 * had already spent the shared bucket).
 *
 * Log lines carry identifiers, counts and durations — never a title or notes
 * (Principle VI, SC-011).
 */
@Controller()
@UsesProblemNamespace('task')
@SkipGlobalRateLimit()
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    @Inject(TASKS_CLOCK) private readonly clock: Clock,
    @Inject(TASKS_UNIT_OF_WORK) private readonly unitOfWork: tasks.TasksUnitOfWorkPort,
    @Inject(TASKS_MEMBER_VISIBILITY) private readonly visibility: family.MemberVisibilityPort,
    @Inject(TASKS_IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyPort,
  ) {}

  /**
   * `tasks_transition_conflict_total{type}` (contracts/tasks-api.md) — a spike
   * in `version_conflict` means a client is not refetching after a 409.
   * Emitted from one place so no 409 route can forget it.
   */
  private conflict(error: DomainError, correlationId: string) {
    const body = toConflictError(error);
    const type = body.type === 'task/version_conflict' ? 'version_conflict' : 'invalid_transition';
    this.logger.log(
      `tasks_transition_conflict_total type=${type} value=1 [correlationId=${correlationId}]`,
    );
    return { status: 409 as const, body };
  }

  /** `tasks_successor_spawned_total{trigger}` — a gap against head closures is a broken series. */
  private successorSpawned(
    successor: tasks.Task | null,
    trigger: 'complete' | 'cancel_instance',
    correlationId: string,
  ): void {
    if (successor === null) return;
    this.logger.log(
      `tasks_successor_spawned_total trigger=${trigger} value=1 taskId=${successor.id} [correlationId=${correlationId}]`,
    );
  }

  private reader(req: TasksRequest, familyId: string): tasks.Reader {
    if (!req.familyContext) {
      throw new Error('FamilyMembershipGuard did not populate familyContext.');
    }
    return {
      familyId: asFamilyId(familyId),
      memberId: req.familyContext.memberId,
      userId: req.identityContext?.userId ?? null,
      correlationId: req.correlationId ?? randomUUID(),
    };
  }

  /**
   * ADR-006, Principle IX. Scoped by family and route as well as by caller, and
   * only a success is stored — a refusal wrote nothing, so a fresh validation
   * replays it for free.
   */
  private async idempotent<R extends { status: number; body: unknown }>(
    req: TasksRequest,
    routeName: string,
    familyId: string,
    requestShape: unknown,
    handle: () => Promise<R>,
  ): Promise<R> {
    const userId = req.identityContext?.userId;
    const key = readIdempotencyKey(req.headers);
    if (userId === undefined || key === null) return handle();

    const scopedKey = `${familyId}:${routeName}:${key}`;
    const requestHash = hashIdempotentRequest(routeName, requestShape);
    const existing = await this.idempotencyStore.findByKey(userId, scopedKey);
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        this.logger.warn(`Idempotency-Key reused with a different request on ${routeName}`);
      }
      return { status: existing.responseStatus, body: existing.responseBody } as R;
    }

    const response = await handle();
    if (response.status >= 200 && response.status < 300) {
      await this.idempotencyStore.save({
        userId,
        key: scopedKey,
        requestHash,
        responseStatus: response.status,
        responseBody: response.body as JsonValue,
      });
    }
    return response;
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @RequiresCapability('tasks:read')
  @TsRestHandler(tasksContract.listOpenTasks)
  listOpenTasks(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.listOpenTasks> {
    return tsRestHandler(tasksContract.listOpenTasks, async ({ params, query }) => {
      const reader = this.reader(req, params.familyId);
      const now = this.clock.now();
      const startedAt = performance.now();

      const result = await tasks.listOpenTasks(
        {
          ...reader,
          assignee: query.assignee === undefined ? undefined : asFamilyMemberId(query.assignee),
          overdueAt: query.overdue === 'true' ? now : undefined,
          dueFrom: query.dueFrom === undefined ? undefined : new Date(query.dueFrom),
          dueTo: query.dueTo === undefined ? undefined : new Date(query.dueTo),
          after: decodeOpenCursor(query.cursor),
          limit: query.limit,
        },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );

      // `tasks_list_duration` — research.md §11's p95 budget of 150 ms.
      this.logger.log(
        `tasks_list_duration_ms=${(performance.now() - startedAt).toFixed(1)} list=open [correlationId=${reader.correlationId}]`,
      );

      if (!result.ok) return this.listError(result.error);
      return {
        status: 200 as const,
        body: {
          items: result.value.items.map((task) => toTaskBody(task, now)),
          nextCursor: result.value.next === null ? null : encodeCursor(result.value.next),
        },
      };
    });
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @RequiresCapability('tasks:read')
  @TsRestHandler(tasksContract.listTaskHistory)
  listTaskHistory(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.listTaskHistory> {
    return tsRestHandler(tasksContract.listTaskHistory, async ({ params, query }) => {
      const reader = this.reader(req, params.familyId);
      const now = this.clock.now();
      const startedAt = performance.now();

      const result = await tasks.listTaskHistory(
        {
          ...reader,
          from: new Date(query.from),
          to: new Date(query.to),
          after: decodeClosedCursor(query.cursor),
          limit: query.limit,
        },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );

      this.logger.log(
        `tasks_list_duration_ms=${(performance.now() - startedAt).toFixed(1)} list=history [correlationId=${reader.correlationId}]`,
      );

      if (!result.ok) return this.listError(result.error);
      return {
        status: 200 as const,
        body: {
          items: result.value.items.map((task) => toTaskBody(task, now)),
          nextCursor: result.value.next === null ? null : encodeCursor(result.value.next),
        },
      };
    });
  }

  /** Both lists refuse the same two ways; neither ever answers `NotFound`. */
  private listError(error: DomainError) {
    if (error.kind === 'RangeTooWide') {
      return {
        status: 422 as const,
        body: { type: 'task/range_too_wide' as const, maxDays: error.maxDays },
      };
    }
    if (error.kind === 'InvalidTimeRange') {
      return {
        status: 422 as const,
        body: { type: 'task/invalid_range' as const, reason: error.reason },
      };
    }
    throw new NotFoundException(NOT_FOUND);
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.createTask)
  createTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.createTask> {
    return tsRestHandler(tasksContract.createTask, async ({ params, body }) =>
      this.idempotent(req, 'createTask', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);

        let due: tasks.Due | undefined;
        if (body.due !== undefined) {
          const parsed = tasks.parseDue(body.due);
          if (!parsed.ok) return { status: 422 as const, body: toFieldError(parsed.error) };
          due = parsed.value;
        }

        const result = await tasks.createTask(
          {
            familyId: reader.familyId,
            taskId: asTaskId(randomUUID()),
            newSeriesId: asTaskSeriesId(randomUUID()),
            createdByMemberId: reader.memberId,
            title: body.title,
            notes: body.notes,
            priority: body.priority,
            category: body.category,
            due,
            recurrenceRule: body.recurrenceRule,
            assigneeIds: body.assigneeIds?.map(asFamilyMemberId),
            correlationId: reader.correlationId,
          },
          { unitOfWork: this.unitOfWork, clock: this.clock },
        );

        if (!result.ok) {
          this.logger.log(
            `Task creation rejected: ${result.error.kind} [correlationId=${reader.correlationId}]`,
          );
          return { status: 422 as const, body: toFieldError(result.error) };
        }

        this.logger.log(`Created task ${result.value.id} [correlationId=${reader.correlationId}]`);
        return { status: 201 as const, body: toTaskBody(result.value, this.clock.now()) };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:read')
  @TsRestHandler(tasksContract.getTask)
  getTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.getTask> {
    return tsRestHandler(tasksContract.getTask, async ({ params }) => {
      const reader = this.reader(req, params.familyId);
      const result = await tasks.getTask(
        { ...reader, taskId: asTaskId(params.taskId) },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );
      // FR-014: missing, another family's, and assigned to a child the caller
      // does not guard are one answer. The audit log has the difference.
      if (!result.ok) throw new NotFoundException(NOT_FOUND);
      return { status: 200 as const, body: toTaskBody(result.value, this.clock.now()) };
    });
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.updateTask)
  updateTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.updateTask> {
    return tsRestHandler(tasksContract.updateTask, async ({ params, body }) =>
      this.idempotent(req, 'updateTask', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);

        let due: tasks.Due | null | undefined;
        if (body.due !== undefined) {
          if (body.due === null) {
            due = null;
          } else {
            const parsed = tasks.parseDue(body.due);
            if (!parsed.ok) return { status: 422 as const, body: toFieldError(parsed.error) };
            due = parsed.value;
          }
        }

        const result = await tasks.updateTask(
          {
            ...reader,
            taskId: asTaskId(params.taskId),
            expectedVersion: body.expectedVersion,
            newSeriesId: asTaskSeriesId(randomUUID()),
            patch: {
              title: body.title,
              notes: body.notes,
              priority: body.priority,
              category: body.category,
              due,
              recurrenceRule: body.recurrenceRule,
            },
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );

        if (!result.ok) {
          if (isConflict(result.error)) return this.conflict(result.error, reader.correlationId);
          return { status: 422 as const, body: toFieldError(result.error) };
        }
        return { status: 200 as const, body: toTaskBody(result.value, this.clock.now()) };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.completeTask)
  completeTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.completeTask> {
    return tsRestHandler(tasksContract.completeTask, async ({ params, body }) =>
      this.idempotent(req, 'completeTask', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await tasks.completeTask(
          {
            ...reader,
            taskId: asTaskId(params.taskId),
            expectedVersion: body.expectedVersion,
            successorId: asTaskId(randomUUID()),
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );

        if (!result.ok) return this.conflict(result.error, reader.correlationId);

        const now = this.clock.now();
        this.successorSpawned(result.value.successor, 'complete', reader.correlationId);
        return {
          status: 200 as const,
          body: {
            task: toTaskBody(result.value.task, now),
            successor:
              result.value.successor === null ? null : toTaskBody(result.value.successor, now),
          },
        };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.reopenTask)
  reopenTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.reopenTask> {
    return tsRestHandler(tasksContract.reopenTask, async ({ params, body }) =>
      this.idempotent(req, 'reopenTask', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await tasks.reopenTask(
          { ...reader, taskId: asTaskId(params.taskId), expectedVersion: body.expectedVersion },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );
        if (!result.ok) return this.conflict(result.error, reader.correlationId);
        return { status: 200 as const, body: toTaskBody(result.value, this.clock.now()) };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.cancelTask)
  cancelTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.cancelTask> {
    return tsRestHandler(tasksContract.cancelTask, async ({ params, body }) =>
      this.idempotent(req, 'cancelTask', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await tasks.cancelTask(
          {
            ...reader,
            taskId: asTaskId(params.taskId),
            expectedVersion: body.expectedVersion,
            scope: body.scope,
            successorId: asTaskId(randomUUID()),
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );

        if (!result.ok) return this.conflict(result.error, reader.correlationId);

        const now = this.clock.now();
        this.successorSpawned(result.value.successor, 'cancel_instance', reader.correlationId);
        return {
          status: 200 as const,
          body: {
            task: toTaskBody(result.value.task, now),
            successor:
              result.value.successor === null ? null : toTaskBody(result.value.successor, now),
          },
        };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.assignTask)
  assignTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.assignTask> {
    return tsRestHandler(tasksContract.assignTask, async ({ params }) =>
      this.idempotent(req, 'assignTask', params.familyId, params, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await tasks.assignTask(
          {
            ...reader,
            taskId: asTaskId(params.taskId),
            assigneeId: asFamilyMemberId(params.memberId),
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );

        if (!result.ok) {
          if (isConflict(result.error)) return this.conflict(result.error, reader.correlationId);
          // FR-016: a member of another family and a random UUID answer alike,
          // so this never says whether that member exists somewhere else.
          return { status: 422 as const, body: toAssigneeError(result.error) };
        }
        return { status: 200 as const, body: toTaskBody(result.value, this.clock.now()) };
      }),
    );
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('tasks:write')
  @TsRestHandler(tasksContract.unassignTask)
  unassignTask(@Req() req: TasksRequest): RouteHandler<typeof tasksContract.unassignTask> {
    return tsRestHandler(tasksContract.unassignTask, async ({ params }) =>
      this.idempotent(req, 'unassignTask', params.familyId, params, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await tasks.unassignTask(
          {
            ...reader,
            taskId: asTaskId(params.taskId),
            assigneeId: asFamilyMemberId(params.memberId),
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );
        if (!result.ok) return this.conflict(result.error, reader.correlationId);
        return { status: 200 as const, body: toTaskBody(result.value, this.clock.now()) };
      }),
    );
  }
}
