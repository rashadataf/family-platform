import { err, ok, type DomainError, type Result } from '@fp/kernel';
import {
  addDays,
  isValidTimeZone,
  localToInstant,
  parseLocalDate,
  startOfDay,
  type LocalDate,
  type LocalDateTime,
} from '@fp/kernel/recurrence';

export interface LocalTime {
  readonly hour: number;
  readonly minute: number;
}

/**
 * When a task is due, as a discriminated union (Principle I, data-model.md).
 * "No due date" is the absence of a `Due`, not a third arm, so a caller can
 * never hold a zone without a date. A time without a zone is unrepresentable
 * here, on the wire, and in the `task_due_shape` CHECK.
 */
export type Due =
  | { readonly kind: 'date'; readonly date: LocalDate; readonly timeZone: string }
  | {
      readonly kind: 'date_time';
      readonly date: LocalDate;
      readonly time: LocalTime;
      readonly timeZone: string;
    };

export type DueKind = Due['kind'];

/** The wire's strings, before they are calendar values. */
export type DueInput =
  | { readonly kind: 'date'; readonly date: string; readonly timeZone: string }
  | {
      readonly kind: 'date_time';
      readonly date: string;
      readonly time: string;
      readonly timeZone: string;
    };

export function parseLocalTime(value: string): LocalTime | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function formatLocalTime(time: LocalTime): string {
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
}

/**
 * FR-002. Parses and validates, naming the field that is wrong: `2026-02-30`
 * and `25:00` are refused as `InvalidDue`, an unrecognised zone as
 * `UnknownTimeZone` — never defaulted.
 */
export function parseDue(input: DueInput): Result<Due, DomainError> {
  if (!isValidTimeZone(input.timeZone)) {
    return err({ kind: 'UnknownTimeZone', timeZone: input.timeZone });
  }
  const date = parseLocalDate(input.date);
  if (date === null) {
    return err({ kind: 'InvalidDue', field: 'date', reason: 'Not a calendar date (YYYY-MM-DD).' });
  }
  if (input.kind === 'date') return ok({ kind: 'date', date, timeZone: input.timeZone });

  const time = parseLocalTime(input.time);
  if (time === null) {
    return err({ kind: 'InvalidDue', field: 'time', reason: 'Not a time of day (HH:mm).' });
  }
  return ok({ kind: 'date_time', date, time, timeZone: input.timeZone });
}

/**
 * The due MOMENT (FR-003, research.md §4). A date-only due is due by the end of
 * that date where it was authored — the start of the next local day — so a task
 * due "on the 16th" is not overdue until the 16th is over in London. A timed
 * due resolves through the kernel, which owns the clock-change rule.
 */
export function dueMomentOf(due: Due): Date {
  if (due.kind === 'date') return startOfDay(addDays(due.date, 1), due.timeZone);
  return localToInstant({ ...due.date, ...due.time, second: 0 }, due.timeZone);
}

/** The local reading a recurrence rule is anchored at: midnight for a date-only due. */
export function dueLocalDateTime(due: Due): LocalDateTime {
  if (due.kind === 'date') return { ...due.date, hour: 0, minute: 0, second: 0 };
  return { ...due.date, ...due.time, second: 0 };
}

export function sameDue(a: Due | null, b: Due | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    dueMomentOf(a).getTime() === dueMomentOf(b).getTime() &&
    a.kind === b.kind &&
    a.timeZone === b.timeZone
  );
}
