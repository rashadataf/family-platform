# Quickstart: Outbox Relay (spec 011)

Phase 1 output. Runnable scenarios that prove Layer 3 actually delivers, survives a crash, quarantines
a poison message, and stays quiet about events nobody subscribes to yet. No HTTP route exists for this
feature — verification is against the database, the queue, and the worker's own logs.

Interfaces are in [contracts/relay-interfaces.md](contracts/relay-interfaces.md); fields are in
[data-model.md](data-model.md). Not repeated here.

## Prerequisites

Docker, and nothing else ([ADR-014](../../adr/ADR-014-containerized-development.md)). This feature
adds the `elasticmq` service to the base `docker-compose.yml`, so a plain `docker compose up` is enough
— no separate installation of an AWS CLI or any queue tooling.

```sh
cp .env.example .env
docker compose up
docker compose logs worker --tail=5   # confirm the scheduler has started; see worker_sweep_scheduled sweep=outbox-relay
```

`relay:peek`, added by this feature, reads and prints (without removing) whatever is currently on a
named queue — the one tool these scenarios use beyond `docker compose` and `psql`:

```sh
docker compose exec worker pnpm --filter @fp/worker relay:peek outbox-relay-verification
```

`relay:seed`, also added by this feature, writes one `outbox_event` row directly, bypassing every
producing context — this is the only place in the codebase that writes an outbox row without going
through a real command handler, and it exists only for these scenarios and the integration suite:

```sh
docker compose exec worker pnpm --filter @fp/worker relay:seed --event-type relay.VerificationPing.v1 --payload '{"note":"hello"}'
```

---

## Scenario 1: An event reaches its queue, quickly (User Story 1, FR-001–006)

```sh
docker compose exec worker pnpm --filter @fp/worker relay:seed --event-type relay.VerificationPing.v1 --payload '{"note":"scenario-1"}'
sleep 6
docker compose exec worker pnpm --filter @fp/worker relay:peek outbox-relay-verification
```

**Expect** the message on the queue within the sleep, carrying `eventId`, `eventType`
(`relay.VerificationPing.v1`), `occurredAt`, `correlationId`, and the payload unchanged
(`{"note":"scenario-1"}`). Check the outbox row itself:

```sh
docker compose exec postgres psql -U family_platform_owner -d family_platform \
  -c "select published_at is not null as published from outbox_event order by occurred_at desc limit 1;"
```

**Expect** `published = t`.

---

## Scenario 2: The relay survives being killed mid-cycle (User Story 1, FR-006, FR-022)

```sh
docker compose exec worker pnpm --filter @fp/worker relay:seed --event-type relay.VerificationPing.v1 --payload '{"note":"scenario-2"}'
docker compose kill worker    # simulate a crash between claim and publish
docker compose up -d worker
sleep 8
docker compose exec worker pnpm --filter @fp/worker relay:peek outbox-relay-verification
```

**Expect** the message present exactly once on the queue (at-least-once may occasionally show a
duplicate if the kill landed after the publish but before the mark — that is the documented,
acceptable outcome of at-least-once delivery, not a bug; SC-002 is about zero **loss**, not zero
possible duplication at the transport). The important assertion is that it is present at all: `select
published_at from outbox_event order by occurred_at desc limit 1;` is non-null after the restart.

---

## Scenario 3: A poison message is quarantined, not lost, and an alert fires (User Story 2, FR-013–015)

```sh
docker compose exec worker pnpm --filter @fp/worker relay:seed --event-type relay.VerificationPing.v1 \
  --payload '{"note":"scenario-3","forceFailure":true}'   # the stub consumer's test-support fixture
                                                            # is wired, in the integration suite only,
                                                            # to fail on forceFailure — see
                                                            # apps/worker/src/test-support/stub-consumer.ts.
                                                            # This manual scenario instead uses the
                                                            # integration test directly:
pnpm test:integration -- dead-letter
```

**Expect** the test to assert: the message is redelivered up to `maxReceiveCount` (5), then appears on
`outbox-relay-verification-dlq` (confirm with `docker compose exec worker pnpm --filter @fp/worker relay:peek
outbox-relay-verification-dlq`), and the worker log contains exactly one line matching
`ALERT dead_letter_arrived queue=outbox-relay-verification`. A second message published to the same
queue in the same test run is still delivered normally, proving one poison message does not block
others (User Story 2's fourth acceptance scenario).

---

## Scenario 4: Nobody's listening yet, and that's fine (User Story 4, FR-004, SC-006)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/tasks \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -d '{"title":"Nothing subscribes to this yet"}'
sleep 3
docker compose exec postgres psql -U family_platform_owner -d family_platform \
  -c "select event_type, published_at is not null as published from outbox_event where aggregate_type = 'Task' order by occurred_at desc limit 1;"
```

(Requires a family and `$ADA`'s token — run [spec 008's quickstart](../008-family-membership/quickstart.md)
through Scenario 1 first if starting fresh.)

**Expect** `event_type = tasks.TaskCreated.v1`, `published = t`, with nothing on any queue for it — it
has no entry in `queue-topology.ts`. Now check the lag measure stays flat under a burst of these:

```sh
docker compose logs worker --tail=20 | grep outbox_relay_lag_seconds
```

**Expect** the value at or near zero, not climbing, even though several unrouted events were just
published — the zero-subscriber path marks them published on the same tick it claims them (research.md
§7).

---

## Scenario 5: The lag alert fires when the relay actually falls behind (User Story 3, FR-016, SC-010)

```sh
docker compose stop worker
for i in $(seq 1 20); do
  docker compose exec worker pnpm --filter @fp/worker relay:seed --event-type relay.VerificationPing.v1 --payload "{\"note\":\"$i\"}"
done
```

Wait past the 5-minute threshold (or, for a faster check, read the integration test that fixes the
clock instead of sleeping five real minutes: `pnpm test:integration -- outbox-lag`),
then:

```sh
docker compose start worker
sleep 3
docker compose logs worker --tail=10 | grep ALERT
```

**Expect** `ALERT outbox_lag_seconds=... threshold=300` on the first tick after the worker restarts,
because the oldest unpublished row is now older than five minutes; and, separately in the earlier
`docker compose stop worker` window, no `ALERT sweep_stalled sweep=outbox-relay` — a **stopped**
container does not tick at all, so there is nothing for the scheduler's own stall detector to observe
until the process is running again (research.md §9 explains why these are two different signals).
