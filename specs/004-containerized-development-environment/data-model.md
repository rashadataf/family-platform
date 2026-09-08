# Data Model: Containerized Development Environment

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

This feature persists no product data. "Entities" here are the structural artefacts spec.md names in its Key Entities section — build targets, services, volumes and configuration — together with the rules that make them valid.

---

## 1. Build Definition (`apps/api/Dockerfile`)

One file, five stages. Three are addressable targets; two are shared internals that exist so the targets cannot drift.

| Stage | Target? | Derives from | Purpose |
|---|---|---|---|
| `base` | no | `node:${NODE_VERSION}-bookworm-slim` | Node runtime, `openssl`, `ca-certificates`. **Corepack is deliberately NOT enabled here** — `corepack enable` writes a pnpm shim into `/usr/local/bin`, and `runtime` derives from this stage, so enabling it here ships a package manager inside the deployable. It is enabled in `deps` instead. |
| `deps` | no | `base` | Full workspace install from the lockfile. Copies manifests and the lockfile *before* source, so a source edit never re-resolves dependencies. |
| `development` | **yes** | `deps` | Whole workspace, dev dependencies, file-watch reload. Source arrives by bind mount at runtime, not by `COPY`. |
| `runtime` | **yes** | `base` | Compiled output plus a pruned production tree from `pnpm deploy --prod --legacy`, with npm/npx/corepack/yarn removed. No package manager, no source, no dev dependencies, no Prisma CLI. Runs as `node`. |
| `migrator` | **yes** | `deps` | Prisma CLI, `schema.prisma`, `migrations/`. No application source, no HTTP server. |

### Validation rules

| Rule | Why | Enforced by |
|---|---|---|
| `NODE_VERSION` major equals `.nvmrc` | FR-014; the duplication is forced by Compose's inability to read `.nvmrc` | `scripts/verify-node-version.ts` in `verify-env` CI job |
| No `ARG`/`ENV` carries a secret | FR-011; build args are recoverable from image metadata | Review; `.dockerignore` excludes `.env*` (PR #5) |
| `runtime` contains no `pnpm`, `prisma`, `typescript`, `src/` | FR-008, SC-006 | `image` CI job asserts by inspection |
| `runtime` final `USER` is not root | FR-008 | `image` CI job asserts |
| `runtime` starts and reaches `/health/ready` | FR-016; proves the prune is complete | `image` CI job |
| Manifests copied before source | SC-004; layer-cache correctness | Structural, reviewed |

---

## 2. Service Set (`docker-compose.yml`)

Three services. Ordering is expressed through Compose's own dependency conditions — no wait scripts, no sleeps (research §5).

| Service | Image / target | Depends on | Lifecycle | Notes |
|---|---|---|---|---|
| `postgres` | `postgres:16-alpine` | — | long-running, `unless-stopped` | Existing service, healthcheck unchanged |
| `migrate` | `migrator` target | `postgres`: `service_healthy` | **one-shot**, exits 0 | `prisma migrate deploy`. Non-zero exit stops the environment coming up. Bind-mounts `prisma/` so `docker compose up` cannot run a stale baked-in copy. |
| `api` | `development` target | `migrate`: `service_completed_successfully` | long-running, `on-failure:3` | `init: true`; source bind-mounted; healthcheck on `/health`. Not `unless-stopped`: that turns a config error into an endless crash loop. |

### State transitions on `docker compose up`

```
postgres starting ──► postgres healthy ──► migrate running ──► migrate exited(0) ──► api starting ──► api healthy
                            │                                        │
                            └── unhealthy: nothing else starts       └── exited(≠0): api never starts (FR-009 edge case)
```

The second failure branch is the one that matters: it is why the API can never serve traffic against a partially migrated schema, and it is enforced by Compose rather than by discipline.

---

## 3. Volume Set

Two categories, with different rules.

**Data volumes** — survive `down`, destroyed only by an explicit reset.

| Volume | Mounted at | Contains |
|---|---|---|
| `postgres_data` | `/var/lib/postgresql/data` | Local database state (existing) |

**Dependency volumes** — container-owned, never shared with the host (FR-010, research §4).

| Volume | Mounted at |
|---|---|
| `root_node_modules` | `/app/node_modules` |
| `api_node_modules` | `/app/apps/api/node_modules` |
| `persistence_node_modules` | `/app/packages/persistence/node_modules` |
| `config_eslint_node_modules` | `/app/packages/config-eslint/node_modules` |
| `config_prettier_node_modules` | `/app/packages/config-prettier/node_modules` |
| `config_typescript_node_modules` | `/app/packages/config-typescript/node_modules` |

### Validation rules

| Rule | Why |
|---|---|
| Every workspace package has a dependency volume | pnpm's symlinks escape their package directory; a bind mount over `/app` shadows any path without one (research §4) |
| **Adding a workspace package requires adding a volume** | Known maintenance cost, accepted in ADR-014's Negative consequences rather than solved by flattening pnpm's linking |
| No host path is bind-mounted into any `node_modules` | The host store holds `libquery_engine-darwin-arm64` — a macOS binary that fails inside Linux as an apparent application error |
| The Prisma client is generated into `packages/persistence/src/generated/prisma` and copied into `dist` at build | The default `node_modules/.prisma` location is **not** carried by `pnpm deploy --prod`: the pruned tree gets an ungenerated `@prisma/client` and the container dies at import. Generating into the package makes the client part of its build output, so it ships wherever the package ships. |

---

## 4. Runtime Configuration

The only channel through which a secret may reach a container (FR-011).

| Source | Consumed by | Notes |
|---|---|---|
| `.env` (git-ignored, from `.env.example`) | Compose interpolation and `env_file` | Unchanged from spec 001 |
| Per-service `environment:` overrides | `api`, `migrate` | **`DATABASE_URL` is overridden here**, because `.env`'s value is `localhost`-based for the host flow and must be `postgres`-based inside the network. One `.env` cannot serve both; the override is the resolution. |
| `ARG NODE_VERSION` | build only | Not a secret, and the only build argument. |

### Validation rules

| Rule | Enforced by |
|---|---|
| Invalid configuration fails at container start, naming the variable | `loadEnv` (existing, tested in `load-env.spec.ts`) |
| Every key the API's schema requires appears in `.env.example` | `pnpm verify:env`, already a CI job |
| No secret in build args or image metadata | FR-011; review |

---

## 5. Onboarding Documentation (`docs/local-development.md`)

Treated as a deliverable with acceptance criteria, not prose.

| Rule | Source |
|---|---|
| The containerized path appears first; host tooling is listed as optional | FR-005 |
| Every command has a container-native form | FR-004 |
| States plainly what "Docker and nothing else" does **not** cover — Expo/mobile | FR-005, ADR-014 Explicit limit |
| Distinguishes stop / stop-and-keep-data / reset, as today's document already does | FR-006 |
| Correctness verified by a first-time contributor, not the author | SC-001 |
