import type {
  FamilyId,
  FamilyMemberId,
  OutboxEventToAppend,
  TaskId,
  TaskSeriesId,
} from '@fp/kernel';
import type { DueKind } from './due.js';
import type { ChangedFieldGroup } from './task.aggregate.js';

/**
 * The six events spec 010 publishes (research.md §8): ARCHITECTURE.md §5.4's
 * four, plus `TaskUpdated` and `TaskCancelled`, which Reminders will need to
 * withdraw or reschedule a reminder. Published although nothing subscribes yet,
 * as outbox rows in the state change's own transaction (ADR-005 Layer 2).
 *
 * PAYLOADS CARRY IDENTIFIERS AND ENUM VALUES ONLY. Never a title or notes
 * (Principle VI, VIII, SC-011); `events.spec.ts` pins every key set.
 */
export const TASK_EVENT_TYPES = {
  TaskCreated: 'tasks.TaskCreated.v1',
  TaskAssigned: 'tasks.TaskAssigned.v1',
  TaskUpdated: 'tasks.TaskUpdated.v1',
  TaskCompleted: 'tasks.TaskCompleted.v1',
  TaskCancelled: 'tasks.TaskCancelled.v1',
  TaskOverdue: 'tasks.TaskOverdue.v1',
} as const;

function envelope(
  eventType: string,
  taskId: TaskId,
  payload: OutboxEventToAppend['payload'],
  correlationId: string,
): OutboxEventToAppend {
  return { eventType, aggregateType: 'Task', aggregateId: taskId, payload, correlationId };
}

export function taskCreatedEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  seriesId: TaskSeriesId | null;
  predecessorId: TaskId | null;
  dueKind: DueKind | 'none';
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskCreated,
    params.taskId,
    {
      familyId: params.familyId,
      taskId: params.taskId,
      seriesId: params.seriesId,
      predecessorId: params.predecessorId,
      dueKind: params.dueKind,
    },
    params.correlationId,
  );
}

export function taskAssignedEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  memberId: FamilyMemberId;
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskAssigned,
    params.taskId,
    { familyId: params.familyId, taskId: params.taskId, memberId: params.memberId },
    params.correlationId,
  );
}

export function taskUpdatedEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  changed: readonly ChangedFieldGroup[];
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskUpdated,
    params.taskId,
    // Field GROUPS, never values: "the due date moved", never the date.
    { familyId: params.familyId, taskId: params.taskId, changed: [...params.changed] },
    params.correlationId,
  );
}

export function taskCompletedEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  completedByMemberId: FamilyMemberId;
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskCompleted,
    params.taskId,
    {
      familyId: params.familyId,
      taskId: params.taskId,
      completedByMemberId: params.completedByMemberId,
    },
    params.correlationId,
  );
}

export function taskCancelledEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  scope: 'instance' | 'series';
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskCancelled,
    params.taskId,
    { familyId: params.familyId, taskId: params.taskId, scope: params.scope },
    params.correlationId,
  );
}

export function taskOverdueEvent(params: {
  familyId: FamilyId;
  taskId: TaskId;
  dueAt: Date;
  correlationId: string;
}): OutboxEventToAppend {
  return envelope(
    TASK_EVENT_TYPES.TaskOverdue,
    params.taskId,
    // `dueAt` lets a consumer discard a stale report for a since-re-dated task without a read.
    { familyId: params.familyId, taskId: params.taskId, dueAt: params.dueAt.toISOString() },
    params.correlationId,
  );
}
