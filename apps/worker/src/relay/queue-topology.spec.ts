import { describe, expect, it } from 'vitest';
import { QUEUE_TOPOLOGY, resolveDestinations } from './queue-topology.js';

/**
 * FR-004/SC-006 depend on this being exact: an event type with no
 * subscription must resolve to NOTHING (so the relay marks it published
 * without sending), and the one type that has a subscription must resolve to
 * exactly its queue. Subscriptions match on the whole `event_type` string —
 * a version bump or a shared prefix is a different event type.
 */
describe('resolveDestinations', () => {
  it('returns the one configured queue for relay.VerificationPing.v1', () => {
    const destinations = resolveDestinations('relay.VerificationPing.v1', QUEUE_TOPOLOGY);

    expect(destinations.map((queue) => queue.name)).toEqual(['outbox-relay-verification']);
    expect(destinations[0]?.dlqName).toBe('outbox-relay-verification-dlq');
  });

  it.each([
    ['a real context event nobody subscribes to', 'tasks.TaskCreated.v1'],
    ['a different version of the subscribed type', 'relay.VerificationPing.v2'],
    ['a prefix of the subscribed type', 'relay.VerificationPing'],
    ['a different case', 'relay.verificationping.v1'],
    ['an empty string', ''],
  ])('returns an empty array for %s', (_description, eventType) => {
    expect(resolveDestinations(eventType, QUEUE_TOPOLOGY)).toEqual([]);
  });

  it('resolves against the committed topology when none is passed', () => {
    expect(resolveDestinations('relay.VerificationPing.v1')).toEqual(
      resolveDestinations('relay.VerificationPing.v1', QUEUE_TOPOLOGY),
    );
    expect(resolveDestinations('tasks.TaskCreated.v1')).toEqual([]);
  });
});
