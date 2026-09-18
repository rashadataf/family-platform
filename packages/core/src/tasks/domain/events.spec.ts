import { asFamilyId, asFamilyMemberId, asTaskId, asTaskSeriesId } from '@fp/kernel';
import { describe, expect, it } from 'vitest';
import {
  TASK_EVENT_TYPES,
  taskAssignedEvent,
  taskCancelledEvent,
  taskCompletedEvent,
  taskCreatedEvent,
  taskOverdueEvent,
  taskUpdatedEvent,
} from './events.js';

const familyId = asFamilyId('11111111-1111-7111-8111-111111111111');
const taskId = asTaskId('22222222-2222-7222-8222-222222222222');
const seriesId = asTaskSeriesId('33333333-3333-7333-8333-333333333333');
const predecessorId = asTaskId('44444444-4444-7444-8444-444444444444');
const memberId = asFamilyMemberId('55555555-5555-7555-8555-555555555555');
const correlationId = 'correlation-1';

const ALL_EVENTS = [
  taskCreatedEvent({ familyId, taskId, seriesId, predecessorId, dueKind: 'date', correlationId }),
  taskAssignedEvent({ familyId, taskId, memberId, correlationId }),
  taskUpdatedEvent({ familyId, taskId, changed: ['details', 'due'], correlationId }),
  taskCompletedEvent({ familyId, taskId, completedByMemberId: memberId, correlationId }),
  taskCancelledEvent({ familyId, taskId, scope: 'instance', correlationId }),
  taskOverdueEvent({ familyId, taskId, dueAt: new Date('2026-09-30T23:00:00Z'), correlationId }),
];

describe('task events (research.md §8, SC-011)', () => {
  it('defines exactly the six names, versioned and context-prefixed', () => {
    expect(Object.values(TASK_EVENT_TYPES)).toEqual([
      'tasks.TaskCreated.v1',
      'tasks.TaskAssigned.v1',
      'tasks.TaskUpdated.v1',
      'tasks.TaskCompleted.v1',
      'tasks.TaskCancelled.v1',
      'tasks.TaskOverdue.v1',
    ]);
    expect(ALL_EVENTS.map((e) => e.eventType).sort()).toEqual(
      Object.values(TASK_EVENT_TYPES).sort(),
    );
  });

  it('carries the family id, the task id and the correlation id on every event', () => {
    for (const event of ALL_EVENTS) {
      expect(event.payload.familyId, event.eventType).toBe(familyId);
      expect(event.payload.taskId, event.eventType).toBe(taskId);
      expect(event.aggregateType, event.eventType).toBe('Task');
      expect(event.aggregateId, event.eventType).toBe(taskId);
      expect(event.correlationId, event.eventType).toBe(correlationId);
    }
  });

  /**
   * The assertion that matters most. A task's title and notes are the free text
   * of this context, and an outbox row is a queue message body in waiting
   * (Principle VI, VIII). Pinning the exact key set — not merely scanning for
   * forbidden names — is what makes a later `title:` addition fail here.
   */
  it('pins every payload key set, so an added title or notes field fails this test', () => {
    const keysByType = new Map(
      ALL_EVENTS.map((event) => [event.eventType, Object.keys(event.payload).sort()]),
    );

    expect(keysByType.get(TASK_EVENT_TYPES.TaskCreated)).toEqual(
      ['familyId', 'taskId', 'seriesId', 'predecessorId', 'dueKind'].sort(),
    );
    expect(keysByType.get(TASK_EVENT_TYPES.TaskAssigned)).toEqual(
      ['familyId', 'taskId', 'memberId'].sort(),
    );
    expect(keysByType.get(TASK_EVENT_TYPES.TaskUpdated)).toEqual(
      ['familyId', 'taskId', 'changed'].sort(),
    );
    expect(keysByType.get(TASK_EVENT_TYPES.TaskCompleted)).toEqual(
      ['familyId', 'taskId', 'completedByMemberId'].sort(),
    );
    expect(keysByType.get(TASK_EVENT_TYPES.TaskCancelled)).toEqual(
      ['familyId', 'taskId', 'scope'].sort(),
    );
    expect(keysByType.get(TASK_EVENT_TYPES.TaskOverdue)).toEqual(
      ['familyId', 'taskId', 'dueAt'].sort(),
    );
  });

  it('puts no title, notes or other free text in any payload', () => {
    const FORBIDDEN = ['title', 'note', 'description', 'name', 'location', 'text'];
    for (const event of ALL_EVENTS) {
      for (const key of Object.keys(event.payload)) {
        expect(
          FORBIDDEN.some((forbidden) => key.toLowerCase().includes(forbidden)),
          `${event.eventType} payload carries "${key}"`,
        ).toBe(false);
      }
    }
  });

  it('describes a creation by series, predecessor and due shape, never by due value', () => {
    expect(ALL_EVENTS[0]?.payload).toEqual({
      familyId,
      taskId,
      seriesId,
      predecessorId,
      dueKind: 'date',
    });
  });

  it('reports an undated, non-recurring creation with explicit nulls and no due kind value', () => {
    expect(
      taskCreatedEvent({
        familyId,
        taskId,
        seriesId: null,
        predecessorId: null,
        dueKind: 'none',
        correlationId,
      }).payload,
    ).toEqual({ familyId, taskId, seriesId: null, predecessorId: null, dueKind: 'none' });
  });

  /** Field GROUPS, never values: "the due date moved", never the date. */
  it('reports an update as field groups, copied so a later mutation cannot reach the payload', () => {
    const changed: ('details' | 'due')[] = ['details'];
    const event = taskUpdatedEvent({ familyId, taskId, changed, correlationId });
    changed.push('due');
    expect(event.payload.changed).toEqual(['details']);
  });

  it('distinguishes an instance cancellation from a series cancellation by scope alone', () => {
    expect(
      taskCancelledEvent({ familyId, taskId, scope: 'series', correlationId }).payload.scope,
    ).toBe('series');
    expect(
      taskCancelledEvent({ familyId, taskId, scope: 'instance', correlationId }).payload.scope,
    ).toBe('instance');
  });

  /** `dueAt` lets a consumer discard a stale report for a re-dated task without a read. */
  it('serialises the overdue due moment as an ISO instant', () => {
    expect(ALL_EVENTS[5]?.payload).toEqual({
      familyId,
      taskId,
      dueAt: '2026-09-30T23:00:00.000Z',
    });
  });
});
