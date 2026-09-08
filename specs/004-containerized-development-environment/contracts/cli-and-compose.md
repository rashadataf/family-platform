# Contract: Commands, Compose Surface and CI

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md)

This feature exposes no product API. Its interface is the set of commands a contributor runs, the Compose services those commands operate on, and the CI jobs that gate them. This document is that contract: anything here is depended upon by a human or by CI, and changing it is a breaking change to onboarding.

---

## 1. Contributor commands

### Primary path — requires Docker only

| Command | Effect | Exit contract |
|---|---|---|
| `cp .env.example .env` | Creates local configuration | — |
| `docker compose up` | Postgres → migrations → API. Foreground, streams logs. | Non-zero if migrations fail; `api` never starts in that case |
| `docker compose up -d` | Same, detached | As above |
| `docker compose down` | Stops all services. **Data volume untouched.** | 0 |
| `docker compose down -v` | Stops all services **and destroys the database volume**. Full reset. | 0 |
| `docker compose logs -f api` | Follow API logs | — |
| `docker compose run --rm api pnpm <cmd>` | Any workspace command, no host pnpm required (FR-004) | Propagates the command's exit code |

The three-way distinction between *stop the API*, *stop everything but keep data*, and *reset to clean* is preserved from the existing documentation and must remain explicit (FR-006).

### Optional path — requires Node.js 24 + pnpm 10 on the host

| Command | Status |
|---|---|
| `pnpm dev` | **Unchanged.** Still starts Postgres, migrates, runs the API with watch (FR-017) |
| `pnpm dev:down`, `pnpm db:reset`, `pnpm db:migrate:create` | Unchanged |
| `pnpm verify` | Gains `verify:node-version` |

**Compatibility guarantee (FR-018).** Both paths use the same `postgres` service, the same volume and the same committed migrations. Switching between them requires no reset.

**Known conflict.** Both paths publish the API on the same host port. Running them simultaneously fails with a port-binding error, which is the documented behaviour rather than a defect — the alternative would be two divergent database states.

### New command

| Command | Effect |
|---|---|
| `pnpm verify:node-version` | Exits non-zero if the Dockerfile's Node major differs from `.nvmrc`, naming both values (FR-014) |

---

## 2. Build targets

Addressable via `docker build --target <name> -f apps/api/Dockerfile .` from the repository root.

| Target | Guarantees |
|---|---|
| `development` | Full workspace; watch reload; **not** for deployment |
| `runtime` | No package manager, no dev dependencies, no source, no Prisma CLI; non-root; graceful `SIGTERM`; `HEALTHCHECK` on `/health` |
| `migrator` | Prisma CLI + schema + migrations only; runs to completion and exits |

**Build context is the repository root**, not `apps/api` — the workspace lockfile and sibling packages are required. The context is filtered by the root `.dockerignore`, which excludes `.env` and `.env.*` (FR-012).

---

## 3. Compose services

| Service | Target | Ports | Restart | Depends on |
|---|---|---|---|---|
| `postgres` | — | `${POSTGRES_PORT:-5432}:5432` | `unless-stopped` | — |
| `migrate` | `migrator` | none | `no` (one-shot) | `postgres`: `service_healthy` |
| `api` | `development` | `${PORT:-3000}:3000` | `unless-stopped` | `migrate`: `service_completed_successfully` |

`api` sets `init: true` so Docker supplies `tini` as PID 1 — without it a `SIGTERM` reaching an unhandled PID 1 is ignored, and `docker stop` waits its full timeout before `SIGKILL` (research §6).

### Configuration overrides

`DATABASE_URL` is set in each service's `environment:` block, overriding `.env`. The `.env` value is `localhost`-based and correct for the host flow; inside the Compose network the host is `postgres`. **One `.env` cannot serve both** — this override is the resolution, and must not be "fixed" by editing `.env.example`.

---

## 4. CI contract

| Job | Status | Runs |
|---|---|---|
| `typecheck` | existing | + `//#typecheck:workspace-root` |
| `lint` | existing | + `//#lint:workspace-root` |
| `format` | existing | `prettier --check .` |
| `test` | existing | `turbo run test` |
| `verify-env` | existing, **gains a step** | `pnpm verify:env`, then `pnpm verify:node-version` |
| `build` | existing | `turbo run build` |
| `image` | **new** | Build `runtime` for `linux/amd64`; assert no pnpm/prisma/source and non-root; start it with `migrator` against a Postgres service; assert `/health/ready` succeeds |

**Naming is part of this contract.** Branch protection on `main` lists required checks by job name. Renaming a job blocks every subsequent merge on a check that no longer reports. Therefore:

- `verify-env` **must not be renamed**, even though it now does more than its name suggests. The drift check is a step inside it, not a new job.
- `image` must be added to the required-checks list only **after** it has reported green at least once.

No image is pushed. Whether a registry is introduced is spec 003's open question and is not decided here.

---

## 5. What this contract does not cover

- **`apps/mobile`.** Expo requires host-native simulators and platform SDKs. "Docker and nothing else" is true for backend work and false for mobile, and the documentation says so rather than letting a contributor discover it (ADR-014, Explicit limit).
- **Deployment.** No push, no registry, no remote target. Spec 003 consumes the `runtime` and `migrator` targets defined here.
- **Cross-architecture local builds.** The `runtime` target is built for `linux/amd64` in CI; a contributor on Apple Silicon builds `development` natively and is not expected to cross-build (research §8).
