# Data Model: Outbox Relay (spec 011)

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

One new table. **No change to `outbox_event`, or to any table any existing context owns** (FR-019).
No RLS policy applies to anything in this feature — neither table here is family-scoped, for the same
reason `IdempotencyKey` already is not: both record "was this seen before," never family data.

## `outbox_event` (existing, spec 006 — read and updated, not redefined)

Listed for reference only; this feature adds no column.

| Column | Type | Relevant to this feature because |
|---|---|---|
| `id` | `uuid` PK | The idempotency key a consumer's `processed_event` row is keyed against |
| `event_type` | `text` | What `queue-topology.ts`'s subscription map resolves against |
| `aggregate_type` / `aggregate_id` | `text` | Forwarded unchanged in the message; not interpreted by the relay |
| `payload` | `jsonb` | Forwarded unchanged; the relay never reads a key out of it |
| `occurred_at` | `timestamptz` | What `measureOutboxLag` measures the age of |
| `published_at` | `timestamptz` NULL | **The field this feature writes.** `NULL` = claimable. Set (regardless of how many queues received a message, including zero) = done |
| `correlation_id` | `text` | Forwarded unchanged |

**Claiming.** `SELECT id, event_type, aggregate_type, aggregate_id, payload, occurred_at,
correlation_id FROM outbox_event WHERE published_at IS NULL ORDER BY occurred_at LIMIT $1 FOR UPDATE
SKIP LOCKED`, inside a transaction that then does the publishing and, in the same transaction,
executes `UPDATE outbox_event SET published_at = now() WHERE id = ANY($1)` for every row it
successfully finished with (research.md §6). A row whose publish attempt fails is left with
`published_at IS NULL` and is claimable again on the next tick — the `SKIP LOCKED` row lock is released
when the transaction rolls back or completes without marking it, exactly the "leave it unpublished and
eligible for a later claim" FR-003 requires.

**No `delivery_count` column.** Considered and rejected (research.md §6/§7): nothing in this feature's
requirements ever reads "how many queues did this reach" back from the row. The lag measure and the
zero-subscriber success criterion (SC-006) are both proven from `published_at` alone.

## `ProcessedEvent` (new)

The consumer-side idempotency ledger ARCHITECTURE.md §7.3's sequence diagram names `processed_events`,
generalised to key on the queue as well as the event: two different consumers reading the same queue
(not a configuration this feature ships, but not one the schema should preclude) must not share one
ledger entry.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | Surrogate; not otherwise referenced |
| `queue_name` | `text` NOT NULL | Which queue's consumer processed this. Part of the natural key |
| `event_id` | `uuid` NOT NULL | The `outbox_event.id` this message carries. **Not** a foreign key — a consumer in a later feature may run against a different database, or the source row may be long gone; the idempotency check must not depend on the source row still existing |
| `processed_at` | `timestamptz` NOT NULL, default `now()` | When the handler completed. Operational, not user data |
| — | `UNIQUE (queue_name, event_id)` | The invariant the whole table exists for: `INSERT ... ON CONFLICT (queue_name, event_id) DO NOTHING` inside the handler's own transaction is what turns "acknowledge and re-run the handler" into "acknowledge, do nothing" on a duplicate delivery |

**Not family-scoped, no RLS.** Mirrors `IdempotencyKey`'s existing exception to the "every table is
family-scoped" rule (ARCHITECTURE §10): this table records delivery facts about the messaging
mechanism, not anything about a family.

**No enforced retention (Assumptions, spec.md).** Grows without bound under this feature alone. At
Stage 0 volumes (every event type currently zero real subscribers, one verification queue used only by
tests) this is not operationally significant; a later feature that adds a real, high-volume consumer is
where a pruning policy becomes worth building, not before it has real data to be sized against.

## Prisma sketch

```prisma
model ProcessedEvent {
  id          String   @id @default(uuid(7))
  queueName   String   @map("queue_name")
  eventId     String   @map("event_id")
  processedAt DateTime @default(now()) @map("processed_at")

  @@unique([queueName, eventId])
  @@map("processed_event")
}
```

UUIDv7 (`uuid(7)`), consistent with every table added since spec 008 (ARCHITECTURE §10); `outbox_event`
predates that convention and is left as-is, since this feature does not touch it.

## Configuration, not data: queue topology

Not a database table — a committed TypeScript module (`apps/worker/src/relay/queue-topology.ts`),
imported at process start, immutable at runtime. Documented here because it is the other thing this
feature's persistence layer reads to decide what to do with a claimed row.

```ts
interface QueueDefinition {
  readonly name: string;
  readonly dlqName: string;
  readonly maxReceiveCount: number; // default 5 (spec.md clarification), overridable per queue with a documented reason
  readonly subscribedEventTypes: readonly string[]; // exact `event_type` strings, e.g. 'tasks.TaskCreated.v1'
}
```

Resolution at claim time: for a claimed row's `event_type`, the set of queues whose
`subscribedEventTypes` contains it — zero, one, or (not exercised by any queue this feature ships, but
not precluded) more than one. See [contracts/relay-interfaces.md](contracts/relay-interfaces.md) for
the full shape and the rendered ElasticMQ config it produces.

## Lifecycle summary

```text
outbox_event row written (Layer 2, existing contexts, unchanged)
        │
        ▼  published_at IS NULL
   claimed by relay tick (FOR UPDATE SKIP LOCKED)
        │
        ├─ event_type has 0 configured queues ──────────────► published_at = now(), 0 messages sent
        │
        └─ event_type has ≥1 configured queue
                │
                ▼
        published to each queue (MessagePublisherPort)
                │
        all succeeded? ── no ──► published_at stays NULL, reclaimed next tick
                │
               yes
                │
                ▼
        published_at = now()
                │
                ▼ (independently, per queue, per consumer)
        message delivered to a consumer (SqsConsumer)
                │
        ProcessedEvent(queue_name, event_id) exists? ── yes ──► ack, no-op (FR-011)
                │
                no
                │
                ▼
        handler runs; ProcessedEvent inserted in the same transaction
                │
        receive count > maxReceiveCount? ── yes (across redeliveries) ──► moved to DLQ (FR-013)
```
