/**
 * `contracts/relay-interfaces.md` §5: the single source of truth for the
 * relay's queues — read by the relay tick (via `resolveDestinations`, below)
 * AND rendered into ElasticMQ's config by `render-elasticmq-config.ts`.
 * Adding a queue means editing this file only; the `.conf` file is never
 * hand-edited (research.md §4).
 */
export interface QueueDefinition {
  readonly name: string;
  readonly dlqName: string;
  /** Receives before redrive to the DLQ (spec.md clarification: 5). */
  readonly maxReceiveCount: number;
  readonly subscribedEventTypes: readonly string[];
}

export const QUEUE_TOPOLOGY: readonly QueueDefinition[] = [
  {
    name: 'outbox-relay-verification',
    dlqName: 'outbox-relay-verification-dlq',
    maxReceiveCount: 5,
    // Test-only event type, never emitted by a real producing context.
    subscribedEventTypes: ['relay.VerificationPing.v1'],
  },
  // A real context's first real subscription is added here by the feature
  // that needs it (Reminders, most likely), not by this one.
];

/**
 * Every queue subscribed to `eventType`, or an empty array for one nobody
 * consumes yet (FR-004/SC-006) — the relay still marks that row published,
 * having sent to zero destinations (data-model.md's lifecycle diagram).
 */
export function resolveDestinations(
  eventType: string,
  topology: readonly QueueDefinition[] = QUEUE_TOPOLOGY,
): readonly QueueDefinition[] {
  return topology.filter((queue) => queue.subscribedEventTypes.includes(eventType));
}
