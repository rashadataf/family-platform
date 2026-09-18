/**
 * DI tokens for the ports `packages/core/tasks`'s handlers depend on.
 *
 * `TASKS_UNIT_OF_WORK` is the only door to Tasks' tables; every repository
 * behind it is built per transaction, carrying `app.family_id` (ADR-017).
 * `TASKS_MEMBER_VISIBILITY` is Family's second published port, the only way
 * this module learns who a reader may see (FR-014, FR-030) — a separate token
 * from Calendar's so neither module can be wired through the other's provider.
 */
export const TASKS_UNIT_OF_WORK = Symbol('TASKS_UNIT_OF_WORK');
export const TASKS_CLOCK = Symbol('TASKS_CLOCK');
export const TASKS_MEMBER_VISIBILITY = Symbol('TASKS_MEMBER_VISIBILITY');
export const TASKS_IDEMPOTENCY_STORE = Symbol('TASKS_IDEMPOTENCY_STORE');
