import type { Clock, FamilyId, TaskId } from '@fp/kernel';
import { taskOverdueEvent } from '../../domain/events.js';
import { needsOverdueReport } from '../../domain/overdue.js';
import type { TasksUnitOfWorkPort } from '../ports/tasks-unit-of-work.port.js';

export type ReportOverdueOutcome = 'reported' | 'skipped';

/**
 * FR-026, FR-027 — one task, in its own family-scoped transaction
 * (research.md §5). The sweep discovered it with a cross-family read; here the
 * predicate is re-checked under the row lock, so a task completed or re-dated
 * between discovery and write is skipped rather than reported.
 *
 * The marker and the outbox row commit together: a crash between them is not a
 * state that can exist, which is what makes an interrupted sweep safe to re-run.
 */
export async function reportOverdue(
  input: { familyId: FamilyId; taskId: TaskId; correlationId: string },
  deps: { unitOfWork: TasksUnitOfWorkPort; clock: Clock },
): Promise<ReportOverdueOutcome> {
  const now = deps.clock.now();

  return deps.unitOfWork.withTasksFamilyContext(input.familyId, async (uow) => {
    const task = await uow.tasks.lockById(input.taskId);
    const dueAt = task?.dueAt ?? null;
    if (task === null || dueAt === null || !needsOverdueReport(task, now)) return 'skipped';

    task.recordOverdueReported();
    await uow.tasks.save(task);
    await uow.outbox.append(
      taskOverdueEvent({
        familyId: input.familyId,
        taskId: task.id,
        dueAt,
        correlationId: input.correlationId,
      }),
    );
    return 'reported';
  });
}
