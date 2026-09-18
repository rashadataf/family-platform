import { tasks } from '@fp/core';
import {
  asFamilyId,
  asFamilyMemberId,
  asTaskId,
  asTaskSeriesId,
  type FamilyId,
  type TaskId,
} from '@fp/kernel';
import { RecurrenceRule, type LocalDate, type LocalDateTime } from '@fp/kernel/recurrence';
import { Prisma } from '../../generated/prisma/index.js';
import type { TransactionClient } from '../../testing.js';

/** PostgreSQL's unique_violation, as Prisma reports it for a model call. */
const UNIQUE_VIOLATION = 'P2002';

// `@db.Date`, `@db.Time` and `@db.Timestamp` (no zone) all round-trip through
// Prisma as a `Date` whose UTC fields carry the stored value. Only those fields
// are meaningful; no zone arithmetic ever touches them.

function localDateToDb(date: LocalDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function dbToLocalDate(value: Date): LocalDate {
  return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() };
}

function localTimeToDb(time: tasks.LocalTime): Date {
  return new Date(Date.UTC(1970, 0, 1, time.hour, time.minute));
}

function localDateTimeToDb(local: LocalDateTime): Date {
  return new Date(
    Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second),
  );
}

function dbToLocalDateTime(value: Date): LocalDateTime {
  return {
    ...dbToLocalDate(value),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
    second: value.getUTCSeconds(),
  };
}

const withAssignees = {
  assignments: {
    select: { memberId: true },
    orderBy: [{ assignedAt: 'asc' }, { memberId: 'asc' }],
  },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof withAssignees }>;

function toDue(row: TaskRow): tasks.Due | null {
  if (row.dueKind === 'none') return null;
  if (row.dueDate === null || row.timeZone === null) {
    // Unreachable under `task_due_shape`; handled rather than asserted (Principle I).
    throw new Error(`task ${row.id} has a due kind but no date or zone.`);
  }
  const date = dbToLocalDate(row.dueDate);
  if (row.dueKind === 'date') return { kind: 'date', date, timeZone: row.timeZone };
  if (row.dueLocalTime === null) throw new Error(`task ${row.id} is date_time with no time.`);
  return {
    kind: 'date_time',
    date,
    time: { hour: row.dueLocalTime.getUTCHours(), minute: row.dueLocalTime.getUTCMinutes() },
    timeZone: row.timeZone,
  };
}

function toState(row: TaskRow): tasks.TaskState {
  const member = (id: string | null) => (id === null ? null : asFamilyMemberId(id));
  if (row.status === 'completed' && row.completedAt !== null) {
    return { status: 'completed', at: row.completedAt, by: member(row.completedByMemberId) };
  }
  if (row.status === 'cancelled' && row.cancelledAt !== null) {
    return { status: 'cancelled', at: row.cancelledAt, by: member(row.cancelledByMemberId) };
  }
  if (row.status === 'open') return { status: 'open' };
  throw new Error(`task ${row.id} is ${row.status} with no closure time.`);
}

function toAggregate(row: TaskRow): tasks.Task {
  let rule: RecurrenceRule | null = null;
  if (row.recurrenceRule !== null) {
    const parsed = RecurrenceRule.parse(row.recurrenceRule);
    // Only canonical rules are written, so one that no longer parses means the
    // kernel's subset narrowed under existing data — loud.
    if (!parsed.ok) throw new Error(`task ${row.id} holds an unparsable rule.`);
    rule = parsed.value;
  }

  return tasks.Task.reconstitute({
    id: asTaskId(row.id),
    familyId: asFamilyId(row.familyId),
    title: row.title,
    notes: row.notes,
    priority: row.priority,
    category: row.category,
    due: toDue(row),
    recurrenceRule: rule,
    recurrenceAnchor:
      row.recurrenceAnchor === null ? null : dbToLocalDateTime(row.recurrenceAnchor),
    seriesId: row.seriesId === null ? null : asTaskSeriesId(row.seriesId),
    predecessorId: row.predecessorId === null ? null : asTaskId(row.predecessorId),
    isSeriesHead: row.isSeriesHead,
    state: toState(row),
    overdueReportedFor: row.overdueReportedFor,
    assignees: row.assignments.map((assignment) => asFamilyMemberId(assignment.memberId)),
    createdByMemberId:
      row.createdByMemberId === null ? null : asFamilyMemberId(row.createdByMemberId),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function columns(task: tasks.Task) {
  const due = task.due;
  const state = task.state;
  const closedAt = state.status === 'open' ? null : state.at;
  return {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    category: task.category,
    status: state.status,
    dueKind: due?.kind ?? 'none',
    dueDate: due === null ? null : localDateToDb(due.date),
    dueLocalTime: due?.kind === 'date_time' ? localTimeToDb(due.time) : null,
    timeZone: due?.timeZone ?? null,
    dueAt: task.dueAt,
    recurrenceRule: task.recurrenceRule?.toString() ?? null,
    recurrenceAnchor:
      task.recurrenceAnchor === null ? null : localDateTimeToDb(task.recurrenceAnchor),
    seriesId: task.seriesId,
    isSeriesHead: task.isSeriesHead,
    completedAt: state.status === 'completed' ? state.at : null,
    completedByMemberId: state.status === 'completed' ? state.by : null,
    cancelledAt: state.status === 'cancelled' ? state.at : null,
    cancelledByMemberId: state.status === 'cancelled' ? state.by : null,
    closedAt,
    overdueReportedFor: task.overdueReportedFor,
    version: task.version,
    // Explicit, or `@updatedAt` stamps the database's clock over the injected one.
    updatedAt: task.updatedAt,
  } as const;
}

/**
 * Scoped by construction: built from a transaction that already carries
 * `app.family_id`, so no read here names a family and none could see another's
 * rows (ADR-017). `familyId` is held only to fill the column on insert.
 *
 * The two list queries select ids with raw SQL — keyset pagination and the
 * visibility anti-join are not expressible through the model API without
 * losing the in-query filter FR-014 depends on — then load aggregates by id
 * and restore the SQL order.
 */
export class PrismaTaskRepository implements tasks.TaskRepository {
  constructor(
    private readonly tx: TransactionClient,
    private readonly familyId: FamilyId,
  ) {}

  async insert(task: tasks.Task): Promise<void> {
    await this.tx.task.create({
      data: {
        id: task.id,
        familyId: this.familyId,
        predecessorId: task.predecessorId,
        createdByMemberId: task.createdByMemberId,
        createdAt: task.createdAt,
        ...columns(task),
      },
    });
  }

  async save(task: tasks.Task): Promise<void> {
    await this.tx.task.update({ where: { id: task.id }, data: columns(task) });
  }

  /**
   * The head hand-over (research.md §3). Clearing the old head's flag BEFORE
   * inserting the successor is the whole point: `task_one_head_per_series` is a
   * partial unique index, checked per statement, so the other order would
   * always refuse.
   *
   * A unique violation here means the row lock failed to serialise a close, so
   * it becomes a typed internal error rather than being swallowed or surfacing
   * as a raw driver code (FR-022, SC-006).
   */
  async handOverHead(predecessor: tasks.Task, successor: tasks.Task): Promise<void> {
    if (predecessor.isSeriesHead) {
      throw new Error(
        `handOverHead was given a predecessor still flagged head (${predecessor.id}); call relinquishHead() first.`,
      );
    }
    try {
      await this.save(predecessor);
      await this.insert(successor);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        const target = error.meta?.target;
        throw new tasks.SeriesInvariantViolatedError(
          typeof target === 'string' ? target : JSON.stringify(target ?? 'unknown'),
        );
      }
      throw error;
    }
  }

  async findById(taskId: TaskId): Promise<tasks.Task | null> {
    const row = await this.tx.task.findFirst({ where: { id: taskId }, include: withAssignees });
    return row === null ? null : toAggregate(row);
  }

  async lockById(taskId: TaskId): Promise<tasks.Task | null> {
    // The policy applies to FOR UPDATE as to any read, so this cannot lock
    // another family's row either.
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "task" WHERE "id" = ${taskId} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return this.findById(taskId);
  }

  async listOpen(query: tasks.OpenListQuery): Promise<readonly tasks.Task[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`t."status" = 'open'`,
      this.visibleOnly(query.visibleMemberIds),
    ];
    if (query.assignee !== undefined) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "task_assignment" fa
        WHERE fa."task_id" = t."id" AND fa."member_id" = ${query.assignee}
      )`);
    }
    if (query.overdueAt !== undefined) {
      conditions.push(Prisma.sql`t."due_at" <= ${query.overdueAt}`);
    }
    if (query.dueFrom !== undefined) conditions.push(Prisma.sql`t."due_at" >= ${query.dueFrom}`);
    if (query.dueTo !== undefined) conditions.push(Prisma.sql`t."due_at" < ${query.dueTo}`);

    const after = query.after;
    if (after !== undefined) {
      // Keyset over (due_at ASC NULLS LAST, id ASC).
      conditions.push(
        after.dueAt === null
          ? Prisma.sql`(t."due_at" IS NULL AND t."id" > ${after.id})`
          : Prisma.sql`(t."due_at" > ${after.dueAt}
              OR (t."due_at" = ${after.dueAt} AND t."id" > ${after.id})
              OR t."due_at" IS NULL)`,
      );
    }

    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "task" t
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY t."due_at" ASC NULLS LAST, t."id" ASC
      LIMIT ${query.limit}
    `;
    return this.loadInOrder(rows.map((row) => row.id));
  }

  async listClosed(query: tasks.ClosedListQuery): Promise<readonly tasks.Task[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`t."status" <> 'open'`,
      Prisma.sql`t."closed_at" >= ${query.from}`,
      Prisma.sql`t."closed_at" < ${query.to}`,
      this.visibleOnly(query.visibleMemberIds),
    ];
    const after = query.after;
    if (after !== undefined) {
      // Keyset over (closed_at DESC, id DESC).
      conditions.push(Prisma.sql`(t."closed_at" < ${after.closedAt}
        OR (t."closed_at" = ${after.closedAt} AND t."id" < ${after.id}))`);
    }

    const rows = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "task" t
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY t."closed_at" DESC, t."id" DESC
      LIMIT ${query.limit}
    `;
    return this.loadInOrder(rows.map((row) => row.id));
  }

  /**
   * FR-014, IN the query: a task with any assignee outside the visible set is
   * never a row. `<> ALL` over an EMPTY visible set is TRUE for every assignee,
   * so a reader who may see nobody sees no assigned task — failing closed.
   */
  private visibleOnly(visibleMemberIds: readonly string[]): Prisma.Sql {
    return Prisma.sql`NOT EXISTS (
      SELECT 1 FROM "task_assignment" ha
      WHERE ha."task_id" = t."id"
        AND ha."member_id" <> ALL(${[...visibleMemberIds]}::text[])
    )`;
  }

  private async loadInOrder(ids: readonly string[]): Promise<readonly tasks.Task[]> {
    if (ids.length === 0) return [];
    const rows = await this.tx.task.findMany({
      where: { id: { in: [...ids] } },
      include: withAssignees,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [toAggregate(row)];
    });
  }
}
