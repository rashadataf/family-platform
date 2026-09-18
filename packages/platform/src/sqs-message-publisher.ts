import {
  SQSClient,
  SendMessageCommand,
  GetQueueUrlCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
} from '@aws-sdk/client-sqs';
import type { MessagePublisherPort, MessageToPublish } from '@fp/kernel';

export interface SqsMessagePublisherOptions {
  endpoint: string;
  region: string;
}

/**
 * Real SQS/ElasticMQ client, for composition-root wiring (mirrors
 * `createSmtpTransport`). Tests inject a fake client instead.
 *
 * Deliberately takes no credentials: the AWS SDK's default provider chain
 * reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from the environment on
 * its own. ElasticMQ does not check them — any non-empty values satisfy the
 * SDK, which refuses to send a request with none at all — so Stage 0 sets
 * fixed placeholder values in `docker-compose.yml`, next to
 * `RELAY_QUEUE_ENDPOINT`/`RELAY_QUEUE_REGION`. Stage 1 supplies real ones the
 * same way, through its own deployment secrets: this function's code does
 * not change (ADR-018).
 */
export function createSqsClient(options: SqsMessagePublisherOptions): SQSClient {
  return new SQSClient({ endpoint: options.endpoint, region: options.region });
}

/**
 * `contracts/relay-interfaces.md` §1. A queue name is resolved to its URL via
 * `GetQueueUrlCommand` rather than string concatenation: ElasticMQ's own
 * `QueueUrl` shape (`<endpoint>/<accountId>/<queueName>`) is not guessable
 * from a bare endpoint, and this is the one lookup that is identical at Stage
 * 1 against real SQS. Resolved once per queue name and cached — the topology
 * a name resolves against is fixed for the life of the process (no runtime
 * config file, contracts §5).
 */
export class SqsMessagePublisher implements MessagePublisherPort {
  private readonly queueUrls = new Map<string, string>();

  constructor(private readonly client: SQSClient) {}

  private async resolveQueueUrl(queueName: string): Promise<string> {
    const cached = this.queueUrls.get(queueName);
    if (cached !== undefined) return cached;

    const { QueueUrl } = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (QueueUrl === undefined) {
      throw new Error(`SqsMessagePublisher: no queue URL returned for "${queueName}"`);
    }
    this.queueUrls.set(queueName, QueueUrl);
    return QueueUrl;
  }

  /** `deduplicationId` is a log/debug aid at Stage 0 (not an SQS FIFO feature) — not sent on the wire. */
  async send(message: MessageToPublish): Promise<void> {
    const queueUrl = await this.resolveQueueUrl(message.queueName);
    await this.client.send(
      new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: message.body }),
    );
  }

  async approximateDepth(queueName: string): Promise<number> {
    const queueUrl = await this.resolveQueueUrl(queueName);
    const { Attributes } = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    const raw = Attributes?.ApproximateNumberOfMessages;
    return raw === undefined ? 0 : Number(raw);
  }
}

/**
 * `relay:peek` (quickstart.md), the manual-verification/debug tool — not
 * part of `MessagePublisherPort`, which has no reason to read a message back
 * without consuming it. `VisibilityTimeout: 0` makes the peek genuinely
 * non-destructive: the message is immediately visible again, to a real
 * consumer or a second peek alike, rather than sitting invisible for the
 * queue's normal visibility timeout. Kept in this module, not
 * `apps/worker`, so `@aws-sdk/client-sqs` stays imported from exactly one
 * package (ADR-018).
 */
export async function peekQueueMessages(
  client: SQSClient,
  queueName: string,
): Promise<readonly string[]> {
  const { QueueUrl } = await client.send(new GetQueueUrlCommand({ QueueName: queueName }));
  if (QueueUrl === undefined) {
    throw new Error(`peekQueueMessages: no queue URL returned for "${queueName}"`);
  }

  const { Messages } = await client.send(
    new ReceiveMessageCommand({
      QueueUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,
      WaitTimeSeconds: 2,
    }),
  );

  return (Messages ?? []).map((message) => message.Body ?? '');
}
