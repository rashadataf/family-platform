import {
  EmailAddress,
  err,
  ok,
  type Clock,
  type DomainError,
  type FamilyId,
  type FamilyMemberId,
  type InvitationId,
  type MailerPort,
  type Result,
  type TokenGeneratorPort,
  type UserId,
} from '@fp/kernel';
import type { MemberRole } from '../../domain/capabilities.js';
import { Invitation } from '../../domain/invitation.aggregate.js';
import type { FamilyUnitOfWorkPort } from '../ports/family-unit-of-work.port.js';

/** research.md §8: long enough to survive a holiday, short enough that a forwarded old email is not a live door. */
const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface CreateInvitationInput {
  familyId: FamilyId;
  invitationId: InvitationId;
  invitedByMemberId: FamilyMemberId;
  email: string;
  proposedRole: MemberRole;
  /**
   * Resolved by the composition root via `identity.resolveUserIdByEmail`
   * before this command runs — `packages/core/family` never imports
   * `packages/core/identity`. `null` when no account answers to this email
   * yet, which is the ordinary "no account" invitation path (FR-011).
   */
  existingUserId: UserId | null;
  correlationId: string;
}

export interface CreateInvitationDeps {
  unitOfWork: FamilyUnitOfWorkPort;
  tokenGenerator: TokenGeneratorPort;
  mailer: MailerPort;
  clock: Clock;
}

/**
 * FR-011, FR-013. No outbox event: none of ARCHITECTURE §5.2's six events
 * covers "invitation created" — the same reasoning `updateFamily` gives for
 * publishing none of its own.
 */
export async function createInvitation(
  input: CreateInvitationInput,
  deps: CreateInvitationDeps,
): Promise<Result<{ invitationId: InvitationId }, DomainError>> {
  const now = deps.clock.now();
  const email = EmailAddress.from(input.email);
  const rawToken = deps.tokenGenerator.generate();
  const tokenHash = deps.tokenGenerator.hash(rawToken);

  const created = Invitation.create({
    id: input.invitationId,
    familyId: input.familyId,
    email,
    proposedRole: input.proposedRole,
    tokenHash,
    invitedByMemberId: input.invitedByMemberId,
    now,
    ttlMs: INVITATION_TTL_MS,
  });
  if (!created.ok) return err(created.error);
  const invitation = created.value;

  let familyName = '';
  const outcome = await deps.unitOfWork.withFamilyContext(
    input.familyId,
    async (uow): Promise<Result<{ invitationId: InvitationId }, DomainError>> => {
      const currentFamily = await uow.families.findCurrent();
      if (currentFamily === null) return err({ kind: 'NotFound' });
      familyName = currentFamily.name;

      // FR-013: the email already belongs to a linked member of this family.
      if (input.existingUserId !== null) {
        const standing = await uow.members.findStandingByUserId(input.existingUserId);
        if (standing !== null) return err({ kind: 'AlreadyMember' });
      }

      // FR-013's other half: a redundant pending invitation. The partial
      // unique index (`invitation_one_pending_per_email`) catches the
      // concurrent case this read cannot.
      const existingPending = await uow.invitations.findPendingByEmail(email.value);
      if (existingPending !== null) return err({ kind: 'AlreadyMember' });

      await uow.invitations.save(invitation);
      return ok({ invitationId: input.invitationId });
    },
  );

  if (!outcome.ok) return outcome;

  // Sent after the transaction commits, deliberately (the same reasoning
  // `registerUser` gives): mail delivery is not transactional, and a
  // failure here must not roll back a successful invitation.
  await deps.mailer.send({
    to: email.value,
    subject: `You've been invited to join ${familyName} on Family Platform`,
    text: `Invitation token: ${rawToken}`,
  });

  return outcome;
}
