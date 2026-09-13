import { prisma } from '../../client.js';

export interface UncoveredChild {
  readonly childMemberId: string;
  readonly familyId: string;
}

/**
 * SC-006, research.md §6. A genuinely cross-family read: every mutating path
 * that could leave a child with zero active guardians already refuses to
 * (its own integration test proves it, per family), so a healthy system
 * always finds nothing here — this is what turns that "should" into
 * something checked, across every family in one query.
 *
 * Binds `app.is_sweep` for one transaction, the same gate the
 * invitation-expiry sweep already introduced — reused rather than
 * duplicated, since both are "this connection is a background sweep,"
 * not two different claims.
 */
export async function findChildrenWithoutGuardian(): Promise<readonly UncoveredChild[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.$queryRaw<{ child_member_id: string; family_id: string }[]>`
      SELECT fm.id AS child_member_id, fm.family_id
      FROM family_member fm
      WHERE fm.kind = 'child'
        AND fm.removed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM guardianship g
          WHERE g.child_member_id = fm.id AND g.ended_at IS NULL
        )
    `;
    return rows.map((row) => ({ childMemberId: row.child_member_id, familyId: row.family_id }));
  });
}
