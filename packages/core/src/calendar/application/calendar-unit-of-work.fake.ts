import {
  asEventOccurrenceId,
  type CalendarEventId,
  type EventOccurrenceId,
  type FamilyId,
  type FamilyMemberId,
  type OutboxEventToAppend,
} from '@fp/kernel';
import type { AuditEntry } from '../../compliance/domain/audit-entry.js';
import type { CalendarEvent } from '../domain/calendar-event.aggregate.js';
import type { EventOccurrence } from '../domain/event-occurrence.js';
import type { ReconcilePlan } from '../domain/materialisation.js';
import type { OccurrenceView } from './ports/calendar-read.port.js';
import type {
  CalendarUnitOfWork,
  CalendarUnitOfWorkPort,
} from './ports/calendar-unit-of-work.port.js';
import type { RangeQuery } from './ports/event-occurrence.repository.js';
import { ParticipantNotInFamilyError } from './ports/event-participant.repository.js';

/**
 * An in-memory `CalendarUnitOfWork` for handler unit tests, in the shape of
 * `family-unit-of-work.fake.ts`.
 *
 * It deliberately models NEITHER row-level security NOR the database's range
 * and visibility SQL: nothing is filtered by family, and the range query's
 * `NOT EXISTS` is re-stated here only as simply as a handler test needs. The
 * real statements are proven against PostgreSQL in the integration suites —
 * a fake that faithfully reimplemented them would let a test prove a filter
 * only the fake applies.
 *
 * Rollback IS modelled: writes are staged and discarded when `work` throws,
 * because "a rejected participant leaves nothing behind" is a handler
 * property worth unit-testing.
 */
export interface FakeCalendarState {
  events: Map<CalendarEventId, CalendarEvent>;
  occurrences: EventOccurrence[];
  /** The family's roster, standing in for the composite foreign key's check. */
  familyMembers: Set<FamilyMemberId>;
  outbox: OutboxEventToAppend[];
  audit: AuditEntry[];
  scopedTo: FamilyId[];
}

export function emptyCalendarState(overrides: Partial<FakeCalendarState> = {}): FakeCalendarState {
  return {
    events: new Map(),
    occurrences: [],
    familyMembers: new Set(),
    outbox: [],
    audit: [],
    scopedTo: [],
    ...overrides,
  };
}

let sequence = 0;

export function fakeCalendarUnitOfWork(state: FakeCalendarState): CalendarUnitOfWorkPort {
  return {
    withCalendarFamilyContext: async <T>(
      familyId: FamilyId,
      work: (uow: CalendarUnitOfWork) => Promise<T>,
    ): Promise<T> => {
      state.scopedTo.push(familyId);
      const staged: FakeCalendarState = {
        ...state,
        events: new Map(state.events),
        occurrences: state.occurrences.map((o) => ({ ...o })),
        outbox: [...state.outbox],
        audit: [...state.audit],
      };

      const occurrencesOf = (eventId: CalendarEventId) =>
        staged.occurrences.filter((o) => o.eventId === eventId);

      const uow: CalendarUnitOfWork = {
        familyId,
        events: {
          save: (event) => {
            staged.events.set(event.id, event);
            return Promise.resolve();
          },
          findById: (id) => Promise.resolve(staged.events.get(id) ?? null),
          lockById: (id) => Promise.resolve(staged.events.get(id) ?? null),
        },
        occurrences: {
          listForEvent: (eventId, options) =>
            Promise.resolve(
              occurrencesOf(eventId)
                .filter(
                  (o) => options?.startingFrom === undefined || o.startsAt >= options.startingFrom,
                )
                .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
            ),
          findById: (id: EventOccurrenceId) =>
            Promise.resolve(staged.occurrences.find((o) => o.id === id) ?? null),
          applyPlan: (eventId, plan: ReconcilePlan) => {
            const deleted = new Set(plan.toDelete);
            staged.occurrences = staged.occurrences.filter((o) => !deleted.has(o.id));
            for (const update of plan.toUpdate) {
              const row = staged.occurrences.find((o) => o.id === update.id);
              if (row !== undefined) Object.assign(row, { endsAt: update.endsAt });
            }
            let inserted = 0;
            for (const occurrence of plan.toInsert) {
              if (
                occurrencesOf(eventId).some(
                  (o) => o.startsAt.getTime() === occurrence.startsAt.getTime(),
                )
              )
                continue;
              staged.occurrences.push({
                id: asEventOccurrenceId(`fake-occurrence-${String(sequence++)}`),
                eventId,
                startsAt: occurrence.startsAt,
                endsAt: occurrence.endsAt,
                cancelledAt: null,
              });
              inserted += 1;
            }
            return Promise.resolve({
              inserted,
              updated: plan.toUpdate.length,
              deleted: deleted.size,
            });
          },
          cancel: (id, at) => {
            const row = staged.occurrences.find((o) => o.id === id);
            if (row !== undefined) Object.assign(row, { cancelledAt: at });
            return Promise.resolve();
          },
          pruneForEventBefore: (eventId, before) => {
            const keep = staged.occurrences.filter(
              (o) => !(o.eventId === eventId && o.startsAt < before),
            );
            const pruned = staged.occurrences.length - keep.length;
            staged.occurrences = keep;
            return Promise.resolve(pruned);
          },
          pruneRecurringBefore: (before) => {
            const keep = staged.occurrences.filter(
              (o) => !(o.startsAt < before && staged.events.get(o.eventId)?.isRecurring === true),
            );
            const pruned = staged.occurrences.length - keep.length;
            staged.occurrences = keep;
            return Promise.resolve(pruned);
          },
          listVisibleInRange: (query: RangeQuery) => {
            const visible = new Set(query.visibleMemberIds);
            const views: OccurrenceView[] = staged.occurrences
              .filter((o) => o.startsAt < query.to && o.endsAt > query.from)
              .flatMap((o) => {
                const event = staged.events.get(o.eventId);
                if (event === undefined || event.participants.some((m) => !visible.has(m)))
                  return [];
                return [
                  {
                    occurrenceId: o.id,
                    eventId: o.eventId,
                    startsAt: o.startsAt,
                    endsAt: o.endsAt,
                    cancelledAt: o.cancelledAt,
                    kind: event.kind,
                    startDate: null,
                    endDate: null,
                    title: event.title,
                    timeZone: event.timeZone,
                    location: event.location,
                    category: event.category,
                    status: event.status,
                    participants: event.participants,
                  },
                ];
              })
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
            return Promise.resolve(views);
          },
          listHiddenParticipationsInRange: (query: RangeQuery) => {
            const visible = new Set(query.visibleMemberIds);
            const eventIds = new Set(
              staged.occurrences
                .filter((o) => o.startsAt < query.to && o.endsAt > query.from)
                .map((o) => o.eventId),
            );
            return Promise.resolve(
              [...eventIds].flatMap((eventId) =>
                (staged.events.get(eventId)?.participants ?? [])
                  .filter((memberId) => !visible.has(memberId))
                  .map((memberId) => ({ eventId, memberId })),
              ),
            );
          },
        },
        participants: {
          replaceForEvent: (_eventId, memberIds) => {
            if (memberIds.some((m) => !staged.familyMembers.has(m))) {
              return Promise.reject(new ParticipantNotInFamilyError());
            }
            return Promise.resolve();
          },
          listForEvent: (eventId) =>
            Promise.resolve(
              (staged.events.get(eventId)?.participants ?? []).map((memberId) => ({
                memberId,
                addedAt: new Date(0),
              })),
            ),
        },
        outbox: {
          append: (event) => {
            staged.outbox.push(event);
            return Promise.resolve();
          },
        },
        audit: {
          append: (entry) => {
            staged.audit.push(entry);
            return Promise.resolve();
          },
        },
      };

      const result = await work(uow);
      // Commit: only reached when `work` did not throw.
      state.events = staged.events;
      state.occurrences = staged.occurrences;
      state.outbox = staged.outbox;
      state.audit = staged.audit;
      return result;
    },
  };
}
