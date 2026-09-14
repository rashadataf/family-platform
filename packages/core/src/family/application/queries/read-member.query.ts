import {
  err,
  ok,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type UserId,
} from '@fp/kernel';
import type { MemberKind, MemberRole } from '../../domain/capabilities.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface MemberDetail {
  readonly id: FamilyMemberId;
  readonly kind: MemberKind;
  readonly role: MemberRole;
  readonly displayName: string | null;
  readonly dateOfBirth: Date | null;
}

/**
 * `GET /v1/families/:familyId/members/:memberId`. FR-007 and FR-009 both live
 * here, not in the controller: a child subject needs an active guardianship
 * from the caller regardless of the caller's role or capabilities — "the test
 * this whole feature exists for" (tasks.md T047) — and every read of a
 * child's details is audited, granted or denied, in the same transaction as
 * the read that decided the outcome.
 *
 * An adult or extended subject is never audited here: FR-009 names child
 * records specifically, and auditing every roster lookup would drown the
 * signal the log exists to carry.
 */
export async function readMember(
  input: {
    familyId: FamilyId;
    memberId: FamilyMemberId;
    callerMemberId: FamilyMemberId;
    callerUserId: UserId | null;
    correlationId: string;
  },
  deps: { unitOfWork: FamilyUnitOfWorkPort },
): Promise<Result<MemberDetail, DomainError>> {
  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const member = await uow.members.findById(input.memberId);
    if (!member?.isActive) {
      return err({ kind: 'NotFound' });
    }

    if (member.kind === 'child') {
      const guardianship = await uow.guardianships.findActive(input.callerMemberId, member.id);
      const granted = guardianship !== null;

      await uow.audit.append({
        actorUserId: input.callerUserId,
        actorMemberId: input.callerMemberId,
        familyId: input.familyId,
        subjectType: 'family_member',
        subjectId: member.id,
        action: 'child_record.read',
        purpose: 'member detail view',
        result: granted ? 'granted' : 'denied',
        reason: granted ? null : 'caller holds no active guardianship for this child (FR-007)',
        correlationId: input.correlationId,
      });

      if (!granted) {
        return err({ kind: 'GuardianshipRequired' });
      }
    }

    return ok({
      id: member.id,
      kind: member.kind,
      role: member.role,
      displayName: member.displayName,
      dateOfBirth: member.dateOfBirth,
    });
  });
}
