# Data Model: VPS Staging Deployment

Phase 1 output for [plan.md](plan.md). This feature is infrastructure tooling, not a product
domain — "entities" here are configuration and deployment-state shapes, not persisted business
records. No entity in this document holds personal data (see spec.md's Data Handling and
Compliance section).

## StackConfig

The typed, Zod-parsed shape of the `vps-staging` Pulumi stack's configuration, resolved from
Pulumi Cloud's encrypted stack config at program start (per Constitution Principle II: runtime
configuration MUST be validated before anything else observes it, and the process MUST fail to
start on an invalid value — the same discipline `apps/api/src/config/env.schema.ts` already
applies locally).

| Field | Type | Secret | Notes |
|---|---|---|---|
| `vpsHost` | string (hostname or IP) | No | Where the `command` provider connects |
| `vpsSshUser` | string | No | SSH user on the VPS |
| `vpsSshPort` | number, default 22 | No | |
| `vpsSshPrivateKey` | string (PEM) | Yes | Never written to disk on the VPS; used only as the `command` provider's connection credential |
| `postgresPassword` | string | Yes | Passed to the staging Postgres container's environment only, never templated into a file |
| `apiPublishedPort` | number, default 8080 | No | The fixed port FR-004's stable URL resolves to (`http://<vpsHost>:<apiPublishedPort>`) |
| `stagingNetworkName` | string, default `family-platform-staging` | No | Must not collide with any network name already in use by the portfolio site's containers (FR-005) |
| `resetData` | boolean, default `false` | No | Per-invocation override (FR-012); not persisted as the stack's stored default, passed via `pulumi up --config resetData=true` for a single run |

**Validation rules**: `vpsHost` and `vpsSshUser` MUST be non-empty. `vpsSshPrivateKey` MUST parse
as a well-formed private key before any resource construction begins — a malformed key must fail
before any container ever touches the VPS, not partway through a deploy. `apiPublishedPort` MUST be
in the 1024–65535 range (unprivileged, and out of the way of the portfolio site's likely 80/443).

## StagingDeployment (runtime state, not a stored record)

Represents "what is currently live," reconstructed from Pulumi state and the VPS's own Docker
state rather than persisted anywhere new.

| Field | Derived from |
|---|---|
| `activeImageDigest` | The content hash of the API image currently loaded and running via `docker compose` on the VPS |
| `migrationState` | Prisma's own `_prisma_migrations` table inside the staging Postgres — not duplicated by this feature |
| `containerStatus` | `docker compose ps` output on the VPS, inspected only over SSH (per the logging/observability clarification: no dedicated status surface is built) |

**Lifecycle** (state transitions correspond directly to spec.md's user stories):

```
(absent) --pnpm staging:deploy (first run)--> created, migrated, seeded
created  --pnpm staging:deploy (no changes)--> unchanged, still reachable
created  --pnpm staging:deploy (new image/migration)--> migrated-then-swapped (FR-009 ordering, see research.md §2)
created  --pnpm staging:deploy --reset--> data wiped, reseeded fresh (FR-012)
created  --pnpm staging:destroy--> absent (FR-013); never reachable via CI (FR-020)
```

A deploy that fails during migration (see research.md §2) leaves the state at `created`,
unchanged, rather than transitioning — this is what FR-009 requires structurally, not just as a
documented intention.

## FixtureDataSet

The committed, synthetic seed content applied by the same Prisma seed mechanism this feature
introduces (`prisma db seed`, wired into `packages/persistence/package.json`'s `prisma.seed`
field), per FR-010/FR-011 and the Assumptions section of spec.md.

| Field | Notes |
|---|---|
| Source file | `packages/persistence/prisma/seed.ts`, committed |
| Content | Proves the seeding mechanism end-to-end against the schema that exists today — the `ScaffoldProbe` table spec 001 already defined. Contains no real name, address, document, or any field resembling one. |
| Growth path | A later feature that adds real product domain schema adds its own fixture content to this same seed script; this feature is responsible only for the mechanism existing and running automatically, not for anticipating that content. |

## ComposeServiceSet

The deployed equivalent of `docker-compose.yml`'s local service set (FR-003), expressed as a base
file plus a staging-only override file, combined at deploy time
(`docker compose -f docker-compose.yml -f docker-compose.staging.yml ...`) rather than duplicated.

| Service | Base file (`docker-compose.yml`, spec 001 + spec 004) | Staging override (`docker-compose.staging.yml`, new) |
|---|---|---|
| `postgres` | Image, healthcheck, named volume (unchanged) | `restart: unless-stopped` (already present), joins `stagingNetworkName` |
| `migrate` | One-shot service delivered by spec 004: builds the `migrator` target, gates `api` behind `service_completed_successfully` (consumed here per FR-018, corrects issue #9) | Joins `stagingNetworkName`, `DATABASE_URL` sourced from `StackConfig` — the local override bind-mounts `packages/persistence/prisma`, which a staging deploy MUST NOT do: the deployed image's own baked-in migrations are what proves the transferred artifact, not the deploy host's working tree |
| `api` | Service entry delivered by spec 004 (consumed here per FR-018): build context, depends on `postgres` healthcheck | `restart: unless-stopped` (FR-017), published port from `apiPublishedPort` (FR-004), joins `stagingNetworkName`, environment sourced from `StackConfig` |

Declaring `stagingNetworkName` as a plain (non-`external`) Compose network means Compose creates a
fresh, isolated network on first use — satisfying FR-005 by construction rather than by an
additional isolation step.
