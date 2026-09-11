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
