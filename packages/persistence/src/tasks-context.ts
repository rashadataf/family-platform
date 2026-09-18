import type { tasks } from '@fp/core';
import type { FamilyId } from '@fp/kernel';
import { prisma } from './client.js';
import { PrismaAuditLogRepository } from './repositories/compliance/audit-log.repository.js';
import { PrismaOutboxRepository } from './repositories/outbox.repository.js';
import { PrismaTaskAssignmentRepository } from './repositories/tasks/task-assignment.repository.js';
import { PrismaTaskRepository } from './repositories/tasks/task.repository.js';

/**
 * ARCHITECTURE.md §9 layers 4 and 5 for the Tasks context, established by one
 * call (ADR-017) — `calendar-context.ts`'s pattern applied to a third context,
 * deliberately not a shared function: a Tasks transaction constructs Tasks'
 * repositories and cannot reach any other context's.
 *
 * `set_config(..., true)` dies with the transaction instead of leaking onto the
 * next request that reuses the pooled connection;
 * `tasks-context.integration.spec.ts` asserts it for these tables.
 */
class PrismaTasksUnitOfWork implements tasks.TasksUnitOfWorkPort {
  async withTasksFamilyContext<T>(
    familyId: FamilyId,
    work: (uow: tasks.TasksUnitOfWork) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      // First statement in the transaction, before anything can read a row.
      await tx.$executeRaw`SELECT set_config('app.family_id', ${familyId}::text, true)`;

      return work({
        familyId,
        tasks: new PrismaTaskRepository(tx, familyId),
        assignments: new PrismaTaskAssignmentRepository(tx, familyId),
        outbox: new PrismaOutboxRepository(tx),
        audit: new PrismaAuditLogRepository(tx),
      });
    });
  }
}

const tasksUnitOfWork = new PrismaTasksUnitOfWork();

/**
 * The one door to Tasks' tables. The repositories behind it are private to
 * this package (`tasks-repositories-are-private` in `.dependency-cruiser.cjs`).
 */
export function createTasksUnitOfWork(): tasks.TasksUnitOfWorkPort {
  return tasksUnitOfWork;
}
