import type { FamilyId, FamilyMemberId } from '@fp/kernel';
import type { MemberKind, MemberRole } from '../../domain/capabilities.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface MemberSummary {
  readonly id: FamilyMemberId;
  readonly kind: MemberKind;
  readonly role: MemberRole;
  readonly displayName: string | null;
  /**
   * `undefined` means "omit this key on the wire" — the boundary
   * contracts/family-api.md draws: omitted, never nulled, so a client cannot
   * tell "withheld" from "never recorded". `null` is a real value (an adult
   * member has no date of birth on file at all); `undefined` is the
   * guardianship gate.
   */
  readonly dateOfBirth: Date | null | undefined;
}

/**
 * `GET /v1/families/:familyId/members`. The omission happens here, not in the
 * controller — a serialization-layer filter is one refactor away from being
 * forgotten (tasks.md T054) — computed once per request via
 * `listActiveChildIdsGuardedBy` rather than one guardianship lookup per row.
 */
export async function listMembers(
  input: { familyId: FamilyId; callerMemberId: FamilyMemberId },
  deps: { unitOfWork: FamilyUnitOfWorkPort },
): Promise<readonly MemberSummary[]> {
  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const [members, guardedChildIds] = await Promise.all([
      uow.members.listActive(),
      uow.guardianships.listActiveChildIdsGuardedBy(input.callerMemberId),
    ]);
    const guarded = new Set(guardedChildIds);

    return members.map((member) => ({
      id: member.id,
      kind: member.kind,
      role: member.role,
      displayName: member.displayName,
      dateOfBirth:
        member.kind !== 'child' || guarded.has(member.id) ? member.dateOfBirth : undefined,
    }));
  });
}
