import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import { isEligibleGuardian, type MemberRole } from '../../domain/capabilities.js';
import { assertGuardianCoverage } from '../../domain/guardianship.js';
import { memberRoleChangedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface ChangeMemberRoleInput {
  familyId: FamilyId;
  memberId: FamilyMemberId;
  newRole: MemberRole;
  correlationId: string;
}

/**
 * `PATCH /v1/families/:familyId/members/:memberId/role`. `owner` is
 * unreachable through this command in both directions —
 * `FamilyMember.changeRole` refuses to set it or to change it away from it,
 * on purpose; ownership moves only through `transferOwnership`.
 *
 * FR-006/FR-008: a role change that drops eligibility (owner/adult → an
 * ineligible one — in practice only adult → extended/viewer, since `owner`
 * itself never reaches this command) means this member may no longer HOLD a
 * guardianship, not only that they are no longer eligible for a NEW one. Any
 * active guardianship of theirs ends in the SAME transaction, and the whole
 * change is refused if doing so would leave any child with none — this
 * route carries no replacement parameter, so refusing outright is the only
 * way to honour that.
 */
export async function changeMemberRole(
  input: ChangeMemberRoleInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const member = await uow.members.findById(input.memberId);
    if (!member?.isActive) {
      return err({ kind: 'NotFound' });
    }

    const fromRole = member.role;
    const losesEligibility =
      isEligibleGuardian(member.kind, fromRole) && !isEligibleGuardian(member.kind, input.newRole);

    const guardianshipsToEnd = [];
    if (losesEligibility) {
      const guardedChildIds = await uow.guardianships.listActiveChildIdsGuardedBy(member.id);
      for (const childId of guardedChildIds) {
        const remainingAfter = (await uow.guardianships.countActiveForChild(childId)) - 1;
        const coverage = assertGuardianCoverage(remainingAfter);
        if (!coverage.ok) return err(coverage.error);
      }
      for (const childId of guardedChildIds) {
        const guardianship = await uow.guardianships.findActive(member.id, childId);
        if (guardianship !== null) guardianshipsToEnd.push(guardianship);
      }
    }

    const changed = member.changeRole(input.newRole, now);
    if (!changed.ok) return err(changed.error);

    for (const guardianship of guardianshipsToEnd) {
      guardianship.end(now);
      await uow.guardianships.save(guardianship);
    }

    await uow.members.save(member);
    await uow.outbox.append(
      memberRoleChangedEvent({
        familyId: input.familyId,
        memberId: member.id,
        fromRole,
        toRole: input.newRole,
        correlationId: input.correlationId,
      }),
    );

    return ok(undefined);
  });
}
