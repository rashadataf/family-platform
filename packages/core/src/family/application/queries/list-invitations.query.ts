import type { FamilyId } from '@fp/kernel';
import type {
  Invitation,
  InvitationStatus,
  InvitableRole,
} from '../../domain/invitation.aggregate.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

export interface InvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly proposedRole: InvitableRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

function toSummary(invitation: Invitation): InvitationSummary {
  return {
    id: invitation.id,
    email: invitation.email.value,
    proposedRole: invitation.proposedRole,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

/** `GET /v1/families/:familyId/invitations` (requires `members:manage`, the same as sending one). */
export async function listInvitations(
  input: { familyId: FamilyId },
  deps: { unitOfWork: FamilyUnitOfWorkPort },
): Promise<readonly InvitationSummary[]> {
  return deps.unitOfWork.withFamilyContext(input.familyId, async (uow) => {
    const invitations = await uow.invitations.listAll();
    return invitations.map(toSummary);
  });
}
