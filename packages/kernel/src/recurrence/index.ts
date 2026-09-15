// `@fp/kernel/recurrence` — the only shared kernel in the system
// (ARCHITECTURE.md §5.4, spec 009 research.md §2).
//
// A subpath rather than part of the root export, so `import { ok } from
// '@fp/kernel'` never drags an RRULE engine along, and the shared-kernel
// boundary is visible in the import statement itself. Calendar consumes it
// today and Tasks will consume it unchanged: nothing here may import from a
// bounded context, touch I/O, read a clock or draw a random number.

export {
  RecurrenceRule,
  FREQUENCIES,
  WEEKDAYS,
  type ByDay,
  type Frequency,
  type RecurrenceRuleProps,
  type Until,
  type Weekday,
} from './rrule.vo.js';
export {
  expand,
  MAX_OCCURRENCES,
  type ExpandInput,
  type ExpandedOccurrence,
  type Expansion,
} from './expand.js';
export { type PublicHolidayProvider } from './public-holiday.port.js';
export {
  addDays,
  compareLocalDates,
  compareLocalDateTimes,
  daysInMonth,
  formatLocalDate,
  fromEpochDay,
  instantToLocal,
  isValidTimeZone,
  localToInstant,
  offsetMinutesAt,
  parseLocalDate,
  startOfDay,
  toEpochDay,
  type LocalDate,
  type LocalDateTime,
} from './zoned-time.js';
