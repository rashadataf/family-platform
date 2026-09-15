/**
 * DI tokens for the ports `packages/core/calendar`'s handlers depend on.
 *
 * `CALENDAR_UNIT_OF_WORK` is the only door to Calendar's tables; every
 * repository behind it is built per transaction, carrying `app.family_id`
 * (ADR-017). `MEMBER_VISIBILITY` is Family's second published port, the only
 * way this module learns who a reader may see (FR-016, FR-027).
 */
export const CALENDAR_UNIT_OF_WORK = Symbol('CALENDAR_UNIT_OF_WORK');
export const CALENDAR_CLOCK = Symbol('CALENDAR_CLOCK');
export const MEMBER_VISIBILITY = Symbol('MEMBER_VISIBILITY');
export const CALENDAR_IDEMPOTENCY_STORE = Symbol('CALENDAR_IDEMPOTENCY_STORE');
