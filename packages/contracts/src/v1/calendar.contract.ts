import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { capabilitySchema } from './family.contract.js';
import { problemSchema } from './identity.contract.js';

/**
 * The Calendar wire boundary (ADR-006, specs/009-calendar/contracts/calendar-api.md).
 *
 * Additive within `/v1`. Every route is family-scoped — a calendar has no
 * equivalent of "the families I belong to" — and every one answers a caller
 * with no standing in the family, or asking for an event involving a child
 * they do not guard, with the same `404 calendar/not_found`.
 *
 * Nothing here is imported from `@fp/core` (`contracts-are-standalone`): the
 * category and kind unions are restated, so the wire language and the domain
 * language can differ without a shared enum making them the same by accident.
 */

export const eventCategorySchema = z.enum([
  'medical',
  'school',
  'nursery',
  'activity',
  'birthday',
  'holiday',
  'deadline',
  'social',
  'household',
  'other',
]);

export const eventStatusSchema = z.enum(['confirmed', 'cancelled']);

/** An ISO-8601 instant with an explicit offset or `Z`. A floating local time is not an instant. */
const instantSchema = z.string().datetime({ offset: true });

/** `YYYY-MM-DD`. Calendar validity (no 30 February) is the domain's check, where it has a reason to give. */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');

const memberIdSchema = z.string().uuid();

/**
 * Title and free text are personal data. The bounds are generous and exist to
 * refuse abuse, not to shape what a household writes.
 */
const eventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullish(),
  location: z.string().max(500).nullish(),
  category: eventCategorySchema.nullish(),
  /** IANA identifier, validated against the runtime's own zone set, never defaulted (FR-002). */
  timeZone: z.string().min(1).max(64),
  /** RFC 5545 RRULE, parsed into the declared subset; anything else is a specific 422. */
  recurrenceRule: z.string().max(500).nullish(),
  /** Member ids, and nothing else about a person — no names, kinds or ages (FR-015). */
  participants: z.array(memberIdSchema).max(50).optional(),
  /** Opaque references, never validated, resolved or dereferenced (FR-031). */
  attachments: z.array(z.string().min(1).max(500)).max(20).optional(),
});

/**
 * A discriminated union on `kind`, and STRICT on each arm: an all-day event
 * carrying `startsAt` is refused as a malformed request rather than silently
 * ignored, so "an all-day event with a start time" is unrepresentable on the
 * wire as well as in the table (Principle I).
 */
export const createEventRequestSchema = z.discriminatedUnion('kind', [
  eventFieldsSchema
    .extend({ kind: z.literal('timed'), startsAt: instantSchema, endsAt: instantSchema })
    .strict(),
  eventFieldsSchema
    .extend({ kind: z.literal('all_day'), startDate: dateSchema, endDate: dateSchema })
    .strict(),
]);

/**
 * PATCH semantics: every field optional. `null` clears an optional field;
 * `recurrenceRule: null` turns a series into a one-off. Changing `kind` needs
 * both of the new kind's fields. A time, zone or rule change rebuilds the
 * occurrences (FR-020).
 */
export const updateEventRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).nullable(),
    location: z.string().max(500).nullable(),
    category: eventCategorySchema.nullable(),
    timeZone: z.string().min(1).max(64),
    recurrenceRule: z.string().max(500).nullable(),
    participants: z.array(memberIdSchema).max(50),
    attachments: z.array(z.string().min(1).max(500)).max(20),
    kind: z.enum(['timed', 'all_day']),
    startsAt: instantSchema,
    endsAt: instantSchema,
    startDate: dateSchema,
    endDate: dateSchema,
  })
  .partial()
  .strict();

const eventResponseFieldsSchema = z.object({
  eventId: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  category: eventCategorySchema.nullable(),
  timeZone: z.string(),
  recurrenceRule: z.string().nullable(),
  status: eventStatusSchema,
  /** Only ever returned to a reader permitted to see every one of them (FR-016). */
  participants: z.array(memberIdSchema),
  attachments: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const eventResponseSchema = z.discriminatedUnion('kind', [
  eventResponseFieldsSchema.extend({
    kind: z.literal('timed'),
    startsAt: z.string(),
    endsAt: z.string(),
  }),
  eventResponseFieldsSchema.extend({
    kind: z.literal('all_day'),
    startDate: z.string(),
    endDate: z.string(),
  }),
]);

/**
 * One row of the range. The event's display fields ride along so a 14-day
 * view is one request, not N+1. For an all-day row, `startDate`/`endDate` are
 * what a client shows; the instants exist so the range stays one scan (FR-004).
 */
export const occurrenceResponseSchema = z.object({
  occurrenceId: z.string().uuid(),
  eventId: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  cancelledAt: z.string().nullable(),
  kind: z.enum(['timed', 'all_day']),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  title: z.string(),
  timeZone: z.string(),
  location: z.string().nullable(),
  category: eventCategorySchema.nullable(),
  /** The EVENT's status: a cancelled series still occupies its slots (FR-008). */
  status: eventStatusSchema,
  participants: z.array(memberIdSchema),
});

export const listOccurrencesQuerySchema = z.object({
  from: instantSchema,
  to: instantSchema,
});

// ---- Error types (contracts/calendar-api.md) --------------------------------

/** Deliberately one shape for "does not exist", "not your family" and "involves a child you do not guard". */
export const calendarNotFoundSchema = problemSchema.extend({
  type: z.literal('calendar/not_found'),
});

/** Names the capability, never the caller's role. */
export const calendarCapabilityRequiredSchema = problemSchema.extend({
  type: z.literal('calendar/capability_required'),
  capability: capabilitySchema,
});

export const invalidTimeRangeSchema = problemSchema.extend({
  type: z.literal('calendar/invalid_time_range'),
  reason: z.string(),
});
export const unknownTimeZoneSchema = problemSchema.extend({
  type: z.literal('calendar/unknown_time_zone'),
});
export const recurrenceInvalidSchema = problemSchema.extend({
  type: z.literal('calendar/recurrence_invalid'),
  reason: z.string(),
});
/** Names the offending part, because "invalid rule" on a rule the user did not hand-write is unactionable. */
export const recurrenceUnsupportedSchema = problemSchema.extend({
  type: z.literal('calendar/recurrence_unsupported'),
  part: z.string(),
});
export const recurrenceTooDenseSchema = problemSchema.extend({
  type: z.literal('calendar/recurrence_too_dense'),
  limit: z.number().int(),
});
export const rangeTooWideSchema = problemSchema.extend({
  type: z.literal('calendar/range_too_wide'),
  maxDays: z.number().int(),
});
/** Points at the supported route: edit the series. */
export const occurrenceNotMovableSchema = problemSchema.extend({
  type: z.literal('calendar/occurrence_not_movable'),
});
/** FR-018: never says whether that member exists somewhere else. */
export const participantInvalidSchema = problemSchema.extend({
  type: z.literal('calendar/participant_invalid'),
});

const eventWriteErrorSchema = z.discriminatedUnion('type', [
  invalidTimeRangeSchema,
  unknownTimeZoneSchema,
  recurrenceInvalidSchema,
  recurrenceUnsupportedSchema,
  recurrenceTooDenseSchema,
  participantInvalidSchema,
]);

const familyParams = z.object({ familyId: z.string().uuid() });
const eventParams = familyParams.extend({ eventId: z.string().uuid() });
const occurrenceParams = eventParams.extend({ occurrenceId: z.string().uuid() });

const c = initContract();

export const calendarContract = c.router(
  {
    listOccurrences: {
      method: 'GET',
      path: '/families/:familyId/occurrences',
      pathParams: familyParams,
      query: listOccurrencesQuerySchema,
      responses: {
        200: z.array(occurrenceResponseSchema),
        403: calendarCapabilityRequiredSchema,
        422: z.discriminatedUnion('type', [invalidTimeRangeSchema, rangeTooWideSchema]),
      },
      summary:
        'Occurrences overlapping [from, to), chronological, guardian-filtered in the query (requires calendar:read, FR-006, FR-016)',
    },

    createEvent: {
      method: 'POST',
      path: '/families/:familyId/events',
      pathParams: familyParams,
      body: createEventRequestSchema,
      responses: {
        201: z.object({ eventId: z.string().uuid() }),
        403: calendarCapabilityRequiredSchema,
        422: eventWriteErrorSchema,
      },
      summary:
        'Create a timed or all-day event, optionally recurring (requires calendar:write, FR-001, FR-009); honours Idempotency-Key',
    },

    getEvent: {
      method: 'GET',
      path: '/families/:familyId/events/:eventId',
      pathParams: eventParams,
      responses: {
        200: eventResponseSchema,
        403: calendarCapabilityRequiredSchema,
      },
      summary:
        'One event; 404 if it involves a child the caller does not guard (requires calendar:read, FR-016)',
    },

    updateEvent: {
      method: 'PATCH',
      path: '/families/:familyId/events/:eventId',
      pathParams: eventParams,
      body: updateEventRequestSchema,
      responses: {
        200: eventResponseSchema,
        403: calendarCapabilityRequiredSchema,
        422: eventWriteErrorSchema,
      },
      summary:
        'Edit any field; a time, zone or rule change rebuilds occurrences by reconcile (requires calendar:write, FR-019, FR-020)',
    },

    cancelEvent: {
      method: 'POST',
      path: '/families/:familyId/events/:eventId/cancel',
      pathParams: eventParams,
      body: c.noBody(),
      responses: {
        200: eventResponseSchema,
        403: calendarCapabilityRequiredSchema,
      },
      summary:
        'Cancel a whole event — it stays readable and in its slots, marked cancelled (requires calendar:write, FR-021); idempotent; honours Idempotency-Key',
    },

    cancelOccurrence: {
      method: 'POST',
      path: '/families/:familyId/events/:eventId/occurrences/:occurrenceId/cancel',
      pathParams: occurrenceParams,
      body: c.noBody(),
      responses: {
        200: z.object({
          occurrenceId: z.string().uuid(),
          eventId: z.string().uuid(),
          startsAt: z.string(),
          endsAt: z.string(),
          cancelledAt: z.string(),
        }),
        403: calendarCapabilityRequiredSchema,
      },
      summary:
        'Cancel one occurrence of a series, leaving the rest intact (requires calendar:write, FR-022); idempotent; honours Idempotency-Key',
    },

    rescheduleOccurrence: {
      method: 'PATCH',
      path: '/families/:familyId/events/:eventId/occurrences/:occurrenceId',
      pathParams: occurrenceParams,
      body: z.object({ startsAt: instantSchema.optional(), endsAt: instantSchema.optional() }),
      responses: {
        403: calendarCapabilityRequiredSchema,
        422: occurrenceNotMovableSchema,
      },
      summary:
        'Always refused: one occurrence cannot be retimed on its own — edit the series instead (requires calendar:write, FR-022)',
    },
  },
  {
    pathPrefix: '/v1',
    // FR-028, SC-004: every route answers "no standing" and "not there" alike,
    // so the 404 is declared once rather than remembered per route.
    commonResponses: {
      404: calendarNotFoundSchema,
    },
  },
);
