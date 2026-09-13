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

const c = initContract();

export const familyContract = c.router(
  {},
  {
    pathPrefix: '/v1',
    commonResponses: {
      404: familyNotFoundSchema,
    },
  },
);
