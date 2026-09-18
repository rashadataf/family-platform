import { randomUUID } from 'node:crypto';
import type { Clock, MessagePublisherPort } from '@fp/kernel';
import { claimUnpublishedOutboxEvents, type ClaimedOutboxEvent } from '@fp/persistence';
import { createSqsClient, SqsMessagePublisher } from '@fp/platform';
import { resolveDestinations } from './queue-topology.js';

/**
 * Rows claimed per tick. A tick's sends all run inside the one claim
 * transaction (`claimUnpublishedOutboxEvents`, 30 s timeout), so this bounds
 * how long that transaction holds its row locks; the 1 s cadence is what
 * keeps a backlog moving.
 */
export const RELAY_BATCH_SIZE = 100;

export interface OutboxRelaySweepResult {
  /** Rows this tick locked. */
  readonly claimed: number;
  /** Rows marked published — delivered everywhere they were routed, including nowhere (FR-004). */
  readonly published: number;
  /** Messages actually sent; a row routed to no queue adds none. */
  readonly sent: number;
  /** Rows whose send failed. Left unpublished, so a later tick claims them again (FR-003). */
  readonly failed: readonly string[];
}

/**
 * A seam for interrupting a tick, used only by
 * `outbox-relay.sweep.integration.spec.ts` (mirrors `OverdueSweepHooks`).
 *
 * "No event is lost across a crash" (SC-002) is not a property a test can
 * show without actually failing a tick between the send and the commit.
 * Production callers pass nothing.
 */
export interface OutboxRelaySweepHooks {
  /**
   * Runs after every send for a row has succeeded and before the claim
   * transaction commits. A throw escapes the tick and rolls the claim back,
   * which is what a crash at that point does.
   */
  afterSend?(eventId: string, index: number): void | Promise<void>;
}

/**
 * The publisher is built from the environment, not from `parseWorkerEnv()`:
 * that module imports the sweep registry, which imports this file. The
 * variables are validated at worker boot all the same (contracts §6).
 *
 * Kept for the life of the process — a tick runs every second, and a client
 * per tick would open and abandon a connection pool each time. Keyed on the
 * settings so a changed environment gets a fresh one.
 */
let cachedPublisher: { readonly key: string; readonly publisher: MessagePublisherPort } | undefined;

function defaultPublisher(): MessagePublisherPort {
  const endpoint = process.env.RELAY_QUEUE_ENDPOINT;
  const region = process.env.RELAY_QUEUE_REGION;
  if (endpoint === undefined || endpoint === '' || region === undefined || region === '') {
    throw new Error('outbox relay: RELAY_QUEUE_ENDPOINT and RELAY_QUEUE_REGION must be set');
  }

  const key = `${endpoint}|${region}`;
  if (cachedPublisher?.key !== key) {
    cachedPublisher = {
      key,
      publisher: new SqsMessagePublisher(createSqsClient({ endpoint, region })),
    };
  }
  return cachedPublisher.publisher;
}

/** contracts/relay-interfaces.md §3: exactly these seven fields, forwarded unchanged. */
function serialiseEnvelope(event: ClaimedOutboxEvent): string {
  return JSON.stringify({
    eventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    payload: event.payload,
  });
}

/**
 * FR-001–FR-006, User Story 1: events that were committed to the outbox reach
 * their queue with nobody looking (ADR-005 Layer 3).
 *
 * Claim, send and mark are ONE transaction, so a crash anywhere between the
 * send and the commit rolls the claim back and the next tick sends the row
 * again. That is at-least-once: a duplicate is the accepted cost, and the
 * consumer's `processed_event` ledger is what absorbs it (FR-011).
 *
 * A row whose send fails is collected, never thrown: it stays unpublished for
 * a later tick, and the rest of the batch still goes out. A row with no
 * subscribed queue is marked published having sent nothing (FR-004).
 *
 * The log line carries identifiers and counts only — never a payload
 * (Principle VI, SC-011).
 */
export async function runOutboxRelaySweep(
  _clock: Clock,
  hooks: OutboxRelaySweepHooks = {},
): Promise<OutboxRelaySweepResult> {
  const publisher = defaultPublisher();
  const correlationId = randomUUID();

  const result = await claimUnpublishedOutboxEvents(
    RELAY_BATCH_SIZE,
    async (claimed, markPublished) => {
      const finished: string[] = [];
      const failed: string[] = [];
      let sent = 0;

      for (const [index, event] of claimed.entries()) {
        const destinations = resolveDestinations(event.eventType);
        const body = serialiseEnvelope(event);

        try {
          for (const destination of destinations) {
            await publisher.send({
              queueName: destination.name,
              body,
              deduplicationId: event.id,
            });
            sent += 1;
          }
        } catch (error) {
          failed.push(event.id);
          console.error(
            `outbox relay send failed event=${event.id} type=${event.eventType} [correlationId=${correlationId}]`,
            error instanceof Error ? error.name : 'unknown error',
          );
          continue;
        }

        finished.push(event.id);
        // Outside the try above: an interruption must escape, not be counted as a failed send.
        await hooks.afterSend?.(event.id, index);
      }

      await markPublished(finished);
      return {
        claimed: claimed.length,
        published: finished.length,
        sent,
        failed,
      } satisfies OutboxRelaySweepResult;
    },
  );

  console.log(
    `outbox_relay_run claimed=${String(result.claimed)} published=${String(result.published)} sent=${String(result.sent)} failed=${String(result.failed.length)} [correlationId=${correlationId}]`,
  );

  return result;
}
