import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import { memberRoleChangedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface TransferOwnershipInput {
  familyId: FamilyId;
  toMemberId: FamilyMemberId;
  correlationId: string;
}

/**
 * `POST /v1/families/:familyId/ownership-transfer`. Demotion and promotion
 * in ONE transaction, never two calls (US4 Scenario 2, data-model.md) — the
 * `family_one_owner` partial unique index is what makes a moment with two
 * owners impossible, and it can only do that if both writes commit together.
 */
export async function transferOwnership(
  input: TransferOwnershipInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const newOwner = await uow.members.findById(input.toMemberId);
    if (!newOwner?.isActive) {
      return err({ kind: 'NotFound' });
    }

    const activeMembers = await uow.members.listActive();
    const currentOwner = activeMembers.find((candidate) => candidate.role === 'owner');
    if (currentOwner === undefined) {
      // Unreachable by construction (`family_one_owner` guarantees exactly
      // one exists) — not a case a client needs a distinct response for.
      return err({ kind: 'NotFound' });
    }
    if (currentOwner.id === newOwner.id) {
      return err({
        kind: 'OwnerIneligible',
        reason: 'This member already owns the family.',
      });
    }

    const promoted = newOwner.promoteToOwner(now);
    if (!promoted.ok) return err(promoted.error);

    const demoted = currentOwner.demoteFromOwnership(now);
    if (!demoted.ok) return err(demoted.error);

    // Demote before promoting: `family_one_owner` is a plain (non-deferred)
    // partial unique index, checked at each statement, not at commit. Zero
    // rows with `role = 'owner'` for a moment is fine; two never is —
    // promoting first would collide with the still-current owner's own row.
    await uow.members.save(currentOwner);
    await uow.members.save(newOwner);
    await uow.outbox.append(
      memberRoleChangedEvent({
        familyId: input.familyId,
        memberId: currentOwner.id,
        fromRole: 'owner',
        toRole: 'adult',
        correlationId: input.correlationId,
      }),
    );
    await uow.outbox.append(
      memberRoleChangedEvent({
        familyId: input.familyId,
        memberId: newOwner.id,
        fromRole: 'adult',
        toRole: 'owner',
        correlationId: input.correlationId,
      }),
    );

    return ok(undefined);
  });
}
