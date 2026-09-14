import {
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type InvitationId,
  type Result,
} from '@fp/kernel';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface RevokeInvitationInput {
  familyId: FamilyId;
  invitationId: InvitationId;
}

/** No event: revocation is this context's own housekeeping, not one of ARCHITECTURE §5.2's six. */
export async function revokeInvitation(
  input: RevokeInvitationInput,
  deps: { unitOfWork: FamilyUnitOfWorkPort; clock: Clock },
): Promise<Result<void, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const invitation = await uow.invitations.findById(input.invitationId);
    if (invitation === null) return err({ kind: 'NotFound' });

    const revoked = invitation.revoke(now);
    if (!revoked.ok) return err(revoked.error);

    await uow.invitations.save(invitation);
    return ok(undefined);
  });
}
