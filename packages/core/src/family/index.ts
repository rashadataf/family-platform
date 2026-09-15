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
export {
  type MemberVisibility,
  type MemberVisibilityPort,
} from './application/ports/member-visibility.port.js';
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
export { type FamilyRepository } from './application/ports/family.repository.js';
export { resolveFamilyContext } from './application/queries/resolve-family-context.query.js';
export { listFamilies, type FamilyListEntry } from './application/queries/list-families.query.js';
export { getFamily } from './application/queries/get-family.query.js';
export {
  createFamily,
  type CreateFamilyInput,
} from './application/commands/create-family.command.js';
export {
  updateFamily,
  type UpdateFamilyInput,
} from './application/commands/update-family.command.js';
export { addMember, type AddMemberInput } from './application/commands/add-member.command.js';
export {
  grantGuardianship,
  type GrantGuardianshipInput,
} from './application/commands/grant-guardianship.command.js';
export {
  endGuardianship,
  type EndGuardianshipInput,
} from './application/commands/end-guardianship.command.js';
export { readMember, type MemberDetail } from './application/queries/read-member.query.js';
export { listMembers, type MemberSummary } from './application/queries/list-members.query.js';
export {
  createInvitation,
  type CreateInvitationInput,
  type CreateInvitationDeps,
} from './application/commands/create-invitation.command.js';
export {
  acceptInvitation,
  type AcceptInvitationInput,
  type AcceptInvitationDeps,
} from './application/commands/accept-invitation.command.js';
export {
  revokeInvitation,
  type RevokeInvitationInput,
} from './application/commands/revoke-invitation.command.js';
export {
  listInvitations,
  type InvitationSummary,
} from './application/queries/list-invitations.query.js';
export {
  changeMemberRole,
  type ChangeMemberRoleInput,
} from './application/commands/change-member-role.command.js';
export {
  removeMember,
  type RemoveMemberInput,
} from './application/commands/remove-member.command.js';
export {
  transferOwnership,
  type TransferOwnershipInput,
} from './application/commands/transfer-ownership.command.js';
export {
  requestFamilyDeletion,
  type RequestFamilyDeletionInput,
} from './application/commands/request-family-deletion.command.js';
export {
  Invitation,
  INVITATION_STATUSES,
  type InvitationProps,
  type InvitationStatus,
  type InvitableRole,
} from './domain/invitation.aggregate.js';
export { type InvitationRepository } from './application/ports/invitation.repository.js';
export { type InvitationTokenLookupPort } from './application/ports/invitation-token.port.js';
export { Family, type FamilyProps } from './domain/family.aggregate.js';
export { FamilyMember, type FamilyMemberProps } from './domain/family-member.aggregate.js';
export {
  Guardianship,
  type GuardianshipProps,
  assertGuardianCoverage,
} from './domain/guardianship.js';
export { type GuardianshipRepository } from './application/ports/guardianship.repository.js';
export {
  HouseholdProfile,
  type HouseholdComposition,
  type HouseholdProfileProps,
} from './domain/household-profile.vo.js';
export {
  type FamilyDirectoryPort,
  type FamilyMembershipSummary,
} from './application/ports/family-directory.port.js';
