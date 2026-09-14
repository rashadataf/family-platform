import { family } from '@fp/core';
import {
  EmailAddress,
  asFamilyId,
  asFamilyMemberId,
  asInvitationId,
  type InvitationId,
} from '@fp/kernel';
import type { TransactionClient } from '../../testing.js';
import type { Invitation as InvitationRow } from '../../generated/prisma/index.js';

export function toInvitationAggregate(row: InvitationRow): family.Invitation {
  if (row.proposedRole === 'owner') {
    // Unreachable: `invitation_role_is_not_owner` is a CHECK constraint, not
    // merely a domain rule — a row like this cannot exist. Thrown rather
    // than silently narrowed, so a defect here fails loudly instead of
    // handing back a value the type system says can't occur.
    throw new Error(`Invitation ${row.id} has proposedRole 'owner', which the schema forbids.`);
  }

  return family.Invitation.reconstitute({
    id: asInvitationId(row.id),
    familyId: asFamilyId(row.familyId),
    // Stored already-normalised (the domain normalises before every write),
    // so this is a round trip, not a second normalisation.
    email: EmailAddress.from(row.email ?? ''),
    proposedRole: row.proposedRole,
    tokenHash: Buffer.from(row.tokenHash).toString('hex'),
    status: row.status,
    expiresAt: row.expiresAt,
    invitedByMemberId: asFamilyMemberId(row.invitedByMemberId),
    acceptedByMemberId:
      row.acceptedByMemberId === null ? null : asFamilyMemberId(row.acceptedByMemberId),
    createdAt: row.createdAt,
    acceptedAt: row.acceptedAt,
    revokedAt: row.revokedAt,
  });
}

export class PrismaInvitationRepository implements family.InvitationRepository {
  constructor(private readonly tx: TransactionClient) {}

  async save(invitation: family.Invitation): Promise<void> {
    const data = {
      email: invitation.email.value,
      proposedRole: invitation.proposedRole,
      tokenHash: Buffer.from(invitation.tokenHash, 'hex'),
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      invitedByMemberId: invitation.invitedByMemberId,
      acceptedByMemberId: invitation.acceptedByMemberId,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
    };

    await this.tx.invitation.upsert({
      where: { id: invitation.id },
      create: { id: invitation.id, familyId: invitation.familyId, ...data },
      update: data,
    });
  }

  async findById(invitationId: InvitationId): Promise<family.Invitation | null> {
    const row = await this.tx.invitation.findFirst({ where: { id: invitationId } });
    return row === null ? null : toInvitationAggregate(row);
  }

  async listAll(): Promise<readonly family.Invitation[]> {
    const rows = await this.tx.invitation.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toInvitationAggregate);
  }

  async findPendingByEmail(email: string): Promise<family.Invitation | null> {
    const row = await this.tx.invitation.findFirst({
      where: { email: EmailAddress.from(email).value, status: 'pending' },
    });
    return row === null ? null : toInvitationAggregate(row);
  }
}
