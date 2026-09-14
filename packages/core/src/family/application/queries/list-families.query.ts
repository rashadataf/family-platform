import type { UserId } from '@fp/kernel';
import { capabilitiesFor, type Capability, type MemberRole } from '../../domain/capabilities.js';
import type { FamilyDirectoryPort } from '../ports/family-directory.port.js';

export interface FamilyListEntry {
  readonly familyId: string;
  readonly name: string;
  readonly role: MemberRole;
  readonly capabilities: readonly Capability[];
}

/**
 * FR-024: a user may hold a membership in more than one family — separated
 * parents, blended households — and each is tracked independently.
 *
 * Returns capabilities as well as the role, because FR-015 applies to the
 * mobile client exactly as it applies to the server: a screen that hides a
 * button asks whether the capability is held, never whether the role is
 * `owner`. Adding a role must not mean editing the app.
 */
export async function listFamilies(
  input: { userId: UserId },
  deps: { directory: FamilyDirectoryPort },
): Promise<readonly FamilyListEntry[]> {
  const memberships = await deps.directory.listMembershipsFor(input.userId);

  return memberships.map((membership) => ({
    familyId: membership.familyId,
    name: membership.name,
    role: membership.role,
    capabilities: capabilitiesFor(membership.role),
  }));
}
