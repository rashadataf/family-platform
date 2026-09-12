import { prisma } from '../../client.js';

/**
 * FR-020. Cascades to each deleted user's `session`, `device` and
 * `email_verification` rows via the schema's `onDelete: Cascade`
 * (data-model.md) — no separate cleanup needed for those.
 */
export async function deleteUnverifiedRegistrationsBefore(cutoff: Date): Promise<number> {
  const { count } = await prisma.user.deleteMany({
    where: { status: 'pending_verification', createdAt: { lt: cutoff } },
  });
  return count;
}

/**
 * FR-019. Cascades the same way `deleteUnverifiedRegistrationsBefore` does —
 * sessions, devices and verification rows all disappear with the user row.
 * `outbox_event` rows are untouched by design (no foreign key to `user`):
 * they carry only identifiers and must survive the account they reference.
 */
export async function deleteDeletedAccountsBefore(cutoff: Date): Promise<number> {
  const { count } = await prisma.user.deleteMany({
    where: { status: 'deletion_requested', deletionRequestedAt: { lt: cutoff } },
  });
  return count;
}

/** spec.md Personal Data §5: independent of the owning account's own status. */
export async function deleteStaleSessionsBefore(cutoff: Date): Promise<number> {
  const { count } = await prisma.session.deleteMany({
    where: { OR: [{ revokedAt: { lt: cutoff } }, { absoluteExpiresAt: { lt: cutoff } }] },
  });
  return count;
}
