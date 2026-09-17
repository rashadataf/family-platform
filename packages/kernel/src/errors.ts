import type { SessionId } from './branded-id.js';

/**
 * The domain error taxonomy shared across contexts. Each context's
 * application layer returns one of these as a `Result` error rather than
 * throwing an arbitrary `Error`, so a caller can exhaustively switch on
 * `error.kind` (Principle I: discriminated unions over
 * optional-field-plus-type-string modelling). Construct these as plain
 * object literals at the call site — the discriminant alone gives full type
 * checking with no helper or cast needed.
 */
export type DomainError =
  | { readonly kind: 'EmailAlreadyRegistered' }
  | { readonly kind: 'WeakPassword'; readonly reason: string }
  | { readonly kind: 'InvalidCredentials' }
  | { readonly kind: 'AccountNotVerified' }
  | { readonly kind: 'Throttled'; readonly retryAfterSeconds: number }
  | { readonly kind: 'SessionInvalid' }
  /**
   * FR-011: a superseded credential was presented. Wire-visible behaviour is
   * identical to `SessionInvalid` (contracts/identity-api.md: the caller is
   * never told a replay was detected) — this exists only so the composition
   * root can log or alert on it distinctly from an ordinary invalid session.
   */
  | { readonly kind: 'SessionReplayDetected'; readonly sessionId: SessionId }
  | { readonly kind: 'VerificationInvalid' }
  /**
   * Family and Membership (spec 008). One kind per error type in that
   * feature's contract, so the controller's mapping from domain failure to
   * wire response is exhaustive by the compiler rather than by review.
   *
   * `NotFound` below is deliberately reused for every cross-family access
   * rather than given a family-specific kind: FR-021 requires a caller with
   * no standing to be unable to distinguish "not yours" from "does not
   * exist", and the cheapest way to keep that true is for the domain not to
   * produce a distinguishable value in the first place. The audit log records
   * which it really was.
   */
  | { readonly kind: 'CapabilityRequired'; readonly capability: string }
  | { readonly kind: 'GuardianshipRequired' }
  | { readonly kind: 'GuardianIneligible'; readonly reason: string }
  | { readonly kind: 'LastGuardian' }
  | { readonly kind: 'OwnerRequired' }
  | { readonly kind: 'OwnerIneligible'; readonly reason: string }
  | { readonly kind: 'AlreadyMember' }
  | { readonly kind: 'InvitationInvalid' }
  | { readonly kind: 'InvitationEmailMismatch' }
  | { readonly kind: 'NameRequired'; readonly reason: string }
  | { readonly kind: 'NotFound' }
  /**
   * Calendar (spec 009). `CapabilityRequired` and `NotFound` above are reused
   * as they are: FR-028's non-disclosure rule is exactly the reasoning
   * `NotFound`'s comment already gives, one context over, and a hidden child
   * event (FR-016) collapses into the same kind for the same reason.
   *
   * The recurrence kinds live here rather than in `recurrence/` because the
   * shared kernel returns them and Tasks will map them to its own wire types —
   * a kind declared inside Calendar would be a Calendar import in Tasks.
   */
  | { readonly kind: 'InvalidTimeRange'; readonly reason: string }
  | { readonly kind: 'UnknownTimeZone'; readonly timeZone: string }
  | { readonly kind: 'RecurrenceInvalid'; readonly reason: string }
  /** Well-formed RFC 5545, outside the declared subset. `part` names the offending keyword. */
  | { readonly kind: 'RecurrenceUnsupported'; readonly part: string }
  | { readonly kind: 'RecurrenceTooDense'; readonly limit: number }
  | { readonly kind: 'RangeTooWide'; readonly maxDays: number }
  | { readonly kind: 'OccurrenceNotMovable' }
  /** FR-018. Carries nothing about the member: whether they exist elsewhere is not disclosed. */
  | { readonly kind: 'ParticipantInvalid' }
  /**
   * Tasks (spec 010). `NotFound`, `CapabilityRequired`, `NameRequired`,
   * `UnknownTimeZone`, `RecurrenceInvalid`, `RecurrenceUnsupported` and
   * `RangeTooWide` above are reused unchanged.
   */
  /** A due date or time that is not a real calendar value. `field` names which. */
  | { readonly kind: 'InvalidDue'; readonly field: string; readonly reason: string }
  /** FR-017: a rule needs a date to recur from. */
  | { readonly kind: 'RecurrenceRequiresDue' }
  /** FR-016. Like `ParticipantInvalid`, carries nothing about the member. */
  | { readonly kind: 'AssigneeInvalid' }
  /** FR-008: not permitted from the task's current status. */
  | { readonly kind: 'InvalidTransition'; readonly from: string; readonly command: string }
  /** FR-011: the caller's `expectedVersion` is stale. Carries the current version and nothing else. */
  | { readonly kind: 'VersionConflict'; readonly currentVersion: number };
