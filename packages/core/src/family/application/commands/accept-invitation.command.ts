import {
  EmailAddress,
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type Result,
  type TokenGeneratorPort,
  type UserId,
} from '@fp/kernel';
import { FamilyMember } from '../../domain/family-member.aggregate.js';
import { memberAddedEvent } from '../../domain/events.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';
import type { InvitationTokenLookupPort } from '../ports/invitation-token.port.js';

export interface AcceptInvitationInput {
  token: string;
  callerUserId: UserId;
  /** The AUTHENTICATED account's own email — what FR-011's match check verifies against, never the invitation's. */
  callerEmail: string;
  newMemberId: FamilyMemberId;
  correlationId: string;
}

export interface AcceptInvitationDeps {
  tokenLookup: InvitationTokenLookupPort;
  tokenGenerator: TokenGeneratorPort;
  unitOfWork: FamilyUnitOfWorkPort;
  clock: Clock;
}

/**
 * FR-011. Resolves the invitation by token OUTSIDE `withFamilyContext` —
 * the accepting caller is not yet a member, so no `app.family_id` can be
 * derived from their standing (data-model.md's `Invitation` section,
 * `InvitationTokenLookupPort`'s own comment) — then verifies the
 * authenticated account's email before ever opening the scoped transaction
 * the invitation names.
 *
 * `AcceptInvitationRequest` carries only a token (contracts/family-api.md),
 * so the new member's display name has nothing to be given from — it is
 * derived from the account's own email local part, the only piece of
 * identifying information this flow has.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput,
  deps: AcceptInvitationDeps,
): Promise<Result<{ familyId: FamilyId; memberId: FamilyMemberId }, DomainError>> {
  const tokenHash = deps.tokenGenerator.hash(input.token);
  const invitation = await deps.tokenLookup.findByTokenHash(tokenHash);
  if (invitation === null) {
    return err({ kind: 'InvitationInvalid' });
  }

  const now = deps.clock.now();
  const callerEmail = EmailAddress.from(input.callerEmail);

  // US3 Scenario 4 / T060: a second acceptance of an already-accepted
  // invitation returns the same membership rather than an error or a
  // duplicate — checked before the liveness gate below, which an already-
  // accepted invitation would otherwise fail (`isAcceptable` requires
  // `status === 'pending'`).
  if (invitation.status === 'accepted') {
    if (invitation.acceptedByMemberId === null) {
      // Unreachable by construction (`accept()` always sets both together)
      // — not a case a client needs a distinct response for.
      return err({ kind: 'InvitationInvalid' });
    }
    if (!callerEmail.equals(invitation.email)) {
      return err({ kind: 'InvitationEmailMismatch' });
    }
    return ok({ familyId: invitation.familyId, memberId: invitation.acceptedByMemberId });
  }

  if (invitation.status !== 'pending' || invitation.isExpired(now)) {
    return err({ kind: 'InvitationInvalid' });
  }

  if (!callerEmail.equals(invitation.email)) {
    return err({ kind: 'InvitationEmailMismatch' });
  }

  return deps.unitOfWork.withFamilyContext(invitation.familyId, async (uow) => {
    const member = FamilyMember.createFromInvitation({
      id: input.newMemberId,
      familyId: invitation.familyId,
      userId: input.callerUserId,
      role: invitation.proposedRole,
      displayName: callerEmail.value.split('@')[0] ?? callerEmail.value,
      now,
    });
    if (!member.ok) return err(member.error);

    const accepted = invitation.accept(now, input.newMemberId);
    if (!accepted.ok) return err(accepted.error);

    await uow.members.save(member.value);
    await uow.invitations.save(invitation);
    await uow.outbox.append(
      memberAddedEvent({
        familyId: invitation.familyId,
        memberId: input.newMemberId,
        kind: 'adult',
        role: invitation.proposedRole,
        userId: input.callerUserId,
        correlationId: input.correlationId,
      }),
    );

    return ok({ familyId: invitation.familyId, memberId: input.newMemberId });
  });
}
