import {
  ok,
  type CalendarEventId,
  type Clock,
  type DomainError,
  type FamilyId,
  type Result,
} from '@fp/kernel';
import { occurrenceMaterialisedEvent } from '../../domain/events.js';
import { materialisationWindow } from '../../domain/materialisation.js';
import type { CalendarUnitOfWorkPort } from '../ports/calendar-unit-of-work.port.js';
import type { ReconcileCounts } from '../ports/event-occurrence.repository.js';
import { rematerialise } from '../rematerialise.js';

export type MaterialiseHorizonOutcome =
  | { readonly status: 'skipped' }
  | { readonly status: 'extended'; readonly counts: ReconcileCounts; readonly pruned: number };

/**
 * FR-024: one event's horizon, advanced by background work rather than only at
 * write time — so a series created today still has occurrences next year
 * without anyone re-saving it.
 *
 * One family-scoped transaction per event, holding the event's row lock, so an
 * edit to the same event serialises with it and the occurrence set that
 * results matches whichever rule committed — never an interleaving of both
 * (research.md §8, spec.md edge cases).
 *
 * Idempotent through the reconcile and the `(event_id, starts_at)` identity,
 * not through anything this command remembers (FR-025): re-running it against
 * a current event inserts nothing. A series that has since been cancelled,
 * turned into a one-off, or already exhausted is skipped.
 */
export async function materialiseHorizon(
  input: { familyId: FamilyId; eventId: CalendarEventId; correlationId: string },
  deps: { unitOfWork: CalendarUnitOfWorkPort; clock: Clock },
): Promise<Result<MaterialiseHorizonOutcome, DomainError>> {
  const now = deps.clock.now();

  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, async (uow) => {
    const event = await uow.events.lockById(input.eventId);
    if (event === null || !event.isRecurring || event.isCancelled) {
      return ok({ status: 'skipped' as const });
    }
    if (event.materialisedThrough === null) return ok({ status: 'skipped' as const });
    if (event.materialisedThrough.getTime() >= materialisationWindow(now).to.getTime()) {
      return ok({ status: 'skipped' as const });
    }

    const materialised = await rematerialise(uow, event, now);
    if (!materialised.ok) return materialised;

    // The trailing edge moves in the same pass as the forward one, so pruning
    // has the extension's transaction and the extension's test (research.md §10).
    const pruned = await uow.occurrences.pruneForEventBefore(
      event.id,
      materialised.value.window.from,
    );
    await uow.events.save(event);

    await uow.outbox.append(
      occurrenceMaterialisedEvent({
        familyId: input.familyId,
        eventId: event.id,
        windowFrom: materialised.value.window.from,
        windowTo: materialised.value.window.to,
        count: materialised.value.occurrenceCount,
        correlationId: input.correlationId,
      }),
    );

    return ok({ status: 'extended' as const, counts: materialised.value.counts, pruned });
  });
}

/**
 * The trailing window for series the forward pass no longer visits — one that
 * ended, or was cancelled — so their old occurrences are pruned all the same.
 * Only recurring events: a one-off's single occurrence is the only way it
 * appears in a range at all, and derived-data cleanup must not make an event
 * vanish from its own slot.
 */
export async function pruneTrailingOccurrences(
  input: { familyId: FamilyId },
  deps: { unitOfWork: CalendarUnitOfWorkPort; clock: Clock },
): Promise<number> {
  const { from } = materialisationWindow(deps.clock.now());
  return deps.unitOfWork.withCalendarFamilyContext(input.familyId, (uow) =>
    uow.occurrences.pruneRecurringBefore(from),
  );
}
