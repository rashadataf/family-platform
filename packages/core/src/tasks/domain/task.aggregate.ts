import {
  err,
  ok,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type TaskId,
  type TaskSeriesId,
} from '@fp/kernel';
import { RecurrenceRule, type LocalDateTime } from '@fp/kernel/recurrence';
import { dueLocalDateTime, dueMomentOf, sameDue, type Due } from './due.js';

/** Platform-defined, never family-authored (spec.md Assumptions). Mirrors `task_priority`. */
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** Mirrors `task_category`. */
export const TASK_CATEGORIES = [
  'household',
  'school',
  'health',
  'finance',
  'admin',
  'other',
] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const TASK_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TITLE_MAX = 200;
export const NOTES_MAX = 4000;

/**
 * The lifecycle as a discriminated union (FR-008, Principle I). A completed task
 * has a completion and no cancellation, and the reverse; "overdue" is not here
 * at all, because it is a condition of an open task, not a state (FR-025).
 */
export type TaskState =
  | { readonly status: 'open' }
  | { readonly status: 'completed'; readonly at: Date; readonly by: FamilyMemberId | null }
  | { readonly status: 'cancelled'; readonly at: Date; readonly by: FamilyMemberId | null };

export type TaskCommand = 'complete' | 'reopen' | 'cancel' | 'edit' | 'assign' | 'unassign';

/** What an edit changed, by group — `TaskUpdated`'s payload names these, never values. */
export type ChangedFieldGroup = 'details' | 'due' | 'recurrence' | 'assignees' | 'status';

export interface TaskProps {
  id: TaskId;
  familyId: FamilyId;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  category: TaskCategory | null;
  due: Due | null;
  recurrenceRule: RecurrenceRule | null;
  recurrenceAnchor: LocalDateTime | null;
  seriesId: TaskSeriesId | null;
  predecessorId: TaskId | null;
  isSeriesHead: boolean;
  state: TaskState;
  overdueReportedFor: Date | null;
  assignees: readonly FamilyMemberId[];
  createdByMemberId: FamilyMemberId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskPatch {
  readonly title?: string;
  readonly notes?: string | null;
  readonly priority?: TaskPriority;
  readonly category?: TaskCategory | null;
  /** `null` clears the due date — refused while the task still recurs. */
  readonly due?: Due | null;
  /** `null` removes the rule; a string adds or replaces it. */
  readonly recurrenceRule?: string | null;
}

function validateTitle(raw: string): Result<string, DomainError> {
  const title = raw.trim();
  if (title === '') return err({ kind: 'NameRequired', reason: 'A task needs a title.' });
  if (title.length > TITLE_MAX) {
    return err({
      kind: 'NameRequired',
      reason: `A title is at most ${String(TITLE_MAX)} characters.`,
    });
  }
  return ok(title);
}

function normaliseNotes(value: string | null | undefined): Result<string | null, DomainError> {
  if (value === null || value === undefined) return ok(null);
  const trimmed = value.trim();
  if (trimmed.length > NOTES_MAX) {
    return err({
      kind: 'NameRequired',
      reason: `Notes are at most ${String(NOTES_MAX)} characters.`,
    });
  }
  return ok(trimmed === '' ? null : trimmed);
}

function parseRule(text: string | null | undefined): Result<RecurrenceRule | null, DomainError> {
  if (text === null || text === undefined) return ok(null);
  return RecurrenceRule.parse(text);
}

function uniqueMembers(members: readonly FamilyMemberId[]): readonly FamilyMemberId[] {
  return [...new Set(members)];
}

/**
 * One thing that must get done (ARCHITECTURE.md §5.4). Every instance of a
 * recurring chore is its own `Task`; the series is `seriesId`, the
 * `predecessorId` chain, and the one instance flagged `isSeriesHead`
 * (data-model.md).
 *
 * Deliberately shares nothing with `CalendarEvent` (FR-012): an event is
 * attended and keeps its slot when cancelled; a task is completed by someone,
 * and a completed recurring task spawns its successor.
 *
 * Assignees are member ids and nothing more. The aggregate cannot tell a child
 * from an adult, by design (research.md §1, §7).
 *
 * `version` increments on every change a member makes (FR-011). The overdue
 * marker is not such a change and does not bump it, so the sweep never turns a
 * client's next write into a conflict.
 */
export class Task {
  private constructor(private props: TaskProps) {}

  static create(params: {
    id: TaskId;
    familyId: FamilyId;
    /** Allocated by the caller; used only if the task recurs. */
    newSeriesId: TaskSeriesId;
    title: string;
    notes?: string | null;
    priority?: TaskPriority;
    category?: TaskCategory | null;
    due?: Due | null;
    recurrenceRule?: string | null;
    assignees?: readonly FamilyMemberId[];
    createdByMemberId: FamilyMemberId | null;
    now: Date;
  }): Result<Task, DomainError> {
    const title = validateTitle(params.title);
    if (!title.ok) return title;
    const notes = normaliseNotes(params.notes);
    if (!notes.ok) return notes;
    const rule = parseRule(params.recurrenceRule);
    if (!rule.ok) return rule;

    const due = params.due ?? null;
    if (rule.value !== null && due === null) return err({ kind: 'RecurrenceRequiresDue' });
    const recurring = rule.value !== null && due !== null;

    return ok(
      new Task({
        id: params.id,
        familyId: params.familyId,
        title: title.value,
        notes: notes.value,
        priority: params.priority ?? 'normal',
        category: params.category ?? null,
        due,
        recurrenceRule: rule.value,
        recurrenceAnchor: recurring ? dueLocalDateTime(due) : null,
        seriesId: recurring ? params.newSeriesId : null,
        predecessorId: null,
        isSeriesHead: recurring,
        state: { status: 'open' },
        overdueReportedFor: null,
        assignees: uniqueMembers(params.assignees ?? []),
        createdByMemberId: params.createdByMemberId,
        version: 1,
        createdAt: params.now,
        updatedAt: params.now,
      }),
    );
  }

  /**
   * The successor of a closing head (data-model.md, "The successor rule"). The
   * due date is supplied by `successor.ts`; everything authored is carried
   * forward, assignees included, and the new task is the series' head.
   */
  static successorOf(params: {
    id: TaskId;
    head: Task;
    due: Due;
    createdByMemberId: FamilyMemberId | null;
    now: Date;
  }): Task {
    const head = params.head.props;
    return new Task({
      id: params.id,
      familyId: head.familyId,
      title: head.title,
      notes: head.notes,
      priority: head.priority,
      category: head.category,
      due: params.due,
      recurrenceRule: head.recurrenceRule,
      recurrenceAnchor: head.recurrenceAnchor,
      seriesId: head.seriesId,
      predecessorId: head.id,
      isSeriesHead: true,
      state: { status: 'open' },
      overdueReportedFor: null,
      assignees: [...head.assignees],
      createdByMemberId: params.createdByMemberId,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static reconstitute(props: TaskProps): Task {
    return new Task(props);
  }

  get id(): TaskId {
    return this.props.id;
  }
  get familyId(): FamilyId {
    return this.props.familyId;
  }
  get title(): string {
    return this.props.title;
  }
  get notes(): string | null {
    return this.props.notes;
  }
  get priority(): TaskPriority {
    return this.props.priority;
  }
  get category(): TaskCategory | null {
    return this.props.category;
  }
  get due(): Due | null {
    return this.props.due;
  }
  /** The derived due moment the lists, the sweep and `isOverdue` all read. */
  get dueAt(): Date | null {
    return this.props.due === null ? null : dueMomentOf(this.props.due);
  }
  get recurrenceRule(): RecurrenceRule | null {
    return this.props.recurrenceRule;
  }
  get recurrenceAnchor(): LocalDateTime | null {
    return this.props.recurrenceAnchor;
  }
  get seriesId(): TaskSeriesId | null {
    return this.props.seriesId;
  }
  get predecessorId(): TaskId | null {
    return this.props.predecessorId;
  }
  get isSeriesHead(): boolean {
    return this.props.isSeriesHead;
  }
  get state(): TaskState {
    return this.props.state;
  }
  get status(): TaskStatus {
    return this.props.state.status;
  }
  get isOpen(): boolean {
    return this.props.state.status === 'open';
  }
  get overdueReportedFor(): Date | null {
    return this.props.overdueReportedFor;
  }
  get assignees(): readonly FamilyMemberId[] {
    return this.props.assignees;
  }
  get createdByMemberId(): FamilyMemberId | null {
    return this.props.createdByMemberId;
  }
  get version(): number {
    return this.props.version;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** FR-025: a condition of an open task, read against a clock, never stored as a state. */
  isOverdue(now: Date): boolean {
    const dueAt = this.dueAt;
    return this.isOpen && dueAt !== null && dueAt.getTime() <= now.getTime();
  }

  private refuse(command: TaskCommand): Result<never, DomainError> {
    return err({ kind: 'InvalidTransition', from: this.props.state.status, command });
  }

  private commit(next: TaskProps, now: Date): void {
    this.props = { ...next, version: next.version + 1, updatedAt: now };
  }

  /**
   * FR-010 with PATCH semantics, on open tasks only. Validates the merged result
   * as a whole before changing anything, so a refused edit leaves the task as it
   * was.
   *
   * The recurrence anchor moves only when the RULE changes (research.md §2): a
   * one-off move of this instance's due date — bins pushed to Friday in a
   * bank-holiday week — leaves the series on Thursdays.
   */
  update(
    patch: TaskPatch,
    ctx: { now: Date; newSeriesId: TaskSeriesId },
  ): Result<readonly ChangedFieldGroup[], DomainError> {
    if (!this.isOpen) return this.refuse('edit');

    const next: TaskProps = { ...this.props };
    const changed = new Set<ChangedFieldGroup>();

    if (patch.title !== undefined) {
      const title = validateTitle(patch.title);
      if (!title.ok) return title;
      if (title.value !== next.title) changed.add('details');
      next.title = title.value;
    }
    if (patch.notes !== undefined) {
      const notes = normaliseNotes(patch.notes);
      if (!notes.ok) return notes;
      if (notes.value !== next.notes) changed.add('details');
      next.notes = notes.value;
    }
    if (patch.priority !== undefined && patch.priority !== next.priority) {
      changed.add('details');
      next.priority = patch.priority;
    }
    if (patch.category !== undefined && patch.category !== next.category) {
      changed.add('details');
      next.category = patch.category;
    }
    if (patch.due !== undefined) {
      if (!sameDue(patch.due, next.due)) changed.add('due');
      next.due = patch.due;
    }

    if (patch.recurrenceRule !== undefined) {
      const rule = parseRule(patch.recurrenceRule);
      if (!rule.ok) return rule;
      const before = next.recurrenceRule?.toString() ?? null;
      const after = rule.value?.toString() ?? null;

      if (before !== after) {
        // A reopened former head carries its old rule but is not the head: it
        // can no longer spawn, so changing the series from it would mean two
        // instances each believing they define the series (FR-019).
        if (next.seriesId !== null && !next.isSeriesHead) return this.refuse('edit');
        changed.add('recurrence');

        if (rule.value === null) {
          next.recurrenceRule = null;
          next.recurrenceAnchor = null;
          next.isSeriesHead = false;
        } else {
          if (next.due === null) return err({ kind: 'RecurrenceRequiresDue' });
          next.recurrenceRule = rule.value;
          next.recurrenceAnchor = dueLocalDateTime(next.due);
          next.seriesId ??= ctx.newSeriesId;
          next.isSeriesHead = true;
        }
      }
    }

    if (next.recurrenceRule !== null && next.due === null) {
      return err({ kind: 'RecurrenceRequiresDue' });
    }

    if (changed.size > 0) this.commit(next, ctx.now);
    return ok([...changed]);
  }

  /** FR-008, FR-009: open → completed, recording who and when. */
  complete(by: FamilyMemberId, now: Date): Result<void, DomainError> {
    if (!this.isOpen) return this.refuse('complete');
    this.commit({ ...this.props, state: { status: 'completed', at: now, by } }, now);
    return ok(undefined);
  }

  /** FR-008: completed → open. Never touches the head flag (FR-019). */
  reopen(now: Date): Result<void, DomainError> {
    if (this.props.state.status !== 'completed') return this.refuse('reopen');
    this.commit({ ...this.props, state: { status: 'open' } }, now);
    return ok(undefined);
  }

  /** FR-008: open → cancelled, which is terminal. */
  cancel(by: FamilyMemberId, now: Date): Result<void, DomainError> {
    if (!this.isOpen) return this.refuse('cancel');
    this.commit({ ...this.props, state: { status: 'cancelled', at: now, by } }, now);
    return ok(undefined);
  }

  /** Returns whether anything changed. Closed tasks refuse (FR-010). */
  assign(memberId: FamilyMemberId, now: Date): Result<boolean, DomainError> {
    if (!this.isOpen) return this.refuse('assign');
    if (this.props.assignees.includes(memberId)) return ok(false);
    this.commit({ ...this.props, assignees: [...this.props.assignees, memberId] }, now);
    return ok(true);
  }

  unassign(memberId: FamilyMemberId, now: Date): Result<boolean, DomainError> {
    if (!this.isOpen) return this.refuse('unassign');
    if (!this.props.assignees.includes(memberId)) return ok(false);
    this.commit(
      { ...this.props, assignees: this.props.assignees.filter((member) => member !== memberId) },
      now,
    );
    return ok(true);
  }

  /** Called on the closing head, before its successor is inserted (research.md §3). */
  relinquishHead(): void {
    this.props = { ...this.props, isSeriesHead: false };
  }

  /** FR-027: the sweep's marker. Not a member's change, so no version bump. */
  recordOverdueReported(): void {
    this.props = { ...this.props, overdueReportedFor: this.dueAt };
  }
}
