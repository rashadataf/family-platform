import type { ConsumerHandler, ConsumerOutcome } from '@fp/platform';

/**
 * Test-only (FR-012, research.md §11): proves `SqsConsumer` end to end
 * without building a real context's business logic. Never registered in
 * `main.ts` — imported only by integration specs.
 */
export interface StubConsumerCounters {
  successes: number;
  failures: number;
}

function hasForceFailure(envelope: unknown): boolean {
  if (typeof envelope !== 'object' || envelope === null) return false;
  const payload = (envelope as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null) return false;
  return (payload as { forceFailure?: unknown }).forceFailure === true;
}

/**
 * Reads `forceFailure` out of the envelope's payload (quickstart.md's own
 * example: `{"note":"scenario-3","forceFailure":true}`) and either always
 * succeeds, incrementing `counters.successes`, or always throws,
 * incrementing `counters.failures` first so a failed attempt is still
 * counted. `counters` is supplied by the caller so a test can assert on it
 * directly — e.g. that a handler's own side effect was recorded exactly
 * once across a duplicate delivery (SC-008, FR-011).
 */
export function createStubConsumer(counters: StubConsumerCounters): ConsumerHandler {
  return (envelope: unknown): Promise<ConsumerOutcome> => {
    if (hasForceFailure(envelope)) {
      counters.failures += 1;
      throw new Error('stub consumer: forced failure (payload.forceFailure=true)');
    }
    counters.successes += 1;
    return Promise.resolve('processed');
  };
}
