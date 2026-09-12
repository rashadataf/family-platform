/**
 * The only source of "now" any domain or application code may consult.
 * Injected rather than read from `Date.now()` directly, so retention sweeps
 * and expiry checks are testable by moving a fake clock forward instead of
 * waiting out real time (quickstart.md Scenario 7).
 */
export interface Clock {
  now(): Date;
}
