import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type GuardianshipId,
  type Result,
} from '@fp/kernel';
import { Guardianship } from '../../domain/guardianship.js';
import { guardianshipEstablishedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface GrantGuardianshipInput {
  familyId: FamilyId;
  childMemberId: FamilyMemberId;
  guardianMemberId: FamilyMemberId;
  guardianshipId: GuardianshipId;
  correlationId: string;
}

/**
 * FR-005's second half: an owner granting guardianship of an EXISTING child to
 * an additional eligible member — as opposed to `addMember`'s automatic grant
 * to the adder of a brand-new child.
 *
 * Granting an already-active pair again is treated as success, not a new
 * error type: the unique partial index (`guardianship_one_active_per_pair`)
 * would refuse the second insert at the database, and a client's retry after
 * a dropped response deserves the same membership back, not a conflict this
 * contract does not declare a type for.
 */
export async function grantGuardianship(
  input: GrantGuardianshipInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<{ guardianshipId: GuardianshipId }, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const child = await uow.members.findById(input.childMemberId);
    if (!child?.isActive || child.kind !== 'child') {
      return err({ kind: 'NotFound' });
    }

    const guardian = await uow.members.findById(input.guardianMemberId);
    if (!guardian?.isActive) {
      return err({ kind: 'NotFound' });
    }

    const existing = await uow.guardianships.findActive(guardian.id, child.id);
    if (existing !== null) {
      return ok({ guardianshipId: existing.id });
    }

    const established = Guardianship.establish({
      id: input.guardianshipId,
      familyId: input.familyId,
      guardianMemberId: guardian.id,
      guardianKind: guardian.kind,
      guardianRole: guardian.role,
      childMemberId: child.id,
      childKind: child.kind,
      now,
    });
    if (!established.ok) return err(established.error);

    await uow.guardianships.save(established.value);
    await uow.outbox.append(
      guardianshipEstablishedEvent({
        familyId: input.familyId,
        guardianMemberId: guardian.id,
        childMemberId: child.id,
        correlationId: input.correlationId,
      }),
    );

    return ok({ guardianshipId: established.value.id });
  });
}
