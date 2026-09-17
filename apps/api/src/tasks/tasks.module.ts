import { Logger, Module } from '@nestjs/common';
import type { family, tasks } from '@fp/core';
import { SystemClock } from '@fp/platform';
import {
  createIdempotencyStore,
  createMemberVisibility,
  createTasksUnitOfWork,
} from '@fp/persistence';
import { FamilyModule } from '../family/family.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TasksController } from './tasks.controller.js';
import {
  TASKS_CLOCK,
  TASKS_IDEMPOTENCY_STORE,
  TASKS_MEMBER_VISIBILITY,
  TASKS_UNIT_OF_WORK,
} from './tasks.tokens.js';

/**
 * `member_visibility_resolve_duration` (contracts/tasks-api.md) — against
 * research.md §11's 2 ms budget, which this feature asserts is unchanged by a
 * second consumer. A structured log line, the convention spec 008 set for a
 * platform with no metrics pipeline yet. Identifiers only.
 */
function timedMemberVisibility(port: family.MemberVisibilityPort): family.MemberVisibilityPort {
  const logger = new Logger('TasksMemberVisibility');
  return {
    async resolveVisibleMemberIds(viewerMemberId, familyId) {
      const startedAt = performance.now();
      try {
        return await port.resolveVisibleMemberIds(viewerMemberId, familyId);
      } finally {
        logger.log(
          `member_visibility_resolve_duration_ms=${(performance.now() - startedAt).toFixed(1)}`,
        );
      }
    },
  };
}

/**
 * `tasks_child_assignment_read_total{result}` (contracts/tasks-api.md) —
 * Principle VI's audit volume.
 *
 * Counted here, at the composition root, rather than in the handlers: the
 * number of child-assignment rows a read audits is known only behind the audit
 * port, and `packages/core/tasks` is the wrong place to emit a log line. This
 * decorates the unit of work the same way `timedMemberVisibility` below
 * decorates the visibility port — infrastructure counting what passes through
 * a seam, with the domain unaware.
 */
function countingChildAssignmentReads(port: tasks.TasksUnitOfWorkPort): tasks.TasksUnitOfWorkPort {
  const logger = new Logger('TasksAudit');
  return {
    async withTasksFamilyContext(familyId, work) {
      const counts = { granted: 0, denied: 0 };

      const outcome = await port.withTasksFamilyContext(familyId, async (uow) =>
        work({
          ...uow,
          audit: {
            append: async (entry) => {
              if (entry.action === 'task_assignment.read') counts[entry.result] += 1;
              await uow.audit.append(entry);
            },
          },
        }),
      );

      for (const result of ['granted', 'denied'] as const) {
        if (counts[result] > 0) {
          logger.log(
            `tasks_child_assignment_read_total result=${result} value=${String(counts[result])}`,
          );
        }
      }
      return outcome;
    },
  };
}

/**
 * The composition root for Tasks. Thin: it wires adapters to ports and holds no
 * logic (ARCHITECTURE.md §6).
 *
 * It adds NO guard. `SessionGuard` comes from `IdentityModule`, and
 * `FamilyMembershipGuard` and `CapabilityGuard` come from `FamilyModule`
 * unchanged — layers 2 and 3 are the tenant root's, and a third context
 * consuming them without amendment is this feature's whole thesis (T018).
 */
@Module({
  imports: [IdentityModule, FamilyModule],
  controllers: [TasksController],
  providers: [
    { provide: TASKS_CLOCK, useClass: SystemClock },
    {
      provide: TASKS_UNIT_OF_WORK,
      useFactory: () => countingChildAssignmentReads(createTasksUnitOfWork()),
    },
    {
      provide: TASKS_MEMBER_VISIBILITY,
      useFactory: () => timedMemberVisibility(createMemberVisibility()),
    },
    { provide: TASKS_IDEMPOTENCY_STORE, useFactory: () => createIdempotencyStore() },
  ],
})
export class TasksModule {}
