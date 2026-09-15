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
import { calendarContract } from '@fp/contracts';
import { calendar, type family } from '@fp/core';
import {
  asCalendarEventId,
  asEventOccurrenceId,
  asFamilyId,
  asFamilyMemberId,
  type Clock,
  type DomainError,
  type IdempotencyPort,
  type JsonValue,
} from '@fp/kernel';
import { formatLocalDate, parseLocalDate, type LocalDate } from '@fp/kernel/recurrence';
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
  CALENDAR_CLOCK,
  CALENDAR_IDEMPOTENCY_STORE,
  CALENDAR_UNIT_OF_WORK,
  MEMBER_VISIBILITY,
} from './calendar.tokens.js';

type RouteHandler<T extends AppRoute> = (
  args: TsRestRequestShape<T>,
) => Promise<ServerInferResponses<T>>;

interface CalendarRequest extends RequestWithFamilyContext {
  headers: RequestWithFamilyContext['headers'] & { 'idempotency-key'?: string };
}

const NOT_FOUND = { type: 'calendar/not_found' } as const;

/** The wire's 422 bodies for a write the domain refused. `NotFound` is thrown, never returned. */
type WriteError =
  | { type: 'calendar/invalid_time_range'; reason: string }
  | { type: 'calendar/unknown_time_zone' }
  | { type: 'calendar/recurrence_invalid'; reason: string }
  | { type: 'calendar/recurrence_unsupported'; part: string }
  | { type: 'calendar/recurrence_too_dense'; limit: number }
  | { type: 'calendar/participant_invalid' };

/**
 * Domain failure → wire response, in one place, so every write route maps the
 * same kind to the same type. A kind no Calendar command produces is a defect,
 * not a response a client should be handed.
 */
function toWriteError(error: DomainError): WriteError {
  switch (error.kind) {
    case 'InvalidTimeRange':
      return { type: 'calendar/invalid_time_range', reason: error.reason };
    case 'UnknownTimeZone':
      // The zone the caller sent is not echoed: they have it, and a log line
      // assembled from this body should not carry request input.
      return { type: 'calendar/unknown_time_zone' };
    case 'RecurrenceInvalid':
      return { type: 'calendar/recurrence_invalid', reason: error.reason };
    case 'RecurrenceUnsupported':
      return { type: 'calendar/recurrence_unsupported', part: error.part };
    case 'RecurrenceTooDense':
      return { type: 'calendar/recurrence_too_dense', limit: error.limit };
    case 'ParticipantInvalid':
      return { type: 'calendar/participant_invalid' };
    case 'NotFound':
      throw new NotFoundException(NOT_FOUND);
    case 'NameRequired':
      // Unreachable through the contract (`title` has `.min(1)` after trim).
      throw new BadRequestException({ type: 'calendar/invalid_request' });
    default:
      throw new Error(`Calendar route received an unexpected domain error: ${error.kind}`);
  }
}

/** An all-day event's dates cross the wire as `YYYY-MM-DD` and nothing else (FR-004). */
function parseDate(value: string): LocalDate | WriteError {
  return (
    parseLocalDate(value) ?? {
      type: 'calendar/invalid_time_range',
      reason: `${value} is not a calendar date.`,
    }
  );
}

function isWriteError(value: unknown): value is WriteError {
  return typeof value === 'object' && value !== null && 'type' in value;
}

function toEventBody(event: calendar.CalendarEvent) {
  const common = {
    eventId: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    category: event.category,
    timeZone: event.timeZone,
    recurrenceRule: event.recurrenceRule?.toString() ?? null,
    status: event.status,
    participants: [...event.participants],
    attachments: [...event.attachmentRefs],
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
  const timing = event.timing;
  return timing.kind === 'timed'
    ? {
        ...common,
        kind: 'timed' as const,
        startsAt: timing.startsAt.toISOString(),
        endsAt: timing.endsAt.toISOString(),
      }
    : {
        ...common,
        kind: 'all_day' as const,
        startDate: formatLocalDate(timing.startDate),
        endDate: formatLocalDate(timing.endDate),
      };
}

/**
 * Calendar's HTTP surface (contracts/calendar-api.md). Every route is
 * family-scoped and runs spec 008's guard chain unchanged — session, then
 * standing (`404` for none), then capability (`403`) — before any handler or
 * body validation runs. `@UsesProblemNamespace('calendar')` makes those guards
 * answer in this contract's types.
 *
 * Handlers hold no rule. FR-016's guardian filter, FR-017's audit and every
 * invariant live in `packages/core/calendar`, so a second consumer of the same
 * commands cannot apply a laxer version.
 *
 * Log lines carry identifiers, counts and durations — never a title,
 * description or location (Principle VI).
 */
@Controller()
@UsesProblemNamespace('calendar')
export class CalendarController {
  private readonly logger = new Logger(CalendarController.name);

  constructor(
    @Inject(CALENDAR_CLOCK) private readonly clock: Clock,
    @Inject(CALENDAR_UNIT_OF_WORK) private readonly unitOfWork: calendar.CalendarUnitOfWorkPort,
    @Inject(MEMBER_VISIBILITY) private readonly visibility: family.MemberVisibilityPort,
    @Inject(CALENDAR_IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyPort,
  ) {}

  private reader(req: CalendarRequest, familyId: string): calendar.Reader {
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

  private logOccurrencesWritten(
    counts: calendar.ReconcileCounts | null,
    correlationId: string,
  ): void {
    if (counts === null) return;
    // `calendar_occurrences_written_total{op}`: a reconcile that deletes and
    // reinserts everything on every pass is a correctness bug that would
    // otherwise look like health (contracts/calendar-api.md).
    const byOp = { insert: counts.inserted, update: counts.updated, delete: counts.deleted };
    for (const [op, value] of Object.entries(byOp)) {
      this.logger.log(
        `calendar_occurrences_written_total op=${op} value=${String(value)} [correlationId=${correlationId}]`,
      );
    }
  }

  /**
   * ADR-006, Principle IX, FR-023. Scoped by family and route as well as by
   * caller, and only a success is stored — a refusal wrote nothing, so a fresh
   * validation replays it for free.
   */
  private async idempotent<R extends { status: number; body: unknown }>(
    req: CalendarRequest,
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
  @RequiresCapability('calendar:read')
  @TsRestHandler(calendarContract.listOccurrences)
  listOccurrences(
    @Req() req: CalendarRequest,
  ): RouteHandler<typeof calendarContract.listOccurrences> {
    return tsRestHandler(calendarContract.listOccurrences, async ({ params, query }) => {
      const reader = this.reader(req, params.familyId);
      const startedAt = performance.now();

      const result = await calendar.listOccurrences(
        {
          familyId: reader.familyId,
          from: new Date(query.from),
          to: new Date(query.to),
          readerMemberId: reader.memberId,
          readerUserId: reader.userId,
          correlationId: reader.correlationId,
        },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );

      // `calendar_range_query_duration` — SC-002's p95 budget of 200 ms.
      this.logger.log(
        `calendar_range_query_duration_ms=${(performance.now() - startedAt).toFixed(1)} [correlationId=${reader.correlationId}]`,
      );

      if (!result.ok) {
        if (result.error.kind === 'RangeTooWide') {
          return {
            status: 422 as const,
            body: { type: 'calendar/range_too_wide' as const, maxDays: result.error.maxDays },
          };
        }
        if (result.error.kind === 'InvalidTimeRange') {
          return {
            status: 422 as const,
            body: { type: 'calendar/invalid_time_range' as const, reason: result.error.reason },
          };
        }
        throw new NotFoundException(NOT_FOUND);
      }

      return {
        status: 200 as const,
        body: result.value.map((row) => ({
          occurrenceId: row.occurrenceId,
          eventId: row.eventId,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          cancelledAt: row.cancelledAt?.toISOString() ?? null,
          kind: row.kind,
          startDate: row.startDate === null ? null : formatLocalDate(row.startDate),
          endDate: row.endDate === null ? null : formatLocalDate(row.endDate),
          title: row.title,
          timeZone: row.timeZone,
          location: row.location,
          category: row.category,
          status: row.status,
          participants: [...row.participants],
        })),
      };
    });
  }

  @UseGuards(SessionGuard, PerUserThrottlerGuard, FamilyMembershipGuard, CapabilityGuard)
  @Throttle({ default: { limit: 120, ttl: 3_600_000 } })
  @RequiresCapability('calendar:write')
  @TsRestHandler(calendarContract.createEvent)
  createEvent(@Req() req: CalendarRequest): RouteHandler<typeof calendarContract.createEvent> {
    return tsRestHandler(calendarContract.createEvent, async ({ params, body }) =>
      this.idempotent(req, 'createEvent', params.familyId, body, async () => {
        const reader = this.reader(req, params.familyId);

        let timing: calendar.EventTiming;
        if (body.kind === 'timed') {
          timing = {
            kind: 'timed',
            startsAt: new Date(body.startsAt),
            endsAt: new Date(body.endsAt),
          };
        } else {
          const startDate = parseDate(body.startDate);
          const endDate = parseDate(body.endDate);
          if (isWriteError(startDate)) return { status: 422 as const, body: startDate };
          if (isWriteError(endDate)) return { status: 422 as const, body: endDate };
          timing = { kind: 'all_day', startDate, endDate };
        }

        const result = await calendar.createEvent(
          {
            familyId: reader.familyId,
            eventId: asCalendarEventId(randomUUID()),
            createdByMemberId: reader.memberId,
            title: body.title,
            description: body.description,
            location: body.location,
            category: body.category,
            timing,
            timeZone: body.timeZone,
            recurrenceRule: body.recurrenceRule,
            participants: body.participants?.map(asFamilyMemberId),
            attachmentRefs: body.attachments,
            correlationId: reader.correlationId,
          },
          { unitOfWork: this.unitOfWork, clock: this.clock },
        );

        if (!result.ok) {
          this.logger.log(
            `Event creation rejected: ${result.error.kind} [correlationId=${reader.correlationId}]`,
          );
          return { status: 422 as const, body: toWriteError(result.error) };
        }

        this.logger.log(
          `Created calendar event ${result.value.eventId} [correlationId=${reader.correlationId}]`,
        );
        this.logOccurrencesWritten(result.value.counts, reader.correlationId);
        return { status: 201 as const, body: { eventId: result.value.eventId } };
      }),
    );
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('calendar:read')
  @TsRestHandler(calendarContract.getEvent)
  getEvent(@Req() req: CalendarRequest): RouteHandler<typeof calendarContract.getEvent> {
    return tsRestHandler(calendarContract.getEvent, async ({ params }) => {
      const reader = this.reader(req, params.familyId);
      const result = await calendar.getEvent(
        { ...reader, eventId: asCalendarEventId(params.eventId) },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );
      // FR-016: missing, another family's, and involving a child the caller
      // does not guard are one answer. The audit log has the difference.
      if (!result.ok) throw new NotFoundException(NOT_FOUND);
      return { status: 200 as const, body: toEventBody(result.value) };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('calendar:write')
  @TsRestHandler(calendarContract.updateEvent)
  updateEvent(@Req() req: CalendarRequest): RouteHandler<typeof calendarContract.updateEvent> {
    return tsRestHandler(calendarContract.updateEvent, async ({ params, body }) => {
      const reader = this.reader(req, params.familyId);

      let startDate: LocalDate | undefined;
      let endDate: LocalDate | undefined;
      if (body.startDate !== undefined) {
        const parsed = parseDate(body.startDate);
        if (isWriteError(parsed)) return { status: 422 as const, body: parsed };
        startDate = parsed;
      }
      if (body.endDate !== undefined) {
        const parsed = parseDate(body.endDate);
        if (isWriteError(parsed)) return { status: 422 as const, body: parsed };
        endDate = parsed;
      }

      const touchesTiming =
        body.kind !== undefined ||
        body.startsAt !== undefined ||
        body.endsAt !== undefined ||
        startDate !== undefined ||
        endDate !== undefined;

      const result = await calendar.updateEvent(
        {
          ...reader,
          eventId: asCalendarEventId(params.eventId),
          patch: {
            title: body.title,
            description: body.description,
            location: body.location,
            category: body.category,
            timeZone: body.timeZone,
            recurrenceRule: body.recurrenceRule,
            participants: body.participants?.map(asFamilyMemberId),
            attachmentRefs: body.attachments,
            timing: touchesTiming
              ? {
                  kind: body.kind,
                  startsAt: body.startsAt === undefined ? undefined : new Date(body.startsAt),
                  endsAt: body.endsAt === undefined ? undefined : new Date(body.endsAt),
                  startDate,
                  endDate,
                }
              : undefined,
          },
        },
        { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
      );

      if (!result.ok) {
        this.logger.log(
          `Event update rejected: ${result.error.kind} [correlationId=${reader.correlationId}]`,
        );
        return { status: 422 as const, body: toWriteError(result.error) };
      }

      this.logOccurrencesWritten(result.value.counts, reader.correlationId);
      return { status: 200 as const, body: toEventBody(result.value.event) };
    });
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('calendar:write')
  @TsRestHandler(calendarContract.cancelEvent)
  cancelEvent(@Req() req: CalendarRequest): RouteHandler<typeof calendarContract.cancelEvent> {
    return tsRestHandler(calendarContract.cancelEvent, async ({ params }) =>
      this.idempotent(req, 'cancelEvent', params.familyId, params, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await calendar.cancelEvent(
          { ...reader, eventId: asCalendarEventId(params.eventId) },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );
        if (!result.ok) throw new NotFoundException(NOT_FOUND);
        return { status: 200 as const, body: toEventBody(result.value) };
      }),
    );
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('calendar:write')
  @TsRestHandler(calendarContract.cancelOccurrence)
  cancelOccurrence(
    @Req() req: CalendarRequest,
  ): RouteHandler<typeof calendarContract.cancelOccurrence> {
    return tsRestHandler(calendarContract.cancelOccurrence, async ({ params }) =>
      this.idempotent(req, 'cancelOccurrence', params.familyId, params, async () => {
        const reader = this.reader(req, params.familyId);
        const result = await calendar.cancelOccurrence(
          {
            ...reader,
            eventId: asCalendarEventId(params.eventId),
            occurrenceId: asEventOccurrenceId(params.occurrenceId),
          },
          { unitOfWork: this.unitOfWork, visibility: this.visibility, clock: this.clock },
        );
        if (!result.ok || result.value.cancelledAt === null) throw new NotFoundException(NOT_FOUND);
        return {
          status: 200 as const,
          body: {
            occurrenceId: result.value.id,
            eventId: result.value.eventId,
            startsAt: result.value.startsAt.toISOString(),
            endsAt: result.value.endsAt.toISOString(),
            cancelledAt: result.value.cancelledAt.toISOString(),
          },
        };
      }),
    );
  }

  @UseGuards(SessionGuard, FamilyMembershipGuard, CapabilityGuard)
  @RequiresCapability('calendar:write')
  @TsRestHandler(calendarContract.rescheduleOccurrence)
  rescheduleOccurrence(
    @Req() req: CalendarRequest,
  ): RouteHandler<typeof calendarContract.rescheduleOccurrence> {
    return tsRestHandler(calendarContract.rescheduleOccurrence, async ({ params }) => {
      const reader = this.reader(req, params.familyId);
      const result = await calendar.rescheduleOccurrence(
        {
          ...reader,
          eventId: asCalendarEventId(params.eventId),
          occurrenceId: asEventOccurrenceId(params.occurrenceId),
        },
        { unitOfWork: this.unitOfWork, visibility: this.visibility },
      );
      if (!result.ok && result.error.kind === 'OccurrenceNotMovable') {
        return { status: 422 as const, body: { type: 'calendar/occurrence_not_movable' as const } };
      }
      throw new NotFoundException(NOT_FOUND);
    });
  }
}
