import { randomUUID } from 'node:crypto';
import type { TransactionClient } from './transaction.js';

/**
 * Tasks fixtures (spec 010 T016).
 *
 * Like `family-factories.ts` and `calendar-factories.ts`, every writer here
 * takes a transaction the caller has ALREADY scoped with `scopeTo`. There is no
 * unscoped write helper, so a test cannot seed a row around the isolation it
 * exists to prove (ADR-017).
 *
 * The fixed clock and the UK transition dates live in `calendar-factories.ts`
 * and are imported by the tests that need them — deliberately not re-declared
 * here, because a second copy is a second thing to drift.
 *
 * `dueAt` is always passed in, never computed. Resolving a local due date to an
 * instant in a zone is the kernel's job (`dueMomentOf`), and a fixture that did
 * it too would be a second implementation of the one rule these tests exist to
 * check.
 */

export interface SeededTask {
  taskId: string;
}

type TaskStatusRow = 'open' | 'completed' | 'cancelled';

interface TaskBase {
  familyId: string;
  title?: string;
  notes?: string | null;
  priority?: 'low' | 'normal' | 'high';
  category?: 'household' | 'school' | 'health' | 'finance' | 'admin' | 'other' | null;
  createdByMemberId?: string | null;
  /** Family members to assign. Each must already exist in `familyId`. */
  assignees?: readonly string[];
  /**
   * Defaults to `open`. A closed task needs its closure instant, which
   * `task_status_shape` and `task_closed_at_consistent` both police.
   */
  status?: TaskStatusRow;
  closedAt?: Date;
  closedByMemberId?: string | null;
  /** The `due_at` already reported overdue (research.md §5). */
  overdueReportedFor?: Date | null;
  version?: number;
}

/** A calendar date as the database holds it: UTC midnight in a `date` column. */
function dateToDb(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** A wall-clock reading as the database holds it: the epoch day in a `time` column. */
function timeToDb(time: { hour: number; minute: number }): Date {
  return new Date(Date.UTC(1970, 0, 1, time.hour, time.minute));
}

function closureColumns(params: TaskBase) {
  const status = params.status ?? 'open';
  if (status === 'open') {
    return {
      status,
      completedAt: null,
      completedByMemberId: null,
      cancelledAt: null,
      cancelledByMemberId: null,
      closedAt: null,
    };
  }
  if (params.closedAt === undefined) {
    throw new Error(`A ${status} task fixture needs a closedAt; task_status_shape requires one.`);
  }
  const by = params.closedByMemberId ?? null;
  return status === 'completed'
    ? {
        status,
        completedAt: params.closedAt,
        completedByMemberId: by,
        cancelledAt: null,
        cancelledByMemberId: null,
        closedAt: params.closedAt,
      }
    : {
        status,
        completedAt: null,
        completedByMemberId: null,
        cancelledAt: params.closedAt,
        cancelledByMemberId: by,
        closedAt: params.closedAt,
      };
}

async function addAssignees(
  tx: TransactionClient,
  params: { taskId: string; familyId: string; assignees?: readonly string[] },
): Promise<void> {
  if (params.assignees === undefined || params.assignees.length === 0) return;
  await tx.taskAssignment.createMany({
    data: params.assignees.map((memberId) => ({
      taskId: params.taskId,
      familyId: params.familyId,
      memberId,
    })),
  });
}

async function insertTask(
  tx: TransactionClient,
  params: TaskBase,
  due: {
    dueKind: 'none' | 'date' | 'date_time';
    dueDate: Date | null;
    dueLocalTime: Date | null;
    timeZone: string | null;
    dueAt: Date | null;
  },
  recurrence: {
    recurrenceRule: string | null;
    recurrenceAnchor: Date | null;
    seriesId: string | null;
    isSeriesHead: boolean;
  },
): Promise<SeededTask> {
  const taskId = randomUUID();
  await tx.task.create({
    data: {
      id: taskId,
      familyId: params.familyId,
      title: params.title ?? 'Take the bins out',
      notes: params.notes ?? null,
      priority: params.priority ?? 'normal',
      category: params.category ?? null,
      createdByMemberId: params.createdByMemberId ?? null,
      overdueReportedFor: params.overdueReportedFor ?? null,
      version: params.version ?? 1,
      ...due,
      ...recurrence,
      ...closureColumns(params),
    },
  });
  await addAssignees(tx, { taskId, familyId: params.familyId, assignees: params.assignees });
  return { taskId };
}

const NO_RECURRENCE = {
  recurrenceRule: null,
  recurrenceAnchor: null,
  seriesId: null,
  isSeriesHead: false,
} as const;

/** A task with no due date at all — the tail of the open list's ordering. */
export async function seedUndatedTask(
  tx: TransactionClient,
  params: TaskBase,
): Promise<SeededTask> {
  return insertTask(
    tx,
    params,
    { dueKind: 'none', dueDate: null, dueLocalTime: null, timeZone: null, dueAt: null },
    NO_RECURRENCE,
  );
}

/**
 * A date-only task. `dueAt` is the start of the NEXT local day, because a task
 * due "on the 30th" is not late until the 30th is over (research.md §4) — the
 * caller states it rather than the fixture deriving it.
 */
export async function seedDateOnlyTask(
  tx: TransactionClient,
  params: TaskBase & { date: string; dueAt: Date; timeZone?: string },
): Promise<SeededTask> {
  return insertTask(
    tx,
    params,
    {
      dueKind: 'date',
      dueDate: dateToDb(params.date),
      dueLocalTime: null,
      timeZone: params.timeZone ?? 'Europe/London',
      dueAt: params.dueAt,
    },
    NO_RECURRENCE,
  );
}

/** A task due at a wall-clock time on a date, with the resolved instant supplied. */
export async function seedDateTimeTask(
  tx: TransactionClient,
  params: TaskBase & {
    date: string;
    time: { hour: number; minute: number };
    dueAt: Date;
    timeZone?: string;
  },
): Promise<SeededTask> {
  return insertTask(
    tx,
    params,
    {
      dueKind: 'date_time',
      dueDate: dateToDb(params.date),
      dueLocalTime: timeToDb(params.time),
      timeZone: params.timeZone ?? 'Europe/London',
      dueAt: params.dueAt,
    },
    NO_RECURRENCE,
  );
}

/**
 * The head of a weekly series — the starting state for the successor tests.
 *
 * `recurrenceAnchor` is the series' anchor, a local wall-clock reading with no
 * zone, and it is NOT the same as this instance's due date once the series has
 * advanced: that difference is what stops `COUNT` restarting forever
 * (research.md §2), so it is a separate parameter rather than a derived one.
 */
export async function seedWeeklyRecurringTask(
  tx: TransactionClient,
  params: TaskBase & {
    date: string;
    dueAt: Date;
    /** Defaults to the due date at midnight, the anchor of a fresh series. */
    recurrenceAnchor?: Date;
    time?: { hour: number; minute: number };
    timeZone?: string;
    byDay?: string;
    rule?: string;
    seriesId?: string;
    isSeriesHead?: boolean;
    predecessorId?: string | null;
  },
): Promise<SeededTask & { seriesId: string }> {
  const seriesId = params.seriesId ?? randomUUID();
  const rule =
    params.rule ??
    (params.byDay === undefined ? 'FREQ=WEEKLY' : `FREQ=WEEKLY;BYDAY=${params.byDay}`);
  const seeded = await insertTask(
    tx,
    params,
    {
      dueKind: params.time === undefined ? 'date' : 'date_time',
      dueDate: dateToDb(params.date),
      dueLocalTime: params.time === undefined ? null : timeToDb(params.time),
      timeZone: params.timeZone ?? 'Europe/London',
      dueAt: params.dueAt,
    },
    {
      recurrenceRule: rule,
      recurrenceAnchor: params.recurrenceAnchor ?? dateToDb(params.date),
      seriesId,
      isSeriesHead: params.isSeriesHead ?? true,
    },
  );
  if (params.predecessorId !== undefined && params.predecessorId !== null) {
    await tx.task.update({
      where: { id: seeded.taskId },
      data: { predecessorId: params.predecessorId },
    });
  }
  return { ...seeded, seriesId };
}
