/**
 * ADR-005 Layer 3, ADR-018. Declared here rather than under a context's own
 * `application/ports` because the relay is the same mechanism for every
 * bounded context, exactly as `OutboxPort` is (ARCHITECTURE.md §7.3) —
 * `packages/platform`'s `SqsMessagePublisher` provides the one
 * implementation, pointed at ElasticMQ at Stage 0 and real SQS at Stage 1
 * through configuration alone, never a code branch.
 */
export interface MessageToPublish {
  readonly queueName: string;
  /** The envelope, already serialised (contracts/relay-interfaces.md §3). */
  readonly body: string;
  /** The outbox_event id; not an SQS FIFO feature, just a log/debug aid at Stage 0. */
  readonly deduplicationId: string;
}

export interface MessagePublisherPort {
  send(message: MessageToPublish): Promise<void>;
  /** `ApproximateNumberOfMessages` for the named queue — what FR-014/FR-017's
   *  "observable at all times" read each tick, for a DLQ's depth and for a
   *  live queue's pending count alike. */
  approximateDepth(queueName: string): Promise<number>;
}
