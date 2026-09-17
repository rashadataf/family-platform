import { asFamilyId, asTaskId, type FamilyId, type TaskId } from '@fp/kernel';
import { prisma } from '../../client.js';

export interface OverdueCandidate {
  readonly taskId: TaskId;
  readonly familyId: FamilyId;
}

/**
 * The overdue sweep's cross-family DISCOVERY read (spec 010 research.md §5).
 * One read-only transaction with `app.is_sweep` set — the gate
 * `task_sweep_select` opens on — returning identifiers only. The predicate is
 * the `task_overdue_unreported_idx` partial index's own, so the read is
 * proportional to outstanding work, not to history. Every write the sweep then
 * makes goes through `withTasksFamilyContext`, one task per transaction, where
 * the predicate is checked again under the row lock.
 */
export async function findTasksNeedingOverdueReport(
  now: Date,
): Promise<readonly OverdueCandidate[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.$queryRaw<{ id: string; family_id: string }[]>`
      SELECT "id", "family_id" FROM "task"
      WHERE "status" = 'open'
        AND "due_at" IS NOT NULL
        AND "overdue_reported_for" IS DISTINCT FROM "due_at"
        AND "due_at" <= ${now}
      ORDER BY "due_at" ASC
    `;
    return rows.map((row) => ({
      taskId: asTaskId(row.id),
      familyId: asFamilyId(row.family_id),
    }));
  });
}

/**
 * FR-028: how far behind overdue detection is — `now − min(due_at)` over tasks
 * that are overdue and still unreported. `0` when nothing is outstanding. Read
 * AFTER a pass, so it reports what the sweep could not fix.
 */
export async function measureOverdueLag(now: Date): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.is_sweep', 'true', true)`;
    const rows = await tx.$queryRaw<{ oldest_due_at: Date | null }[]>`
      SELECT min("due_at") AS "oldest_due_at" FROM "task"
      WHERE "status" = 'open'
        AND "due_at" IS NOT NULL
        AND "overdue_reported_for" IS DISTINCT FROM "due_at"
        AND "due_at" <= ${now}
    `;
    const oldest = rows[0]?.oldest_due_at ?? null;
    return oldest === null ? 0 : Math.max(0, Math.round((now.getTime() - oldest.getTime()) / 1000));
  });
}
