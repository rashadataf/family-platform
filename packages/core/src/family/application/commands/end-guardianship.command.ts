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
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface EndGuardianshipInput {
  familyId: FamilyId;
  childMemberId: FamilyMemberId;
  guardianMemberId: FamilyMemberId;
}

/**
 * `DELETE /v1/families/:familyId/members/:memberId/guardians/:guardianMemberId`.
 *
 * FR-008: this route names no replacement, so the only way it can satisfy
 * "never leave a child with zero guardians" is to refuse outright when this
 * is the child's last one. A caller who wants to swap the sole guardian
 * grants the replacement first (`grantGuardianship`), then ends this one —
 * two calls, never a state in between with zero.
 *
 * No event: `FAMILY_EVENT_TYPES` publishes `GuardianshipEstablished` but no
 * corresponding "ended" event, the same reason `updateFamily` publishes none —
 * inventing one for a feature with no subscriber would be adding to a
 * published catalogue for this call's convenience alone.
 */
export async function endGuardianship(
  input: EndGuardianshipInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const guardianship = await uow.guardianships.findActive(
      input.guardianMemberId,
      input.childMemberId,
    );
    if (guardianship === null) {
      return err({ kind: 'NotFound' });
    }

    const remainingAfter = (await uow.guardianships.countActiveForChild(input.childMemberId)) - 1;
    const coverage = assertGuardianCoverage(remainingAfter);
    if (!coverage.ok) return err(coverage.error);

    guardianship.end(now);
    await uow.guardianships.save(guardianship);

    return ok(undefined);
  });
}
