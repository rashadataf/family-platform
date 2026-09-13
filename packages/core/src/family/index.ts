// Family and Membership bounded context (spec 008, ARCHITECTURE.md §5.2).
// The tenant root: every other context scopes its data to a Family and learns
// a user's standing only through `FamilyContextPort`, never by reading these
// tables (FR-019, FR-020).
//
// Public surface re-exported here as it is built out story by story.

export {
  CAPABILITIES,
  MEMBER_KINDS,
  MEMBER_ROLES,
  capabilitiesFor,
  isEligibleGuardian,
  roleHasCapability,
  type Capability,
  type MemberKind,
  type MemberRole,
} from './domain/capabilities.js';
export {
  type FamilyUnitOfWork,
  type FamilyUnitOfWorkPort,
} from './application/ports/family-unit-of-work.port.js';
export {
  type FamilyContext,
  type FamilyContextPort,
} from './application/ports/family-context.port.js';
export { type ErasurePort } from './application/ports/erasure.port.js';
export {
  FAMILY_EVENT_TYPES,
  familyCreatedEvent,
  familyDeletionRequestedEvent,
  guardianshipEstablishedEvent,
  memberAddedEvent,
  memberRemovedEvent,
  memberRoleChangedEvent,
} from './domain/events.js';
export {
  type FamilyMemberRepository,
  type MemberStanding,
} from './application/ports/family-member.repository.js';
export { type FamilyRecord, type FamilyRepository } from './application/ports/family.repository.js';
export { resolveFamilyContext } from './application/queries/resolve-family-context.query.js';
