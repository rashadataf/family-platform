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
