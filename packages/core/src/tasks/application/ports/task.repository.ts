import type { FamilyMemberId, TaskId } from '@fp/kernel';
import type { Task } from '../../domain/task.aggregate.js';

/** Keyset position in the open list: `(due_at NULLS LAST, id)`. */
export interface OpenCursor {
  readonly dueAt: Date | null;
  readonly id: TaskId;
}

/** Keyset position in history: `(closed_at DESC, id DESC)`. */
export interface ClosedCursor {
  readonly closedAt: Date;
  readonly id: TaskId;
}

export interface OpenListQuery {
  /** FR-014: a task with any assignee outside this set is excluded IN the query. */
  readonly visibleMemberIds: readonly FamilyMemberId[];
  readonly assignee?: FamilyMemberId;
  /** Only tasks with `due_at <= overdueAt`. */
  readonly overdueAt?: Date;
  /** Half-open `[dueFrom, dueTo)` over `due_at`; either bound excludes undated tasks. */
  readonly dueFrom?: Date;
  readonly dueTo?: Date;
  readonly after?: OpenCursor;
  readonly limit: number;
}

export interface ClosedListQuery {
  readonly visibleMemberIds: readonly FamilyMemberId[];
  /** Half-open `[from, to)` over `closed_at`. */
  readonly from: Date;
  readonly to: Date;
  readonly after?: ClosedCursor;
  readonly limit: number;
}

/**
 * A series invariant the database refused: `UNIQUE (predecessor_id)` (one
 * successor per instance) or `task_one_head_per_series` (one head per series).
 *
 * This is NOT a domain error a client should ever see. Reaching it means the
 * close/spawn transaction raced in a way the row lock was supposed to prevent,
 * so it is raised as an exception rather than returned as a `Result` — a
 * `Result` invites a caller to handle it, and the only correct handling is to
 * fail loudly (FR-022, SC-006).
 */
export class SeriesInvariantViolatedError extends Error {
  constructor(readonly constraint: string) {
    super(
      `A task series invariant was violated (${constraint}). The close-and-spawn transaction raced.`,
    );
    this.name = 'SeriesInvariantViolatedError';
  }
}

/**
 * Scoped by construction (ARCHITECTURE.md §9 layer 4): no method takes a
 * family id. Assignees are loaded with every task, because every reader of a
 * task must apply FR-014's visibility filter to them; they are WRITTEN through
 * `TaskAssignmentRepository`.
 */
export interface TaskRepository {
  /** A new row. Never touches assignments. */
  insert(task: Task): Promise<void>;

  /**
   * Writes the authored and lifecycle fields of an existing row. Callers hold
   * the row lock from `lockById`, which is what makes the version check in the
   * command sufficient (research.md §3).
   */
  save(task: Task): Promise<void>;

  findById(taskId: TaskId): Promise<Task | null>;

  /** As `findById`, taking `FOR UPDATE` on the row for the rest of the transaction. */
  lockById(taskId: TaskId): Promise<Task | null>;

  /**
   * FR-019, FR-022, research.md §3: hands the series head from a closing
   * instance to its successor, in the caller's transaction.
   *
   * The order is the invariant, which is why this is one method and not two
   * calls a command could accidentally make the other way round: the
   * predecessor's `is_series_head` is cleared FIRST, then the successor is
   * inserted, because `task_one_head_per_series` is a partial unique index
   * checked per statement. `predecessor.relinquishHead()` must already have
   * been called.
   *
   * Throws `SeriesInvariantViolatedError` if either unique index refuses.
   */
  handOverHead(predecessor: Task, successor: Task): Promise<void>;

  listOpen(query: OpenListQuery): Promise<readonly Task[]>;

  listClosed(query: ClosedListQuery): Promise<readonly Task[]>;
}
