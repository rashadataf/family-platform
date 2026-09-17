import type { DomainError } from '../errors.js';
import { ok, type Result } from '../result.js';
import { expand, type ExpandedOccurrence } from './expand.js';
import type { RecurrenceRule } from './rrule.vo.js';
import type { LocalDateTime } from './zoned-time.js';

const MS_PER_DAY = 86_400_000;

/**
 * How many windows to step through before concluding a rule never matches.
 * Windows double from roughly one period up to ten years, so this reaches
 * centuries past `after` — far beyond any rule that can match at all.
 */
const MAX_STEPS = 64;
const MAX_SPAN_DAYS = 3660;

export interface NextOccurrenceInput {
  readonly rule: RecurrenceRule;
  /** The SERIES anchor (RFC 5545 DTSTART), not the current instance — `COUNT` is counted from it. */
  readonly dtstart: LocalDateTime;
  readonly timeZone: string;
  /** Exclusive. An occurrence exactly at `after` is not "after" it. */
  readonly after: Date;
}

function initialSpanDays(rule: RecurrenceRule): number {
  const perPeriod = { DAILY: 2, WEEKLY: 8, MONTHLY: 32, YEARLY: 367 }[rule.freq];
  return Math.min(perPeriod * rule.interval, MAX_SPAN_DAYS);
}

/**
 * The first occurrence of a rule strictly after an instant, or `null` when the
 * rule has ended (its `COUNT` or `UNTIL`) or can never produce one.
 *
 * Spec 010 research.md §2: Tasks needs "the next scheduled date after this
 * chore was closed", and `expand` answers questions about a window. The
 * stepping loop that bridges the two has edge cases of its own — a sparse rule
 * (`FREQ=YEARLY;INTERVAL=4;BYMONTH=2;BYMONTHDAY=29`), a rule that can never
 * match (`BYMONTH=2;BYMONTHDAY=30`), a window boundary on a clock-change
 * morning — so it lives here, under the kernel's own tests, rather than being
 * written once per consuming context.
 *
 * Pure, like everything in this directory: "now" is `after`, supplied by the
 * caller.
 */
export function nextOccurrenceAfter(
  input: NextOccurrenceInput,
): Result<ExpandedOccurrence | null, DomainError> {
  let from = new Date(input.after.getTime() + 1);
  let spanDays = initialSpanDays(input.rule);

  for (let step = 0; step < MAX_STEPS; step++) {
    const to = new Date(from.getTime() + spanDays * MS_PER_DAY);
    const expansion = expand({
      rule: input.rule,
      dtstart: input.dtstart,
      timeZone: input.timeZone,
      window: { from, to },
    });
    if (!expansion.ok) return expansion;

    const first = expansion.value.occurrences[0];
    if (first !== undefined) return ok(first);
    if (expansion.value.exhausted) return ok(null);

    from = to;
    spanDays = Math.min(spanDays * 2, MAX_SPAN_DAYS);
  }

  return ok(null);
}
