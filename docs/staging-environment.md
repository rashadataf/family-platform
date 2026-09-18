# Staging Environment

## What this is for

**Technical validation, demos, and the founder's own dogfooding — nothing else.**

This is Stage 0 of [ADR-013](../adr/ADR-013-staged-hosting-model.md): a single, shared deployment of this application on the founder's existing VPS, alongside an unrelated portfolio site the founder already runs there. It exists so the platform can be reached at a real URL, by someone other than whoever has the repository checked out, before any AWS infrastructure is justified.

It is not a beta. It is not a place to invite a real family, even one person the founder trusts completely, to try the product with their own data.

## The synthetic-data-only constraint

**This environment is never authorized to hold real user or family data — not a real name, not a real child's record, not a real passport scan, not even one, not even temporarily.**

This is not a technical claim; nothing here inspects what gets typed into a form and rejects it. It is a procedural one, backed by how the environment is built:

- The database starts empty and is populated only by [`packages/persistence/prisma/seed.ts`](../packages/persistence/prisma/seed.ts) — committed, synthetic fixture content, containing no field that resembles a real name, address, or document.
- There is no supported path for loading anything else. Nobody operating this deployment has a documented way to import real data into it, because none was built.
- Resetting the environment (`pnpm staging:deploy:reset`) wipes the database and reseeds it from that same fixture set — the environment's data is disposable by design, on purpose, so nobody is ever tempted to treat it as durable.

[Constitution Principle VI](../.specify/memory/constitution.md), *Children and Family Data Are Sensitive by Default*, is marked non-negotiable and is not relaxed here for cost or convenience. The trigger for moving to real data is defined in ADR-013: real personal data moves to the AWS topology (Stage 1), never to this VPS, regardless of whether revenue exists yet.

## What "reachable" means here

- The staging URL (`http://<vps-host>:<port>` — see [`contracts/cli-and-config.md`](../specs/003-vps-staging-deployment/contracts/cli-and-config.md) in spec 003) is openly reachable, with no authentication gate and no IP allowlist in front of it. That is accepted at this stage specifically because the environment holds only synthetic data — if it held anything else, this would be a problem, not a design choice.
- There is no dedicated logging or monitoring for this environment. Checking on it means SSHing into the VPS and using the Docker CLI directly — `docker compose ps`, `docker compose logs` — the same operating model already used for the portfolio site sharing that VPS.
- Its containers run on their own Docker network, isolated from the portfolio site's: no shared volume, no shared database, no shared secret. Standing it up or tearing it down never touches the portfolio site's containers.

## Operating it

See [`specs/003-vps-staging-deployment/contracts/cli-and-config.md`](../specs/003-vps-staging-deployment/contracts/cli-and-config.md) for the full command reference (`pnpm staging:preview` / `staging:deploy` / `staging:deploy:reset` / `staging:destroy`) and [`specs/003-vps-staging-deployment/quickstart.md`](../specs/003-vps-staging-deployment/quickstart.md) for step-by-step scenarios. In short:

- Merging to `main` deploys automatically via CI. Nobody needs to run a manual command for an ordinary change to reach staging.
- `pnpm staging:deploy` (ad hoc) and `pnpm staging:destroy` exist for the founder to run directly. Teardown is never triggered by CI or by a merge — it is a deliberate, manually-invoked action only.

## The worker, and the sweeps it runs

As of spec 010 the `worker` container is deployed alongside `api` (it was left out until then, because it had no staging runtime image and its module did nothing). It runs every scheduled sweep on its own cadence — retention, invitation expiry, guardian coverage, the calendar horizon, and overdue-task detection — with nothing invoking them by hand.

Checking on it, over SSH, with the same Docker CLI model as everything else here:

```bash
# Is it up, and does Docker consider it healthy?
docker compose -p family-platform-staging ps worker

# What has it been doing? One line per sweep run.
docker compose -p family-platform-staging logs --tail=200 worker | grep worker_sweep_run
```

A `worker_sweep_run` line carries the sweep's name, its outcome, how long it took and a correlation id — never a task title, a member's name or an email:

```text
worker_sweep_run sweep=report-overdue-tasks outcome=succeeded duration_ms=42.3 summary="reported 2, skipped 0, failed 0, lag 0s" [correlationId=...]
```

Three outcomes are worth knowing:

- `succeeded` — the ordinary case.
- `failed` — that pass threw. The other sweeps are unaffected, and this one is retried on its next tick. Repeated failures are what the stall alert below is for.
- `skipped_overlap` — the previous pass of that same sweep was still running when the next tick came due, so the tick was dropped rather than run concurrently. One is unremarkable; a stream of them means a sweep is consistently slower than its cadence.

### Health, and what `ALERT sweep_stalled` means

The scheduler rewrites a heartbeat file after every tick, and the container's `HEALTHCHECK` fails when that file is more than 180 seconds old. So a worker whose process is alive but whose ticks have stopped shows as `unhealthy` in `docker compose ps` rather than sitting there looking fine.

Separately, the scheduler tracks each sweep's last success in memory and emits one line when it goes stale:

```text
ALERT sweep_stalled sweep=report-overdue-tasks last_success_age_seconds=240 threshold_seconds=180
```

It means that sweep has not completed successfully for more than three of its own cadences. It is emitted once per stall, not once per tick, and clears on the next success. That is the platform's alerting convention at this stage — a structured log line, since there is no metrics pipeline yet.

```bash
docker compose -p family-platform-staging logs worker | grep ALERT
```

### Reading the relay's logs, and what `ALERT outbox_lag_seconds` and `ALERT dead_letter_arrived` mean

The outbox relay is one more sweep, running every second: it claims events the API committed to the outbox, sends each to the queues subscribed to its type, and marks it published. One line per tick says what it did:

```bash
docker compose -p family-platform-staging logs --tail=200 worker | grep outbox_relay_run
```

```text
outbox_relay_run claimed=3 published=3 sent=3 failed=0 queue=outbox-relay-verification delivered=3 pending=3 dlq=0 [correlationId=...]
```

`claimed`, `published` and `failed` count outbox rows; `failed` rows stay unpublished and are tried again next tick. `sent` counts messages, and a row whose event type nothing subscribes to is published having sent none. After those come one `queue=…` group per configured queue: how many messages this tick `delivered` to it, how many are `pending` on it now, and how many sit on its dead-letter queue (`dlq`). Like the sweep lines above, it carries identifiers and counts only — never an event's payload. Two more lines are written every tick, alert or not: `outbox_relay_lag_seconds=<n>` and one `outbox_relay_dlq_depth queue=<dlq> depth=<n>` per queue.

Two alerts come from the relay, each emitted once per occurrence and cleared on recovery, like `ALERT sweep_stalled`:

```text
ALERT outbox_lag_seconds=642 threshold=300
ALERT dead_letter_arrived queue=outbox-relay-verification-dlq depth=1
```

- `ALERT outbox_lag_seconds` — after a tick, the oldest event still unpublished is more than 300 seconds old. The tick could not clear it: its sends are failing (look for `outbox relay send failed` lines and check the `elasticmq` container), or more than 100 events are backed up and it is working through them a batch at a time. It fires again only after the lag has dropped back under the threshold.
- `ALERT dead_letter_arrived` — a consumer failed on one message five times and the queue moved it to its dead-letter queue. It needs a person: it will not be retried. It fires when that dead-letter queue goes from empty to non-empty, not for each further message. `outbox_relay_dlq_depth` shows the depth every tick.

Neither is the same signal as `ALERT sweep_stalled sweep=outbox-relay`. That one means the relay stopped *ticking successfully*; a stopped container has no ticks at all, so it raises nothing until the worker is running again. These two mean it is running and something is backing up.

The staging worker image carries the built relay only, not the development tooling, so there is no way to read a queue's messages from it. The logs above are what staging offers; to see what a dead-lettered message actually was, reproduce it locally, where `pnpm --filter worker relay:peek <queue-name>` prints a queue's messages without consuming them.

### Changing a cadence

Each sweep's interval is a variable in `docker-compose.staging.env`, transferred to the VPS as `.env` (`SWEEP_REPORT_OVERDUE_TASKS_INTERVAL_SECONDS` and friends). The worker validates all of them at boot and refuses to start on a zero, a negative or a non-numeric value, naming the variable — so a bad cadence is a failed deploy, not a sweep that silently never runs.

