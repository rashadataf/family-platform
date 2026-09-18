import { randomUUID } from 'node:crypto';
import type { Clock, MessagePublisherPort } from '@fp/kernel';
import {
  claimUnpublishedOutboxEvents,
  measureOutboxLag,
  type ClaimedOutboxEvent,
} from '@fp/persistence';
import { createSqsClient, SqsMessagePublisher } from '@fp/platform';
import { QUEUE_TOPOLOGY, resolveDestinations } from './queue-topology.js';

/**
 * Rows claimed per tick. A tick's sends all run inside the one claim
 * transaction (`claimUnpublishedOutboxEvents`, 30 s timeout), so this bounds
 * how long that transaction holds its row locks; the 1 s cadence is what
 * keeps a backlog moving.
 */
export const RELAY_BATCH_SIZE = 100;

/**
 * SC-010 (clarified): the age of the oldest unpublished row that raises the
 * alert. The same five minutes `OVERDUE_LAG_ALERT_SECONDS` (spec 010) chose for
 * its own lag, arrived at independently for a different measure (research.md §9).
 */
export const OUTBOX_LAG_ALERT_SECONDS = 300;

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

/**
 * FR-014: whether each DLQ held a message on the previous tick, so an alert
 * fires once when one first does and not on every tick it stays that way —
 * the same edge-triggered, clear-on-recovery shape as
 * `SweepScheduler.checkStalled`. Module-level for the same reason the
 * publisher is: the sweep is a function called every second, and this has to
 * outlive a call.
 */
const dlqNonEmptyLastTick = new Map<string, boolean>();

/**
 * FR-016: whether the previous tick was already over the lag threshold, so the
 * alert fires on the crossing rather than every second it stays crossed, and
 * fires again after a recovery. Independent of `dlqNonEmptyLastTick`: a stuck
 * relay and a poisoned queue are different problems with different remedies.
 */
let lagAlertRaised = false;

/**
 * Logs how far behind the relay is (always) and raises `ALERT
 * outbox_lag_seconds` on the tick it first exceeds the threshold.
 *
 * Measured after the tick's own claim has committed, so it is what the tick
 * could NOT fix — rows a send failed on, or a backlog beyond one batch —
 * not what it was about to (`measureOutboxLag`).
 */
async function reportLag(clock: Clock): Promise<void> {
  const lagSeconds = await measureOutboxLag(clock.now());
  console.log(`outbox_relay_lag_seconds=${String(lagSeconds)}`);

  const over = lagSeconds > OUTBOX_LAG_ALERT_SECONDS;
  if (over && !lagAlertRaised) {
    console.warn(
      `ALERT outbox_lag_seconds=${String(lagSeconds)} threshold=${String(OUTBOX_LAG_ALERT_SECONDS)}`,
    );
  }
  lagAlertRaised = over;
}

interface QueueDepths {
  /** `ApproximateNumberOfMessages` on the queue itself: delivered, not yet consumed. */
  readonly pending: number;
  /** The same, on its dead-letter queue. */
  readonly dlq: number;
}

/**
 * Read once per tick, after the sends: the summary line (FR-017) and the
 * dead-letter alert (FR-014) both need every queue's depths, and asking
 * ElasticMQ twice for the same number would only let the two disagree.
 */
async function readQueueDepths(
  publisher: MessagePublisherPort,
): Promise<ReadonlyMap<string, QueueDepths>> {
  const depths = new Map<string, QueueDepths>();
  for (const queue of QUEUE_TOPOLOGY) {
    depths.set(queue.name, {
      pending: await publisher.approximateDepth(queue.name),
      dlq: await publisher.approximateDepth(queue.dlqName),
    });
  }
  return depths;
}

/**
 * FR-017: per configured queue, what this tick delivered to it, what is now
 * waiting on it, and what sits on its dead-letter queue — one `queue=…` group
 * each, appended to the tick's `outbox_relay_run` line so a single grep shows
 * whether every queue is keeping up.
 */
function formatQueueCounts(
  delivered: ReadonlyMap<string, number>,
  depths: ReadonlyMap<string, QueueDepths>,
): string {
  return QUEUE_TOPOLOGY.map(
    (queue) =>
      `queue=${queue.name} delivered=${String(delivered.get(queue.name) ?? 0)} pending=${String(depths.get(queue.name)?.pending ?? 0)} dlq=${String(depths.get(queue.name)?.dlq ?? 0)}`,
  ).join(' ');
}

/**
 * Logs every DLQ's depth (always) and raises `ALERT dead_letter_arrived` on the
 * tick a DLQ first becomes non-empty. A message on a DLQ is one a consumer
 * failed on `maxReceiveCount` times, so it needs a person (FR-013).
 */
function reportDeadLetters(depths: ReadonlyMap<string, QueueDepths>): void {
  for (const queue of QUEUE_TOPOLOGY) {
    const depth = depths.get(queue.name)?.dlq ?? 0;
    console.log(`outbox_relay_dlq_depth queue=${queue.dlqName} depth=${String(depth)}`);

    const nonEmpty = depth > 0;
    if (nonEmpty && dlqNonEmptyLastTick.get(queue.dlqName) !== true) {
      console.warn(`ALERT dead_letter_arrived queue=${queue.dlqName} depth=${String(depth)}`);
    }
    dlqNonEmptyLastTick.set(queue.dlqName, nonEmpty);
  }
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
  clock: Clock,
  hooks: OutboxRelaySweepHooks = {},
): Promise<OutboxRelaySweepResult> {
  const publisher = defaultPublisher();
  const correlationId = randomUUID();
  /** Messages this tick put on each queue (FR-017). Counted as they are sent, not as rows finish. */
  const delivered = new Map<string, number>();

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
            delivered.set(destination.name, (delivered.get(destination.name) ?? 0) + 1);
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

  const depths = await readQueueDepths(publisher);

  console.log(
    `outbox_relay_run claimed=${String(result.claimed)} published=${String(result.published)} sent=${String(result.sent)} failed=${String(result.failed.length)} ${formatQueueCounts(delivered, depths)} [correlationId=${correlationId}]`,
  );

  await reportLag(clock);
  reportDeadLetters(depths);

  return result;
}
