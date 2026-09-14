import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { problemSchema } from './identity.contract.js';

/**
 * The Family and Membership wire boundary (ADR-006,
 * specs/008-family-membership/contracts/family-api.md).
 *
 * This package imports nothing from `domain/` or `application/`
 * (`contracts-are-standalone`), so the unions below are declared here rather
 * than imported from `@fp/core` — the wire language and the domain language
 * are allowed to differ, and a shared enum would be the first edge that makes
 * them the same by accident.
 *
 * Routes are added by the user story that owns them, one at a time, rather
 * than all at once here.
 */

export const memberRoleSchema = z.enum(['owner', 'adult', 'extended', 'viewer']);

/**
 * What a client is given, and the only thing it may branch on (FR-015). Roles
 * are returned too, for display, but a client that switches on `role` is
 * making the mistake the capability indirection exists to prevent.
 */
export const capabilitySchema = z.enum([
  'family:read',
  'family:manage',
  'family:delete',
  'members:read',
  'members:add',
  'members:manage',
  'guardianship:manage',
  'billing:manage',
  'documents:read',
  'documents:write',
  'documents:write:sensitive',
  'calendar:read',
  'calendar:write',
  'tasks:read',
  'tasks:write',
]);

/**
 * A role a member can be *given*. `owner` is absent on purpose: ownership is
 * transferred through its own route, never assigned, so the wire type makes
 * the wrong call unrepresentable rather than rejecting it at runtime (FR-018).
 */
export const assignableRoleSchema = z.enum(['adult', 'extended', 'viewer']);

/**
 * A member that can be added directly, with no invitation and no login path.
 * `adult` is absent for the same reason `owner` is above: an adult joins by
 * invitation, because joining means linking a real account (FR-003, FR-014).
 */
export const directMemberKindSchema = z.enum(['child', 'extended']);

/** FR-021: one shape for "not yours" and "not there", so the two are indistinguishable. */
export const familyNotFoundSchema = problemSchema.extend({
  type: z.literal('family/not_found'),
});

/** Names the capability, never the caller's role. */
export const capabilityRequiredSchema = problemSchema.extend({
  type: z.literal('family/capability_required'),
  capability: capabilitySchema,
});

/** FR-007: a child's details need an active guardianship, whatever the role says. */
export const guardianshipRequiredSchema = problemSchema.extend({
  type: z.literal('family/guardianship_required'),
});

export const familyContextSchema = z.object({
  familyId: z.string().uuid(),
  name: z.string(),
  role: memberRoleSchema,
  capabilities: z.array(capabilitySchema),
});

export const householdCompositionSchema = z.object({
  adults: z.number().int().min(0),
  children: z.number().int().min(0),
});

/**
 * FR-001. The length bound lives here AND in the domain: this layer gives the
 * client a fast, specific rejection, and `Family.create` is what actually
 * guarantees it, because a second caller (a future import, the seed fixture)
 * does not come through the wire.
 *
 * No `.min(1)`: an empty or blank name must still reach `Family.create`, which
 * is what turns it into `422 family/name_required` with US1 Scenario 3's
 * actionable reason. A zod-level minimum would reject it first, as a generic
 * body-validation `400` with none of that.
 */
export const familyNameSchema = z.string().trim().max(120);

const familyProfileFieldsSchema = z.object({
  name: familyNameSchema,
  postcode: z.string().trim().max(20).nullish(),
  localAuthorityCode: z.string().trim().max(20).nullish(),
  composition: householdCompositionSchema.nullish(),
});

export const createFamilyRequestSchema = familyProfileFieldsSchema.extend({
  /**
   * FR-001: the owner is created in the same action as the family — there is
   * no separate "add yourself as a member" step — so unlike a child or
   * extended member's `displayName` (added directly by someone who already
   * knows them), the owner's own name can't be read off an existing member
   * row. The caller supplies it once, here, rather than this context reaching
   * into Identity for something to derive it from.
   */
  ownerDisplayName: z.string().trim().min(1).max(120),
});

/** Deliberately from the profile fields alone: `ownerDisplayName` names the owner at creation, not a thing this route can change. */
export const updateFamilyRequestSchema = familyProfileFieldsSchema.partial();

export const familySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  postcode: z.string().nullable(),
  localAuthorityCode: z.string().nullable(),
  composition: householdCompositionSchema.nullable(),
});

export const nameRequiredSchema = problemSchema.extend({
  type: z.literal('family/name_required'),
  /** US1 Scenario 3: "a specific, actionable reason", carried on the wire. */
  reason: z.string(),
});

/**
 * The domain's `MemberKind` ('adult' | 'child'), NOT `directMemberKindSchema`
 * above — that one names what a caller may ADD ('child' | 'extended'); this
 * one names what a member IS. An "extended" member is a `kind: 'adult'` with
 * `role: 'extended'`, so it never appears as a kind on the wire either.
 */
export const memberKindSchema = z.enum(['adult', 'child']);

export const addMemberRequestSchema = z.object({
  kind: directMemberKindSchema,
  // No `.min(1)`, for the same reason `familyNameSchema` above has none: an
  // empty name must reach `FamilyMember.createUnlinked`, which is what turns
  // it into `422 family/name_required` with an actionable reason, not a
  // generic `400` from body validation that never gets there.
  displayName: z.string().trim().max(120),
  /** ISO date (`YYYY-MM-DD`). Only meaningful for `kind: 'child'`. */
  dateOfBirth: z.string().nullish(),
});

/**
 * The roster shape (`GET …/members`). `dateOfBirth` is an OPTIONAL key, not a
 * nullable one: contracts/family-api.md requires the key itself absent for a
 * child the caller does not guard, so a client cannot distinguish "withheld"
 * from "never recorded".
 */
export const memberSummarySchema = z.object({
  id: z.string().uuid(),
  kind: memberKindSchema,
  role: memberRoleSchema,
  displayName: z.string().nullable(),
  dateOfBirth: z.string().nullable().optional(),
});

/** The single-member shape (`GET …/members/:memberId`) — only reachable once any guardianship gate has already passed. */
export const memberDetailSchema = z.object({
  id: z.string().uuid(),
  kind: memberKindSchema,
  role: memberRoleSchema,
  displayName: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
});

/** FR-006: guardianship offered to a member who is not an adult holding owner/adult. */
export const guardianIneligibleSchema = problemSchema.extend({
  type: z.literal('family/guardian_ineligible'),
  reason: z.string(),
});

/** FR-008, SC-006: the action would leave a child with zero active guardians. */
export const lastGuardianSchema = problemSchema.extend({
  type: z.literal('family/last_guardian'),
});

export const grantGuardianshipRequestSchema = z.object({
  guardianMemberId: z.string().uuid(),
});

export const createInvitationRequestSchema = z.object({
  email: z.string().trim().max(320),
  proposedRole: assignableRoleSchema,
});

export const invitationSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  proposedRole: assignableRoleSchema,
  status: z.enum(['pending', 'accepted', 'revoked', 'expired']),
  expiresAt: z.string(),
  createdAt: z.string(),
});

/** `AcceptInvitationRequest`: token only. The family is not a parameter (contracts/family-api.md). */
export const acceptInvitationRequestSchema = z.object({
  token: z.string().trim().min(1),
});

/** One type for unknown, revoked, and expired — distinguishing them tells a forwarded-email recipient more than they should learn. */
export const invitationInvalidSchema = problemSchema.extend({
  type: z.literal('family/invitation_invalid'),
});

/** FR-011: says the email does not match, never *which* email was invited. */
export const invitationEmailMismatchSchema = problemSchema.extend({
  type: z.literal('family/invitation_email_mismatch'),
});

/** FR-013: this email already belongs to a member of this family, or already has a pending invitation. */
export const alreadyMemberSchema = problemSchema.extend({
  type: z.literal('family/already_member'),
});

/** FR-018, SC-007: the sole owner tried to leave, be removed, or be demoted without a transfer. */
export const ownerRequiredSchema = problemSchema.extend({
  type: z.literal('family/owner_required'),
});

/** US4 Scenario 2: ownership transfer to a member who is not a linked adult. */
export const ownerIneligibleSchema = problemSchema.extend({
  type: z.literal('family/owner_ineligible'),
  reason: z.string(),
});

export const changeMemberRoleRequestSchema = z.object({
  role: assignableRoleSchema,
});

export const transferOwnershipRequestSchema = z.object({
  toMemberId: z.string().uuid(),
});

const c = initContract();

export const familyContract = c.router(
  {
    createFamily: {
      method: 'POST',
      path: '/families',
      body: createFamilyRequestSchema,
      responses: {
        201: z.object({ familyId: z.string().uuid(), ownerMemberId: z.string().uuid() }),
        422: nameRequiredSchema,
      },
      summary: 'Create a family and become its sole owner (US1, FR-001)',
    },

    listFamilies: {
      method: 'GET',
      path: '/families',
      responses: { 200: z.array(familyContextSchema) },
      summary: "The caller's own memberships, across families (FR-024)",
    },

    getFamily: {
      method: 'GET',
      path: '/families/:familyId',
      pathParams: z.object({ familyId: z.string().uuid() }),
      responses: { 200: familySchema },
      summary: 'Read one family (requires family:read)',
    },

    updateFamily: {
      method: 'PATCH',
      path: '/families/:familyId',
      pathParams: z.object({ familyId: z.string().uuid() }),
      body: updateFamilyRequestSchema,
      responses: {
        200: familySchema,
        403: capabilityRequiredSchema,
        422: nameRequiredSchema,
      },
      summary: 'Update the name or household profile (requires family:manage, FR-002)',
    },

    listMembers: {
      method: 'GET',
      path: '/families/:familyId/members',
      pathParams: z.object({ familyId: z.string().uuid() }),
      responses: {
        200: z.array(memberSummarySchema),
        403: capabilityRequiredSchema,
      },
      summary:
        'The household roster, dateOfBirth omitted for unguarded children (requires members:read, FR-007)',
    },

    addMember: {
      method: 'POST',
      path: '/families/:familyId/members',
      pathParams: z.object({ familyId: z.string().uuid() }),
      body: addMemberRequestSchema,
      responses: {
        201: z.object({ memberId: z.string().uuid() }),
        403: capabilityRequiredSchema,
        422: z.discriminatedUnion('type', [nameRequiredSchema, guardianIneligibleSchema]),
      },
      summary:
        'Add a child or extended member with no account (requires members:add, FR-003/FR-014); adding a child establishes the caller as guardian in the same action (FR-005)',
    },

    readMember: {
      method: 'GET',
      path: '/families/:familyId/members/:memberId',
      pathParams: z.object({ familyId: z.string().uuid(), memberId: z.string().uuid() }),
      responses: {
        200: memberDetailSchema,
        403: z.discriminatedUnion('type', [capabilityRequiredSchema, guardianshipRequiredSchema]),
      },
      summary:
        'One member, in full (requires members:read; a child subject also requires an active guardianship, FR-007)',
    },

    grantGuardianship: {
      method: 'POST',
      path: '/families/:familyId/members/:memberId/guardians',
      pathParams: z.object({ familyId: z.string().uuid(), memberId: z.string().uuid() }),
      body: grantGuardianshipRequestSchema,
      responses: {
        201: z.object({ guardianshipId: z.string().uuid() }),
        403: capabilityRequiredSchema,
        422: guardianIneligibleSchema,
      },
      summary:
        'Grant guardianship of an existing child to another eligible member (requires guardianship:manage, FR-005)',
    },

    endGuardianship: {
      method: 'DELETE',
      path: '/families/:familyId/members/:memberId/guardians/:guardianMemberId',
      pathParams: z.object({
        familyId: z.string().uuid(),
        memberId: z.string().uuid(),
        guardianMemberId: z.string().uuid(),
      }),
      responses: {
        200: z.object({}),
        403: capabilityRequiredSchema,
        409: lastGuardianSchema,
      },
      summary:
        'End a guardianship, refused if it would leave the child with none (requires guardianship:manage, FR-008)',
    },

    listInvitations: {
      method: 'GET',
      path: '/families/:familyId/invitations',
      pathParams: z.object({ familyId: z.string().uuid() }),
      responses: {
        200: z.array(invitationSummarySchema),
        403: capabilityRequiredSchema,
      },
      summary: "The family's own invitations (requires members:manage)",
    },

    createInvitation: {
      method: 'POST',
      path: '/families/:familyId/invitations',
      pathParams: z.object({ familyId: z.string().uuid() }),
      body: createInvitationRequestSchema,
      responses: {
        201: z.object({ invitationId: z.string().uuid() }),
        403: capabilityRequiredSchema,
        409: alreadyMemberSchema,
      },
      summary:
        'Invite an adult, extended, or viewer member by email (requires members:manage, FR-011, FR-013)',
    },

    revokeInvitation: {
      method: 'DELETE',
      path: '/families/:familyId/invitations/:invitationId',
      pathParams: z.object({ familyId: z.string().uuid(), invitationId: z.string().uuid() }),
      responses: {
        200: z.object({}),
        403: capabilityRequiredSchema,
        422: invitationInvalidSchema,
      },
      summary: 'Revoke a pending invitation (requires members:manage)',
    },

    acceptInvitation: {
      method: 'POST',
      path: '/invitations/accept',
      body: acceptInvitationRequestSchema,
      responses: {
        200: z.object({ familyId: z.string().uuid(), memberId: z.string().uuid() }),
        403: invitationEmailMismatchSchema,
        422: invitationInvalidSchema,
      },
      summary:
        'Accept an invitation by token — no :familyId, since a caller with only a token cannot name one (US3, FR-011)',
    },

    changeMemberRole: {
      method: 'PATCH',
      path: '/families/:familyId/members/:memberId/role',
      pathParams: z.object({ familyId: z.string().uuid(), memberId: z.string().uuid() }),
      body: changeMemberRoleRequestSchema,
      responses: {
        200: z.object({}),
        403: capabilityRequiredSchema,
        409: z.discriminatedUnion('type', [lastGuardianSchema, ownerRequiredSchema]),
      },
      summary: "Change a member's role — never to or from owner (requires members:manage, FR-016)",
    },

    removeMember: {
      method: 'DELETE',
      path: '/families/:familyId/members/:memberId',
      pathParams: z.object({ familyId: z.string().uuid(), memberId: z.string().uuid() }),
      responses: {
        200: z.object({}),
        403: capabilityRequiredSchema,
        409: z.discriminatedUnion('type', [lastGuardianSchema, ownerRequiredSchema]),
      },
      summary:
        'Remove a member — the sole owner cannot be removed (requires members:manage, FR-018)',
    },

    transferOwnership: {
      method: 'POST',
      path: '/families/:familyId/ownership-transfer',
      pathParams: z.object({ familyId: z.string().uuid() }),
      body: transferOwnershipRequestSchema,
      responses: {
        200: z.object({}),
        403: capabilityRequiredSchema,
        422: ownerIneligibleSchema,
      },
      summary:
        'Demote the current owner and promote another linked adult, in one transaction (requires members:manage, FR-018)',
    },

    requestFamilyDeletion: {
      method: 'DELETE',
      path: '/families/:familyId',
      pathParams: z.object({ familyId: z.string().uuid() }),
      responses: {
        // 202, not 200: the request is accepted, but nothing is erased yet
        // (quickstart.md Scenario 8) — the verb and the status both stay
        // honest about that distinction (Principle XI).
        202: z.object({}),
        403: capabilityRequiredSchema,
      },
      summary:
        'Request deletion — voids pending invitations and revokes access immediately; erasure follows later (requires family:delete, FR-023, FR-025)',
    },
  },
  {
    pathPrefix: '/v1',
    // FR-021: every route that names a family answers the same way to a caller
    // with no standing in it, so `404` is declared once for all of them rather
    // than remembered per route.
    commonResponses: {
      404: familyNotFoundSchema,
    },
  },
);
