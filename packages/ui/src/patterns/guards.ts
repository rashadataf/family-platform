/**
 * Pure validation guards for the four constitution-carrying patterns
 * (Proposal, GatedSurface, Reminder, NotFound). Split out per R13: any
 * module holding a real `react-native` import is unreachable from a
 * `.spec.ts` file, so the throw-on-missing-field logic these patterns rely
 * on lives here, with no `react-native` import, and each pattern's
 * component just calls into it.
 */

export function assertNonEmpty(value: string, field: string, component: string): void {
  if (value.trim() === '') {
    throw new Error(`${component} requires a non-empty ${field}.`);
  }
}

export function assertConfidenceInRange(confidence: number, component: string): void {
  if (!(confidence >= 0 && confidence <= 1)) {
    throw new Error(`${component} requires confidence in [0, 1]; got ${String(confidence)}.`);
  }
}
