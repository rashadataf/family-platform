/**
 * DI tokens for the ports `packages/core/family`'s handlers depend on.
 *
 * `FAMILY_UNIT_OF_WORK` is the only door to family-scoped data: every
 * repository is constructed inside its per-call transaction, which is what
 * carries `app.family_id` (ADR-017). None of them is a process-lifetime
 * singleton, so none of them has a token here.
 *
 * `AUDIT_LOG` is separate and standalone because a denial has no transaction
 * to join — nothing was written, that is what makes it a denial.
 */
export const FAMILY_UNIT_OF_WORK = Symbol('FAMILY_UNIT_OF_WORK');
export const AUDIT_LOG = Symbol('AUDIT_LOG');
export const FAMILY_CLOCK = Symbol('FAMILY_CLOCK');
