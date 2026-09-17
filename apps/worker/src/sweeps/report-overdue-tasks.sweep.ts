import { randomUUID } from 'node:crypto';
import { tasks } from '@fp/core';
import type { Clock, TaskId } from '@fp/kernel';
import {
  createTasksUnitOfWork,
  findTasksNeedingOverdueReport,
  measureOverdueLag,
} from '@fp/persistence';

/**
 * SC-012 promises overdue detection within five minutes; the sweep's cadence is
 * 60 s (research.md §6), so a healthy pass leaves a lag of at most one cadence.
 * Five minutes is therefore the point at which the lag means the sweep is not
 * running or is failing, rather than merely being between ticks.
 */
export const OVERDUE_LAG_ALERT_SECONDS = 300;

export interface OverdueSweepResult {
  readonly reported: number;
  /** Completed, cancelled or re-dated between discovery and write (FR-027). */
  readonly skipped: number;
  readonly failed: readonly TaskId[];
  /** `now − min(due_at)` over rows still outstanding AFTER the pass, in seconds (FR-028). */
  readonly lagSeconds: number;
}

/**
 * A seam for interrupting a pass, used only by
 * `report-overdue-tasks.sweep.integration.spec.ts`.
 *
 * "Safe to interrupt and re-run" is the property this sweep exists to have
 * (research.md §5), and it is not a property a test can demonstrate without
 * actually interrupting a pass partway. Production callers pass nothing.
 */
export interface OverdueSweepHooks {
  afterTask?(taskId: TaskId, index: number): void | Promise<void>;
}

/**
 * FR-026–FR-028, User Story 5: overdue tasks get noticed with nobody looking.
 *
 * Discovery is one cross-family read-only transaction; each write is its own
 * family-scoped transaction for a single task, so one bad task fails alone and
 * the rest of the pass still runs. Re-running after an interruption reports
 * nothing twice, because idempotence is the `overdue_reported_for = due_at`
 * marker rather than anything this function remembers.
 *
 * The lag is measured AFTER the pass, so what it reports is what the sweep
 * could not fix — a structured `ALERT` line, the platform's convention with no
 * metrics pipeline yet. Identifiers and numbers only, never a title (SC-011).
 */
export async function runReportOverdueTasksSweep(
  clock: Clock,
  hooks: OverdueSweepHooks = {},
): Promise<OverdueSweepResult> {
  const unitOfWork = createTasksUnitOfWork();
  const correlationId = randomUUID();
  const now = clock.now();

  let reported = 0;
  let skipped = 0;
  const failed: TaskId[] = [];

  const candidates = await findTasksNeedingOverdueReport(now);

  for (const [index, candidate] of candidates.entries()) {
    const startedAt = performance.now();
    try {
      const outcome = await tasks.reportOverdue(
        { familyId: candidate.familyId, taskId: candidate.taskId, correlationId },
        { unitOfWork, clock },
      );
      if (outcome === 'reported') reported += 1;
      else skipped += 1;
    } catch (error) {
      // Collected, never thrown: the next task still gets its chance.
      failed.push(candidate.taskId);
      console.error(
        `overdue report failed task=${candidate.taskId} [correlationId=${correlationId}]`,
        error instanceof Error ? error.name : 'unknown error',
      );
    } finally {
      // `tasks_overdue_report_duration` — research.md §11's 20 ms per-task budget.
      console.log(
        `tasks_overdue_report_duration_ms=${(performance.now() - startedAt).toFixed(1)} task=${candidate.taskId}`,
      );
    }

    await hooks.afterTask?.(candidate.taskId, index);
  }

  const lagSeconds = await measureOverdueLag(clock.now());

  console.log(
    `tasks_overdue_reported_total value=${String(reported)} skipped=${String(skipped)} failed=${String(failed.length)} [correlationId=${correlationId}]`,
  );
  console.log(`tasks_overdue_lag_seconds=${String(lagSeconds)}`);

  if (lagSeconds > OVERDUE_LAG_ALERT_SECONDS) {
    console.warn(
      `ALERT tasks_overdue_lag_seconds=${String(lagSeconds)} threshold=${String(OVERDUE_LAG_ALERT_SECONDS)}`,
    );
  }

  return { reported, skipped, failed, lagSeconds };
}
