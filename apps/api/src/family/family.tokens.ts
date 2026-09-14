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

/**
 * The one cross-family read (FR-024, "which families am I in?"), kept
 * separate from `FAMILY_UNIT_OF_WORK` because it is scoped by user, not by
 * family — see `FamilyDirectoryPort`'s own doc comment.
 */
export const FAMILY_DIRECTORY = Symbol('FAMILY_DIRECTORY');

/** ADR-006, Principle IX: the store behind `POST /v1/families`'s `Idempotency-Key` handling. */
export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/**
 * The second and last unscoped read (FR-011, "which invitation does this
 * token belong to"), kept separate from `FAMILY_UNIT_OF_WORK` for the same
 * reason `FAMILY_DIRECTORY` is: it runs outside `withFamilyContext`.
 */
export const FAMILY_INVITATION_TOKEN_LOOKUP = Symbol('FAMILY_INVITATION_TOKEN_LOOKUP');
