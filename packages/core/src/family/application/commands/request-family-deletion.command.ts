import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
} from '@fp/kernel';
import { familyDeletionRequestedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface RequestFamilyDeletionInput {
  familyId: FamilyId;
  requestedByMemberId: FamilyMemberId;
  correlationId: string;
}

/**
 * `DELETE /v1/families/:familyId`. Requests deletion; does not erase — the
 * verb is honest about that distinction on purpose (Principle XI). FR-023's
 * "revokes access immediately" is `resolveFamilyContext`'s own job: it
 * already returns `null` for any family whose `deletionRequestedAt` is set,
 * so nothing further is needed here for that half.
 *
 * FR-025: voids every pending invitation in the SAME transaction — this is
 * within Family and Membership's own tables, so it happens directly rather
 * than through the outbox (§7.2 applies only across a context boundary).
 */
export async function requestFamilyDeletion(
  input: RequestFamilyDeletionInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const currentFamily = await uow.families.findCurrent();
    if (currentFamily === null) {
      return err({ kind: 'NotFound' });
    }

    const alreadyRequested = currentFamily.deletionRequestedAt !== null;
    currentFamily.requestDeletion(now);
    await uow.families.save(currentFamily);

    if (!alreadyRequested) {
      const invitations = await uow.invitations.listAll();
      for (const invitation of invitations) {
        if (invitation.status === 'pending') {
          const revoked = invitation.revoke(now);
          if (revoked.ok) {
            await uow.invitations.save(invitation);
          }
        }
      }

      await uow.outbox.append(
        familyDeletionRequestedEvent({
          familyId: input.familyId,
          requestedByMemberId: input.requestedByMemberId,
          correlationId: input.correlationId,
        }),
      );
    }

    return ok(undefined);
  });
}
