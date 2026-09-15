import type { LocalDate } from './zoned-time.js';

/**
 * Public-holiday data, supplied by the caller (FR-013, FR-014).
 *
 * The kernel embeds no jurisdiction's calendar — a UK bank holiday list here
 * would be exactly the "UK-shaped primitive fixed into it" FR-013 forbids — and
 * the data is conceptually owned by the deferred Reference and Locale context
 * (ARCHITECTURE.md §5.11), which fills this seam later.
 *
 * A pure lookup: no I/O behind a call, because `expand` is pure and would stop
 * being so the moment a provider it called fetched something. A caller that
 * needs a remote list resolves it first and hands over the answer.
 *
 * Today `expand` accepts one and consults it for nothing: an occurrence on a
 * holiday still occurs (the spec's third clarification). SC-013's test keeps
 * that honest.
 */
export interface PublicHolidayProvider {
  isPublicHoliday(date: LocalDate): boolean;
}
