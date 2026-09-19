import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
} from '@aws-sdk/client-sqs';
import type { ProcessedEventPort } from '@fp/kernel';

export type ConsumerOutcome = 'processed' | 'duplicate';

/**
 * Parses the envelope itself (Principle II). Returns `'duplicate'` only if it
 * independently detects a repeat — ordinarily it returns `'processed'` and
 * lets `SqsConsumer`'s own `ProcessedEventPort` check be the thing that skips
 * a genuine duplicate delivery. The return value is for the caller's own
 * bookkeeping only: `SqsConsumer` acks and marks on a resolved promise
 * regardless of which outcome it carries, and never acks on a thrown one.
 */
export type ConsumerHandler = (envelope: unknown) => Promise<ConsumerOutcome>;

export interface SqsConsumerOptions {
  readonly queueName: string;
  readonly handler: ConsumerHandler;
}

interface RelayEnvelope {
  readonly eventId: string;
}

function parseEnvelope(body: string): RelayEnvelope {
  const parsed: unknown = JSON.parse(body);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).eventId !== 'string'
  ) {
    throw new Error('SqsConsumer: message body is not a relay envelope (missing "eventId")');
  }
  return parsed as RelayEnvelope;
}

/**
 * `contracts/relay-interfaces.md` §4: the base idempotent consumer every
 * future real consumer (Reminders, most likely) builds on, and the only
 * thing `apps/worker/src/test-support/stub-consumer.ts` (research.md §11)
 * exercises. `packages/platform` stays database-agnostic (Principle IV), so
 * "same transaction as the handler's work" is a real consumer's own
 * responsibility, constructing its `ProcessedEventPort` against its own unit
 * of work — this class only guarantees idempotency is checked before the
 * handler runs and recorded after it succeeds, on the handler's own say-so.
 */
export class SqsConsumer {
  private readonly queueUrls = new Map<string, string>();

  constructor(
    private readonly options: SqsConsumerOptions,
    private readonly processedEvents: ProcessedEventPort,
    private readonly client: SQSClient,
  ) {}

  private async resolveQueueUrl(queueName: string): Promise<string> {
    const cached = this.queueUrls.get(queueName);
    if (cached !== undefined) return cached;

    const { QueueUrl } = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (QueueUrl === undefined) {
      throw new Error(`SqsConsumer: no queue URL returned for "${queueName}"`);
    }
    this.queueUrls.set(queueName, QueueUrl);
    return QueueUrl;
  }

  /**
   * Long-polls once; processes at most the batch SQS/ElasticMQ returns;
   * never throws past this call — a per-message failure is counted, not
   * propagated, so one poison message never stops the rest of the batch
   * (User Story 2, acceptance scenario 4).
   */
  async pollOnce(): Promise<{ handled: number; duplicates: number; failed: number }> {
    const queueUrl = await this.resolveQueueUrl(this.options.queueName);
    const { Messages } = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 5,
      }),
    );

    let handled = 0;
    let duplicates = 0;
    let failed = 0;

    for (const message of Messages ?? []) {
      if (message.Body === undefined || message.ReceiptHandle === undefined) {
        failed += 1;
        continue;
      }

      let envelope: RelayEnvelope;
      try {
        envelope = parseEnvelope(message.Body);
      } catch {
        // Cannot even extract an eventId; left unacknowledged like any other
        // failure — redelivery and maxReceiveCount govern its fate (FR-013).
        failed += 1;
        continue;
      }

      const alreadyProcessed = await this.processedEvents.wasProcessed(
        this.options.queueName,
        envelope.eventId,
      );
      if (alreadyProcessed) {
        await this.client.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
        );
        duplicates += 1;
        continue;
      }

      try {
        await this.options.handler(envelope);
      } catch {
        failed += 1;
        continue;
      }

      await this.processedEvents.markProcessed(this.options.queueName, envelope.eventId);
      await this.client.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
      );
      handled += 1;
    }

    return { handled, duplicates, failed };
  }
}
