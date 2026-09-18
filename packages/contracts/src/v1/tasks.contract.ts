import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { capabilitySchema } from './family.contract.js';
import { problemSchema } from './identity.contract.js';

/**
 * The Tasks wire boundary (ADR-006, specs/010-tasks/contracts/tasks-api.md).
 *
 * Additive within `/v1`. Every route is family-scoped, and every one answers a
 * caller with no standing in the family, or addressing a task assigned to a
 * child they do not guard, with the same `404 task/not_found`.
 *
 * Nothing here is imported from `@fp/core` (`contracts-are-standalone`): the
 * enums are restated so the wire and domain languages can differ.
 */

export const taskPrioritySchema = z.enum(['low', 'normal', 'high']);
export const taskCategorySchema = z.enum([
  'household',
  'school',
  'health',
  'finance',
  'admin',
  'other',
]);
export const taskStatusSchema = z.enum(['open', 'completed', 'cancelled']);

const instantSchema = z.string().datetime({ offset: true });
/** Calendar validity (no 30 February) is the domain's check, where it has a reason to give. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');
const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, 'Expected an HH:mm time.');
const memberIdSchema = z.string().uuid();
/** IANA identifier, validated against the runtime's own zone set, never defaulted (FR-002). */
const timeZoneSchema = z.string().min(1).max(64);

/**
 * A discriminated union on `kind`, STRICT on each arm and with `timeZone`
 * required on both: a due time without a zone is unrepresentable on the wire,
 * not merely rejected (Principle I, US1 #6). Absent means no due date.
 */
export const dueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('date'), date: dateSchema, timeZone: timeZoneSchema }).strict(),
  z
    .object({
      kind: z.literal('date_time'),
      date: dateSchema,
      time: timeSchema,
      timeZone: timeZoneSchema,
    })
    .strict(),
]);

export const createTaskRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().max(4000).nullish(),
    priority: taskPrioritySchema.optional(),
    category: taskCategorySchema.nullish(),
    due: dueSchema.optional(),
    /** RFC 5545 RRULE in the kernel's declared subset. Needs `due`. */
    recurrenceRule: z.string().max(500).nullish(),
    /** Member ids, and nothing else about a person (FR-013). */
    assigneeIds: z.array(memberIdSchema).max(20).optional(),
  })
  .strict();

/**
 * PATCH semantics on an OPEN task; `expectedVersion` is required (FR-011).
 * `due: null` clears the due date; `recurrenceRule: null` removes the rule.
 * Status is deliberately not writable here — transitions have their own routes.
 */
export const updateTaskRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(4000).nullable().optional(),
    priority: taskPrioritySchema.optional(),
    category: taskCategorySchema.nullable().optional(),
    due: dueSchema.nullable().optional(),
    recurrenceRule: z.string().max(500).nullable().optional(),
  })
  .strict();

export const versionedRequestSchema = z
  .object({ expectedVersion: z.number().int().min(1) })
  .strict();

export const cancelTaskRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    /** `instance` skips this one; `series` stops a recurring series. Identical on anything else. */
    scope: z.enum(['instance', 'series']),
  })
  .strict();

export const taskResponseSchema = z.object({
  taskId: z.string().uuid(),
  version: z.number().int(),
  title: z.string(),
  notes: z.string().nullable(),
  priority: taskPrioritySchema,
  category: taskCategorySchema.nullable(),
  status: taskStatusSchema,
  due: dueSchema.nullable(),
  dueAt: z.string().nullable(),
  /** Computed from the server clock at response time (FR-025); independent of the sweep. */
  isOverdue: z.boolean(),
  recurrenceRule: z.string().nullable(),
  seriesId: z.string().uuid().nullable(),
  isSeriesHead: z.boolean(),
  predecessorId: z.string().uuid().nullable(),
  /** Only ever returned to a reader permitted to see every one of them (FR-014). */
  assigneeIds: z.array(memberIdSchema),
  createdByMemberId: z.string().nullable(),
  completedAt: z.string().nullable(),
  completedByMemberId: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledByMemberId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** So a client can show next week's bins without a refetch. */
export const closeTaskResponseSchema = z.object({
  task: taskResponseSchema,
  successor: taskResponseSchema.nullable(),
});

/** No total count: it would be a cheap inference channel for hidden tasks (FR-014). */
export const taskPageSchema = z.object({
  items: z.array(taskResponseSchema),
  nextCursor: z.string().nullable(),
});

const limitSchema = z.coerce.number().int().min(1).max(200).optional();

export const listTasksQuerySchema = z.object({
  assignee: memberIdSchema.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  dueFrom: instantSchema.optional(),
  dueTo: instantSchema.optional(),
  cursor: z.string().max(500).optional(),
  limit: limitSchema,
});

export const taskHistoryQuerySchema = z.object({
  from: instantSchema,
  to: instantSchema,
  cursor: z.string().max(500).optional(),
  limit: limitSchema,
});

// ---- Error types (contracts/tasks-api.md) -----------------------------------

/** One shape for "does not exist", "not your family" and "assigned to a child you do not guard". */
export const taskNotFoundSchema = problemSchema.extend({ type: z.literal('task/not_found') });

export const taskCapabilityRequiredSchema = problemSchema.extend({
  type: z.literal('task/capability_required'),
  capability: capabilitySchema,
});

export const taskUnknownTimeZoneSchema = problemSchema.extend({
  type: z.literal('task/unknown_time_zone'),
});
export const taskInvalidDueSchema = problemSchema.extend({
  type: z.literal('task/invalid_due'),
  field: z.string(),
  reason: z.string(),
});
export const taskRecurrenceInvalidSchema = problemSchema.extend({
  type: z.literal('task/recurrence_invalid'),
  reason: z.string(),
});
export const taskRecurrenceUnsupportedSchema = problemSchema.extend({
  type: z.literal('task/recurrence_unsupported'),
  part: z.string(),
});
export const taskRecurrenceRequiresDueSchema = problemSchema.extend({
  type: z.literal('task/recurrence_requires_due'),
});
/** FR-016: never says whether that member exists somewhere else. */
export const taskAssigneeInvalidSchema = problemSchema.extend({
  type: z.literal('task/assignee_invalid'),
});
export const taskRangeTooWideSchema = problemSchema.extend({
  type: z.literal('task/range_too_wide'),
  maxDays: z.number().int(),
});
export const taskInvalidRangeSchema = problemSchema.extend({
  type: z.literal('task/invalid_range'),
  reason: z.string(),
});
export const taskInvalidTransitionSchema = problemSchema.extend({
  type: z.literal('task/invalid_transition'),
  from: taskStatusSchema,
  command: z.string(),
});
/** Carries the current version and nothing else; the client refetches through the ordinary read. */
export const taskVersionConflictSchema = problemSchema.extend({
  type: z.literal('task/version_conflict'),
  currentVersion: z.number().int(),
});

const taskFieldErrorSchema = z.discriminatedUnion('type', [
  taskUnknownTimeZoneSchema,
  taskInvalidDueSchema,
  taskRecurrenceInvalidSchema,
  taskRecurrenceUnsupportedSchema,
  taskRecurrenceRequiresDueSchema,
  taskAssigneeInvalidSchema,
]);

const taskConflictSchema = z.discriminatedUnion('type', [
  taskInvalidTransitionSchema,
  taskVersionConflictSchema,
]);

const listErrorSchema = z.discriminatedUnion('type', [
  taskRangeTooWideSchema,
  taskInvalidRangeSchema,
]);

const familyParams = z.object({ familyId: z.string().uuid() });
const taskParams = familyParams.extend({ taskId: z.string().uuid() });
const assigneeParams = taskParams.extend({ memberId: z.string().uuid() });

const c = initContract();

export const tasksContract = c.router(
  {
    listOpenTasks: {
      method: 'GET',
      path: '/families/:familyId/tasks',
      pathParams: familyParams,
      query: listTasksQuerySchema,
      responses: { 200: taskPageSchema, 403: taskCapabilityRequiredSchema, 422: listErrorSchema },
      summary:
        'Open tasks, due soonest first, guardian-filtered in the query (requires tasks:read, FR-005, FR-014)',
    },

    listTaskHistory: {
      method: 'GET',
      path: '/families/:familyId/tasks/history',
      pathParams: familyParams,
      query: taskHistoryQuerySchema,
      responses: { 200: taskPageSchema, 403: taskCapabilityRequiredSchema, 422: listErrorSchema },
      summary: 'Completed and cancelled tasks by closure time (requires tasks:read, FR-006)',
    },

    createTask: {
      method: 'POST',
      path: '/families/:familyId/tasks',
      pathParams: familyParams,
      body: createTaskRequestSchema,
      responses: {
        201: taskResponseSchema,
        403: taskCapabilityRequiredSchema,
        422: taskFieldErrorSchema,
      },
      summary:
        'Create a task, optionally due, recurring and assigned (requires tasks:write); honours Idempotency-Key',
    },

    getTask: {
      method: 'GET',
      path: '/families/:familyId/tasks/:taskId',
      pathParams: taskParams,
      responses: { 200: taskResponseSchema, 403: taskCapabilityRequiredSchema },
      summary:
        'One task; 404 if assigned to a child the caller does not guard (requires tasks:read, FR-014)',
    },

    updateTask: {
      method: 'PATCH',
      path: '/families/:familyId/tasks/:taskId',
      pathParams: taskParams,
      body: updateTaskRequestSchema,
      responses: {
        200: taskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
        422: taskFieldErrorSchema,
      },
      summary: 'Edit an open task (requires tasks:write, FR-010, FR-011); honours Idempotency-Key',
    },

    completeTask: {
      method: 'POST',
      path: '/families/:familyId/tasks/:taskId/complete',
      pathParams: taskParams,
      body: versionedRequestSchema,
      responses: {
        200: closeTaskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
      },
      summary:
        'Complete; a recurring head spawns its successor (requires tasks:write, FR-008, FR-020); honours Idempotency-Key',
    },

    reopenTask: {
      method: 'POST',
      path: '/families/:familyId/tasks/:taskId/reopen',
      pathParams: taskParams,
      body: versionedRequestSchema,
      responses: {
        200: taskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
      },
      summary: 'Reopen a completed task (requires tasks:write, FR-008); honours Idempotency-Key',
    },

    cancelTask: {
      method: 'POST',
      path: '/families/:familyId/tasks/:taskId/cancel',
      pathParams: taskParams,
      body: cancelTaskRequestSchema,
      responses: {
        200: closeTaskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
      },
      summary:
        'Cancel this instance, or stop the series (requires tasks:write, FR-008); honours Idempotency-Key',
    },

    assignTask: {
      method: 'PUT',
      path: '/families/:familyId/tasks/:taskId/assignees/:memberId',
      pathParams: assigneeParams,
      body: c.noBody(),
      responses: {
        200: taskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
        422: taskAssigneeInvalidSchema,
      },
      summary:
        'Assign a family member, including a child (requires tasks:write, FR-013); idempotent',
    },

    unassignTask: {
      method: 'DELETE',
      path: '/families/:familyId/tasks/:taskId/assignees/:memberId',
      pathParams: assigneeParams,
      body: c.noBody(),
      responses: {
        200: taskResponseSchema,
        403: taskCapabilityRequiredSchema,
        409: taskConflictSchema,
      },
      summary: 'Remove an assignee; the task stays (requires tasks:write); idempotent',
    },
  },
  {
    pathPrefix: '/v1',
    // FR-032, SC-003: "no standing" and "not there" alike, declared once.
    commonResponses: { 404: taskNotFoundSchema },
  },
);
