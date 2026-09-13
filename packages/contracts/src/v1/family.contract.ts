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
