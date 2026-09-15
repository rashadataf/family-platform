import {
  err,
  ok,
  type CalendarEventId,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import {
  compareLocalDates,
  isValidTimeZone,
  RecurrenceRule,
  type LocalDate,
} from '@fp/kernel/recurrence';

/** Platform-defined, never family-authored (spec.md Assumptions). Mirrors the `event_category` enum. */
export const EVENT_CATEGORIES = [
  'medical',
  'school',
  'nursery',
  'activity',
  'birthday',
  'holiday',
  'deadline',
  'social',
  'household',
  'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** A cancelled event keeps its slot (FR-021). There is no `deleted`. */
export const EVENT_STATUSES = ['confirmed', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Timed or all-day, as a discriminated union (Principle I). An all-day event
 * has dates and no instants; a timed event has instants and no dates. "An
 * all-day event with a start time" is not a state this type can hold — and the
 * `event_shape` CHECK makes it one the table cannot hold either.
 */
export type EventTiming =
  | { readonly kind: 'timed'; readonly startsAt: Date; readonly endsAt: Date }
  | { readonly kind: 'all_day'; readonly startDate: LocalDate; readonly endDate: LocalDate };

export type EventKind = EventTiming['kind'];

/**
 * A timing change as a PATCH carries it: any subset of fields, possibly with a
 * new `kind`. Merged against the current timing in `update`, which is the one
 * place that knows what a partial timing means.
 */
export interface TimingPatch {
  readonly kind?: EventKind;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
  readonly startDate?: LocalDate;
  readonly endDate?: LocalDate;
}

export interface EventPatch {
  readonly title?: string;
  readonly description?: string | null;
  readonly location?: string | null;
  readonly category?: EventCategory | null;
  readonly attachmentRefs?: readonly string[];
  readonly timeZone?: string;
  readonly timing?: TimingPatch;
  /** `null` removes the rule, turning a series into a one-off. */
  readonly recurrenceRule?: string | null;
  readonly participants?: readonly FamilyMemberId[];
}

/**
 * Which kinds of thing an edit changed — the `EventUpdated` payload names
 * these rather than the fields, so a consumer learns "the time moved" without
 * the event carrying the time (Principle VI).
 */
export type ChangedFieldGroup = 'details' | 'timing' | 'recurrence' | 'participants';

export interface EventUpdateOutcome {
  readonly changed: readonly ChangedFieldGroup[];
  /** True when the set of instants the event produces may have moved — the trigger for FR-020's rebuild. */
  readonly reschedule: boolean;
}

export interface CalendarEventProps {
  id: CalendarEventId;
  familyId: FamilyId;
  title: string;
  description: string | null;
  location: string | null;
  category: EventCategory | null;
  timing: EventTiming;
  timeZone: string;
  recurrenceRule: RecurrenceRule | null;
  attachmentRefs: readonly string[];
  status: EventStatus;
  participants: readonly FamilyMemberId[];
  materialisedThrough: Date | null;
  createdByMemberId: FamilyMemberId | null;
  createdAt: Date;
  updatedAt: Date;
}

function validateTiming(timing: EventTiming): Result<EventTiming, DomainError> {
  if (timing.kind === 'timed') {
    if (Number.isNaN(timing.startsAt.getTime()) || Number.isNaN(timing.endsAt.getTime())) {
      return err({
        kind: 'InvalidTimeRange',
        reason: 'startsAt and endsAt must be real instants.',
      });
    }
    if (timing.endsAt.getTime() < timing.startsAt.getTime()) {
      return err({
        kind: 'InvalidTimeRange',
        reason: 'The event ends before it starts: endsAt must be at or after startsAt.',
      });
    }
  } else if (compareLocalDates(timing.endDate, timing.startDate) < 0) {
    return err({
      kind: 'InvalidTimeRange',
      reason: 'The event ends before it starts: endDate must be on or after startDate.',
    });
  }
  return ok(timing);
}

function validateTimeZone(timeZone: string): Result<string, DomainError> {
  // FR-002: refused, never silently defaulted.
  return isValidTimeZone(timeZone) ? ok(timeZone) : err({ kind: 'UnknownTimeZone', timeZone });
}

function parseRule(text: string | null | undefined): Result<RecurrenceRule | null, DomainError> {
  if (text === null || text === undefined) return ok(null);
  return RecurrenceRule.parse(text);
}

function normaliseOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function uniqueMembers(members: readonly FamilyMemberId[]): readonly FamilyMemberId[] {
  return [...new Set(members)];
}

function mergeTiming(current: EventTiming, patch: TimingPatch): Result<EventTiming, DomainError> {
  const kind = patch.kind ?? current.kind;

  if (kind === 'timed') {
    if (patch.startDate !== undefined || patch.endDate !== undefined) {
      return err({
        kind: 'InvalidTimeRange',
        reason: 'A timed event has startsAt and endsAt, not startDate and endDate.',
      });
    }
    const startsAt = patch.startsAt ?? (current.kind === 'timed' ? current.startsAt : undefined);
    const endsAt = patch.endsAt ?? (current.kind === 'timed' ? current.endsAt : undefined);
    if (startsAt === undefined || endsAt === undefined) {
      return err({
        kind: 'InvalidTimeRange',
        reason: 'Changing an all-day event to a timed one needs both startsAt and endsAt.',
      });
    }
    return ok({ kind, startsAt, endsAt });
  }

  if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
    return err({
      kind: 'InvalidTimeRange',
      reason: 'An all-day event has startDate and endDate, not startsAt and endsAt.',
    });
  }
  const startDate = patch.startDate ?? (current.kind === 'all_day' ? current.startDate : undefined);
  const endDate = patch.endDate ?? (current.kind === 'all_day' ? current.endDate : undefined);
  if (startDate === undefined || endDate === undefined) {
    return err({
      kind: 'InvalidTimeRange',
      reason: 'Changing a timed event to an all-day one needs both startDate and endDate.',
    });
  }
  return ok({ kind, startDate, endDate });
}

function sameTiming(a: EventTiming, b: EventTiming): boolean {
  if (a.kind === 'timed' && b.kind === 'timed') {
    return (
      a.startsAt.getTime() === b.startsAt.getTime() && a.endsAt.getTime() === b.endsAt.getTime()
    );
  }
  if (a.kind === 'all_day' && b.kind === 'all_day') {
    return (
      compareLocalDates(a.startDate, b.startDate) === 0 &&
      compareLocalDates(a.endDate, b.endDate) === 0
    );
  }
  return false;
}

function sameMembers(a: readonly FamilyMemberId[], b: readonly FamilyMemberId[]): boolean {
  const left = new Set(a);
  return a.length === b.length && b.every((member) => left.has(member));
}

/**
 * The thing a family intends to happen — the record of truth every occurrence
 * is derived from (ARCHITECTURE.md §5.3).
 *
 * The invariants are enforced here, in the constructor path, and ALSO by the
 * `event_shape` and `event_order` CHECK constraints: the domain cannot see a
 * raw query, and FR-002's ordering rule is a correctness requirement rather
 * than an input nicety.
 *
 * Participants are member ids and nothing more. The aggregate cannot tell a
 * child from an adult, by design (research.md §1).
 */
export class CalendarEvent {
  private constructor(private props: CalendarEventProps) {}

  static create(params: {
    id: CalendarEventId;
    familyId: FamilyId;
    title: string;
    description?: string | null;
    location?: string | null;
    category?: EventCategory | null;
    timing: EventTiming;
    timeZone: string;
    recurrenceRule?: string | null;
    attachmentRefs?: readonly string[];
    participants?: readonly FamilyMemberId[];
    createdByMemberId: FamilyMemberId | null;
    now: Date;
  }): Result<CalendarEvent, DomainError> {
    const title = params.title.trim();
    if (title === '') {
      return err({ kind: 'NameRequired', reason: 'An event needs a title.' });
    }

    const timing = validateTiming(params.timing);
    if (!timing.ok) return timing;
    const timeZone = validateTimeZone(params.timeZone);
    if (!timeZone.ok) return timeZone;
    const rule = parseRule(params.recurrenceRule);
    if (!rule.ok) return rule;

    return ok(
      new CalendarEvent({
        id: params.id,
        familyId: params.familyId,
        title,
        description: normaliseOptionalText(params.description),
        location: normaliseOptionalText(params.location),
        category: params.category ?? null,
        timing: timing.value,
        timeZone: timeZone.value,
        recurrenceRule: rule.value,
        attachmentRefs: [...(params.attachmentRefs ?? [])],
        status: 'confirmed',
        participants: uniqueMembers(params.participants ?? []),
        materialisedThrough: null,
        createdByMemberId: params.createdByMemberId,
        createdAt: params.now,
        updatedAt: params.now,
      }),
    );
  }

  static reconstitute(props: CalendarEventProps): CalendarEvent {
    return new CalendarEvent(props);
  }

  get id(): CalendarEventId {
    return this.props.id;
  }
  get familyId(): FamilyId {
    return this.props.familyId;
  }
  get title(): string {
    return this.props.title;
  }
  get description(): string | null {
    return this.props.description;
  }
  get location(): string | null {
    return this.props.location;
  }
  get category(): EventCategory | null {
    return this.props.category;
  }
  get timing(): EventTiming {
    return this.props.timing;
  }
  get kind(): EventKind {
    return this.props.timing.kind;
  }
  get timeZone(): string {
    return this.props.timeZone;
  }
  get recurrenceRule(): RecurrenceRule | null {
    return this.props.recurrenceRule;
  }
  get isRecurring(): boolean {
    return this.props.recurrenceRule !== null;
  }
  get attachmentRefs(): readonly string[] {
    return this.props.attachmentRefs;
  }
  get status(): EventStatus {
    return this.props.status;
  }
  get isCancelled(): boolean {
    return this.props.status === 'cancelled';
  }
  get participants(): readonly FamilyMemberId[] {
    return this.props.participants;
  }
  get materialisedThrough(): Date | null {
    return this.props.materialisedThrough;
  }
  get createdByMemberId(): FamilyMemberId | null {
    return this.props.createdByMemberId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * FR-019 with PATCH semantics. Validates the merged result as a whole before
   * changing anything, so a rejected edit leaves the aggregate exactly as it
   * was. Any writer may edit any event — authorship grants nothing extra
   * (spec.md Assumptions).
   */
  update(patch: EventPatch, now: Date): Result<EventUpdateOutcome, DomainError> {
    const next: CalendarEventProps = { ...this.props };
    const changed = new Set<ChangedFieldGroup>();

    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (title === '') return err({ kind: 'NameRequired', reason: 'An event needs a title.' });
      if (title !== next.title) changed.add('details');
      next.title = title;
    }
    if (patch.description !== undefined) {
      const description = normaliseOptionalText(patch.description);
      if (description !== next.description) changed.add('details');
      next.description = description;
    }
    if (patch.location !== undefined) {
      const location = normaliseOptionalText(patch.location);
      if (location !== next.location) changed.add('details');
      next.location = location;
    }
    if (patch.category !== undefined) {
      if (patch.category !== next.category) changed.add('details');
      next.category = patch.category;
    }
    if (patch.attachmentRefs !== undefined) {
      const refs = [...patch.attachmentRefs];
      if (refs.join(' ') !== next.attachmentRefs.join(' ')) changed.add('details');
      next.attachmentRefs = refs;
    }

    if (patch.timing !== undefined) {
      const merged = mergeTiming(next.timing, patch.timing);
      if (!merged.ok) return merged;
      const timing = validateTiming(merged.value);
      if (!timing.ok) return timing;
      if (!sameTiming(timing.value, next.timing)) changed.add('timing');
      next.timing = timing.value;
    }
    if (patch.timeZone !== undefined) {
      const timeZone = validateTimeZone(patch.timeZone);
      if (!timeZone.ok) return timeZone;
      if (timeZone.value !== next.timeZone) changed.add('timing');
      next.timeZone = timeZone.value;
    }

    if (patch.recurrenceRule !== undefined) {
      const rule = parseRule(patch.recurrenceRule);
      if (!rule.ok) return rule;
      const before = next.recurrenceRule?.toString() ?? null;
      const after = rule.value?.toString() ?? null;
      if (before !== after) changed.add('recurrence');
      next.recurrenceRule = rule.value;
    }

    if (patch.participants !== undefined) {
      const participants = uniqueMembers(patch.participants);
      if (!sameMembers(participants, next.participants)) changed.add('participants');
      next.participants = participants;
    }

    if (changed.size > 0) {
      next.updatedAt = now;
      this.props = next;
    }

    return ok({
      changed: [...changed],
      reschedule: changed.has('timing') || changed.has('recurrence'),
    });
  }

  /** FR-021: a state change, never a deletion. Idempotent — returns whether anything changed. */
  cancel(now: Date): boolean {
    if (this.props.status === 'cancelled') return false;
    this.props = { ...this.props, status: 'cancelled', updatedAt: now };
    return true;
  }

  /** Set by the materialisation reconcile only; `null` means nothing further to materialise. */
  recordMaterialisedThrough(through: Date | null): void {
    this.props = { ...this.props, materialisedThrough: through };
  }
}
