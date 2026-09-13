import { findChildrenWithoutGuardian, type UncoveredChild } from '@fp/persistence';

export interface SweepResult {
  readonly uncoveredChildren: readonly UncoveredChild[];
}

/**
 * SC-006, measured rather than merely asserted at the moment of each
 * mutation (research.md §6): every mutating path that could leave a child
 * with zero active guardians already refuses to, so a healthy system
 * should always find nothing here. This sweep is what turns "should" into
 * something checked.
 *
 * "Alerts on any value above zero" means a structured WARN log line here,
 * joined to nothing further — this platform has no metrics or alerting
 * pipeline yet (the same accepted gap spec 006's own tasks.md T059 note
 * records for identity), so a searchable log line is what "alert" means
 * until one exists.
 */
export async function runGuardianCoverageSweep(): Promise<SweepResult> {
  const uncoveredChildren = await findChildrenWithoutGuardian();

  if (uncoveredChildren.length > 0) {
    console.warn(
      `ALERT family_children_without_guardian=${String(uncoveredChildren.length)}`,
      uncoveredChildren,
    );
  }

  return { uncoveredChildren };
}
