import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import { assertGuardianCoverage } from '../../domain/guardianship.js';
import { memberRemovedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface RemoveMemberInput {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  correlationId: string;
}

/**
 * `DELETE /v1/families/:familyId/members/:memberId`. FR-018: the sole owner
 * cannot be removed — reserved for `transferOwnership`, the only path that
 * ever changes who holds that role.
 *
 * FR-008: removing a guardian's membership ends their active guardianships
 * in the same transaction, refused outright if that would leave any child
 * with none — this route carries no replacement parameter either.
 */
export async function removeMember(
  input: RemoveMemberInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const member = await uow.members.findById(input.memberId);
    if (!member?.isActive) {
      return err({ kind: 'NotFound' });
    }
    if (member.role === 'owner') {
      return err({
        kind: 'OwnerRequired',
        reason: 'The sole owner cannot be removed — transfer ownership first.',
      });
    }

    const guardedChildIds = await uow.guardianships.listActiveChildIdsGuardedBy(member.id);
    for (const childId of guardedChildIds) {
      const remainingAfter = (await uow.guardianships.countActiveForChild(childId)) - 1;
      const coverage = assertGuardianCoverage(remainingAfter);
      if (!coverage.ok) return err(coverage.error);
    }
    const guardianshipsToEnd = [];
    for (const childId of guardedChildIds) {
      const guardianship = await uow.guardianships.findActive(member.id, childId);
      if (guardianship !== null) guardianshipsToEnd.push(guardianship);
    }

    const hadUserId = member.userId !== null;
    member.remove(now);

    for (const guardianship of guardianshipsToEnd) {
      guardianship.end(now);
      await uow.guardianships.save(guardianship);
    }

    await uow.members.save(member);
    await uow.outbox.append(
      memberRemovedEvent({
        familyId: input.familyId,
        memberId: member.id,
        hadUserId,
        correlationId: input.correlationId,
      }),
    );

    return ok(undefined);
  });
}
