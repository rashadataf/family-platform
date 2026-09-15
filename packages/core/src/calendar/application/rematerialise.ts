import { ok, type DomainError, type Result } from '@fp/kernel';
import type { CalendarEvent } from '../domain/calendar-event.aggregate.js';
import {
  materialisationWindow,
  planOccurrences,
  reconcile,
  type MaterialisationWindow,
} from '../domain/materialisation.js';
import type { CalendarUnitOfWork } from './ports/calendar-unit-of-work.port.js';
import type { ReconcileCounts } from './ports/event-occurrence.repository.js';

export interface Rematerialised {
  readonly window: MaterialisationWindow;
  readonly counts: ReconcileCounts;
  /** Occurrences the event has in the window once the plan is applied. */
  readonly occurrenceCount: number;
}

/**
 * Create, edit and the sweep all converge here: plan the occurrences the event
 * should have now, reconcile them against the rows it has, apply the
 * difference, and move `materialised_through` — inside the caller's
 * transaction, so the marker and the rows it describes commit together.
 *
 * Mutates `event`'s marker; the caller saves the event.
 */
export async function rematerialise(
  uow: CalendarUnitOfWork,
  event: CalendarEvent,
  now: Date,
): Promise<Result<Rematerialised, DomainError>> {
  const window = materialisationWindow(now);
  const plan = planOccurrences(event, window);
  if (!plan.ok) return plan;

  const existing = await uow.occurrences.listForEvent(
    event.id,
    plan.value.scopeFrom === null ? undefined : { startingFrom: plan.value.scopeFrom },
  );
  const counts = await uow.occurrences.applyPlan(event.id, reconcile(plan.value.planned, existing));
  event.recordMaterialisedThrough(plan.value.materialisedThrough);

  return ok({ window, counts, occurrenceCount: plan.value.planned.length });
}
