import { randomUUID } from 'node:crypto';
import { calendar } from '@fp/core';
import type { CalendarEventId, Clock, FamilyId } from '@fp/kernel';
import {
  createCalendarUnitOfWork,
  findEventsDueForMaterialisation,
  findFamiliesWithPrunableOccurrences,
  measureCalendarHorizons,
} from '@fp/persistence';

const SECONDS_PER_DAY = 86_400;

export interface HorizonLag {
  readonly familyId: FamilyId;
  /** `min(materialised_through) − now`, in seconds (contracts/calendar-api.md). */
  readonly lagSeconds: number;
}

export interface MaterialiseSweepResult {
  readonly extended: number;
  readonly skipped: number;
  readonly failed: readonly CalendarEventId[];
  readonly occurrencesInserted: number;
  readonly occurrencesDeleted: number;
  readonly occurrencesPruned: number;
  /** Families whose horizon is still short of the configured distance after this pass — the alert. */
  readonly lagging: readonly HorizonLag[];
  /** The smallest lag across every family, or `null` when no family has a continuing series. */
  readonly minLagSeconds: number | null;
}

/**
 * FR-024–FR-026, User Story 5: the horizon advances on its own, so an
 * indefinitely repeating event keeps producing occurrences with nobody
 * re-saving it.
 *
 * One family-scoped transaction per event (`materialiseHorizon`), so a single
 * bad event fails alone and the rest of the pass still runs; re-running after
 * an interruption resumes without duplicating anything, because idempotence is
 * the `(event_id, starts_at)` identity rather than anything this function
 * remembers (FR-025). The trailing window is pruned in the same pass
 * (research.md §4, §10).
 *
 * The horizon lag is measured AFTER the pass, so what it reports is what the
 * sweep could not fix — a structured `ALERT` line, spec 008's convention for
 * "alert" on a platform with no metrics pipeline yet
 * (`guardian-coverage.sweep.ts`). Identifiers and numbers only.
 */
export async function runMaterialiseOccurrencesSweep(
  clock: Clock,
): Promise<MaterialiseSweepResult> {
  const unitOfWork = createCalendarUnitOfWork();
  const correlationId = randomUUID();
  const now = clock.now();
  const window = calendar.materialisationWindow(now);

  let extended = 0;
  let skipped = 0;
  let occurrencesInserted = 0;
  let occurrencesDeleted = 0;
  let occurrencesPruned = 0;
  const failed: CalendarEventId[] = [];

  for (const due of await findEventsDueForMaterialisation(window.to)) {
    const startedAt = performance.now();
    try {
      const outcome = await calendar.materialiseHorizon(
        { familyId: due.familyId, eventId: due.eventId, correlationId },
        { unitOfWork, clock },
      );
      if (!outcome.ok) {
        failed.push(due.eventId);
        console.error(
          `calendar materialisation refused event=${due.eventId} kind=${outcome.error.kind} [correlationId=${correlationId}]`,
        );
      } else if (outcome.value.status === 'skipped') {
        skipped += 1;
      } else {
        extended += 1;
        occurrencesInserted += outcome.value.counts.inserted;
        occurrencesDeleted += outcome.value.counts.deleted;
        occurrencesPruned += outcome.value.pruned;
      }
    } catch (error) {
      failed.push(due.eventId);
      console.error(
        `calendar materialisation failed event=${due.eventId} [correlationId=${correlationId}]`,
        error instanceof Error ? error.name : 'unknown error',
      );
    } finally {
      // `calendar_materialisation_duration` — research.md §11's 50 ms per-event budget.
      console.log(
        `calendar_materialisation_duration_ms=${(performance.now() - startedAt).toFixed(1)} event=${due.eventId}`,
      );
    }
  }

  for (const familyId of await findFamiliesWithPrunableOccurrences(window.from)) {
    occurrencesPruned += await calendar.pruneTrailingOccurrences(
      { familyId },
      { unitOfWork, clock },
    );
  }

  console.log(
    `calendar_occurrences_written_total op=insert value=${String(occurrencesInserted)} [correlationId=${correlationId}]`,
  );
  console.log(
    `calendar_occurrences_written_total op=delete value=${String(occurrencesDeleted + occurrencesPruned)} [correlationId=${correlationId}]`,
  );

  const lags: HorizonLag[] = (await measureCalendarHorizons()).map((horizon) => ({
    familyId: horizon.familyId,
    lagSeconds: Math.floor((horizon.materialisedThrough.getTime() - now.getTime()) / 1000),
  }));
  const minLagSeconds = lags.length === 0 ? null : Math.min(...lags.map((lag) => lag.lagSeconds));
  const lagging = lags.filter((lag) => lag.lagSeconds < calendar.HORIZON_DAYS * SECONDS_PER_DAY);

  if (minLagSeconds !== null) {
    console.log(`calendar_horizon_lag_seconds=${String(minLagSeconds)}`);
  }
  if (lagging.length > 0) {
    console.warn(
      `ALERT calendar_horizon_lagging_families=${String(lagging.length)}`,
      lagging.map((lag) => ({ familyId: lag.familyId, lagSeconds: lag.lagSeconds })),
    );
  }

  return {
    extended,
    skipped,
    failed,
    occurrencesInserted,
    occurrencesDeleted,
    occurrencesPruned,
    lagging,
    minLagSeconds,
  };
}
