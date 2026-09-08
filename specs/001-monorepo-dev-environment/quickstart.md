# Quickstart: Validating the Local Development Environment

These scenarios validate this feature end-to-end once implemented. Each maps back to an acceptance scenario or success criterion in [spec.md](spec.md). This is a validation guide, not an implementation reference — see [plan.md](plan.md), [research.md](research.md), and [contracts/health-endpoint.md](contracts/health-endpoint.md) for design detail.

## Prerequisites

- Node 24.x, pnpm 10.x (see [plan.md](plan.md) Technical Context for verified versions)
- A running container runtime (Docker) with Docker Compose

## 1. Fresh clone to running environment (User Story 1, SC-001)

```sh
git clone <repo> && cd family-platform
cp .env.example .env
pnpm install
pnpm dev
```

**Expected**: Postgres container reports healthy, the baseline migration applies, and the API starts. In a second terminal:

```sh
curl -i http://localhost:3000/health        # expect 200 {"status":"ok"}
curl -i http://localhost:3000/health/ready  # expect 200 {"status":"ok"}
```

All of the above completes well within 10 minutes on a machine that only has the prerequisites installed (SC-001).

## 2. Missing `.env` (Acceptance Scenario 2, User Story 1)

```sh
rm .env
pnpm dev
```

**Expected**: `pnpm dev` fails immediately with a message instructing the developer to `cp .env.example .env`, not a generic crash.

## 3. Missing prerequisite (Acceptance Scenario 3, User Story 1)

Simulate by making `docker` unreachable (e.g., quit Docker Desktop / stop the daemon), then run `pnpm dev`.

**Expected**: A clear error naming the missing/unreachable container runtime, not a silent hang.

## 4. Live-reload dev loop (Acceptance Scenario 4, User Story 2 / SC-007)

With `pnpm dev` running from step 1, edit the response body in `apps/api/src/health/health.controller.ts` and save.

**Expected**: The API process restarts automatically (visible in the terminal running `pnpm dev`); re-running the `curl` from step 1 reflects the change, with no manual restart.

## 5. Stop and restart without data loss (Acceptance Scenario 1, User Story 2 / SC-002)

```sh
# Ctrl+C to stop the API; Postgres container keeps running
pnpm dev
```

**Expected**: No re-migration errors, no data loss — the environment comes back up cleanly. Repeat this cycle a few times to confirm SC-002 holds across repeated stop/start.

## 6. New migration applied automatically (Acceptance Scenario 3, User Story 2 / SC-004)

Add a new (trivial) migration file under `packages/persistence/prisma/migrations/`, then:

```sh
pnpm dev
```

**Expected**: The new migration is applied before the API becomes available — no separate manual migration command required.

## 7. Explicit reset (Acceptance Scenario 2, User Story 2)

```sh
pnpm db:reset
```

**Expected**: The database is torn down and recreated from nothing, every committed migration reapplies successfully, and `curl http://localhost:3000/health/ready` (after `pnpm dev`) still returns 200.

## 8. Missing/invalid required environment variable (SC-003)

```sh
cp .env .env.bak
# remove or corrupt one required value, e.g. DATABASE_URL, in .env
pnpm dev
```

**Expected**: Failure within seconds, naming the specific variable at fault — not a downstream crash on first request. Restore with `mv .env.bak .env` afterward.

## 9. Port conflict (Edge Case)

```sh
# Occupy the configured Postgres port with an unrelated process, e.g.:
docker run -d -p 5432:5432 postgres:16-alpine
pnpm dev
```

**Expected**: The failure names the conflicting port (`5432` or whatever `POSTGRES_PORT` is set to) rather than failing opaquely. Clean up the unrelated container afterward.

## 10. Shared tooling on a new package (User Story 3, SC-006)

Add a minimal new package under `packages/` that extends `@fp/config-typescript`, `@fp/config-eslint`, and the root Prettier config, with one deliberate type error, one lint violation, and one formatting inconsistency.

```sh
pnpm typecheck
pnpm lint
pnpm format:check
```

**Expected**: All three problems are reported through these workspace-wide commands with no package-local rule configuration beyond referencing the shared configs.
