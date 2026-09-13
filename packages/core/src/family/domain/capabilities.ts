/**
 * Roles are coarse; capabilities are what code checks (ARCHITECTURE.md §5.2).
 *
 * The point of the indirection is stated in the architecture document and is
 * worth repeating where the map actually lives: "adding a role must never
 * require editing authorization logic scattered across contexts." Every
 * authorization decision in this system asks whether a capability is held.
 * None of them may ask what the role is — spec 008 FR-015, and a test
 * (`no-role-strings.spec.ts`) asserts it of `apps/api` mechanically.
 */

/** The four roles of ARCHITECTURE.md §5.2. `child` is deliberately not one of them — see `MemberKind`. */
export const MEMBER_ROLES = ['owner', 'adult', 'extended', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/**
 * Orthogonal to `MemberRole`, and the reason a child is not a fifth role: a
 * role answers "what may this person do", and a child has no login path
 * through which to do anything. ARCHITECTURE.md §9 words it as a member
 * "marked as a child" — a mark, not a role (spec 008 research.md §5).
 */
export const MEMBER_KINDS = ['adult', 'child'] as const;
export type MemberKind = (typeof MEMBER_KINDS)[number];

/**
 * The full catalogue. Capabilities naming contexts that do not exist yet
 * (`documents:*`, `calendar:*`, `tasks:*`, `billing:manage`) are issued now
 * and consumed later — that is FR-015's requirement and §5.2's stated
 * purpose. A context added later reads strings already being issued rather
 * than forcing every member's standing to be recomputed.
 */
export const CAPABILITIES = [
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
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * `members:add` (owner, adult) is adding a person who has no login path — a
 * child or an extended member, spec 008 US2 and US4. `members:manage` (owner
 * alone) is anything that changes who can *reach* the family: inviting,
 * revoking, changing a role, removing a member, transferring ownership. Two
 * capabilities rather than one because US2 lets an adult add a child while
 * US3 and US5 reserve access changes to the owner.
 */
const CAPABILITIES_BY_ROLE: Readonly<Record<MemberRole, readonly Capability[]>> = {
  owner: [
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
  ],
  adult: [
    'family:read',
    'family:manage',
    'members:read',
    'members:add',
    'documents:read',
    'documents:write',
    'documents:write:sensitive',
    'calendar:read',
    'calendar:write',
    'tasks:read',
    'tasks:write',
  ],
  extended: [
    'family:read',
    'members:read',
    'documents:read',
    'documents:write',
    'calendar:read',
    'calendar:write',
    'tasks:read',
    'tasks:write',
  ],
  viewer: ['family:read', 'members:read', 'documents:read', 'calendar:read', 'tasks:read'],
};

/** Pure. No I/O, no clock, no randomness — the whole authorization vocabulary resolves in memory. */
export function capabilitiesFor(role: MemberRole): readonly Capability[] {
  return CAPABILITIES_BY_ROLE[role];
}

export function roleHasCapability(role: MemberRole, capability: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(capability);
}

/**
 * Guardianship eligibility (FR-006), resolved from the clarification recorded
 * in spec.md: owner and adult only. Extended and viewer members can never
 * hold a guardianship relationship, whatever else they can reach.
 *
 * This is deliberately *not* a capability. `guardianship:manage` says who may
 * grant a guardianship; this says who may be granted one. Conflating them
 * would let the owner-only grant capability imply owner-only guardians, which
 * is wrong in both directions.
 */
export function isEligibleGuardian(kind: MemberKind, role: MemberRole): boolean {
  return kind === 'adult' && (role === 'owner' || role === 'adult');
}
