# Implementation Plan: Monorepo Scaffolding & Local Development Environment

**Branch**: `001-monorepo-scaffolding` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-monorepo-dev-environment/spec.md`

## Summary

A new developer must be able to clone this repository, run one command, and get a working local environment: the API application running, a local PostgreSQL database up to date with every committed migration, and the API auto-restarting as its source changes. The technical approach: a pnpm workspace with Turborepo for cacheable build/lint/typecheck tasks; three shared config packages (`@fp/config-typescript`, `@fp/config-eslint`, `@fp/config-prettier`) consumed by every app/package instead of duplicated; PostgreSQL 16 in Docker Compose behind a small TypeScript orchestrator script (not a pure Turborepo pipeline, since container-readiness polling and phase-specific failure messages aren't expressible as cacheable build tasks); Prisma confined to `packages/persistence` per ADR-003, with one baseline migration that proves the migration mechanism works without encoding any product domain schema; and a minimal NestJS `apps/api` (framework fixed by ADR-002/ARCHITECTURE.md) exposing only liveness/readiness endpoints, with environment configuration validated eagerly by Zod before the Nest application even boots.

## Technical Context

**Language/Version**: TypeScript 5.x, ESM (`"type": "module"` throughout), running on Node 24.x (verified locally: v24.14.1; pinned via `.nvmrc` + `engines.node`)

**Primary Dependencies**: pnpm 10.x workspaces (verified locally: 10.33.0, pinned via `packageManager`) + Turborepo for build/lint/typecheck/format orchestration (not the dev loop); NestJS for `apps/api` (fixed by ARCHITECTURE.md §6 / ADR-002, not reconsidered here); Prisma for `packages/persistence` (per ADR-003); Zod for environment validation; `tsx` for dev-mode TypeScript execution and file-watch restart

**Storage**: PostgreSQL 16-alpine via Docker Compose (verified locally: Docker 29.7.2 / Compose v5.5.0), single `postgres` service, named volume (not bind-mounted) so data survives ordinary stop/restart cycles

**Testing**: None added by this feature. The spec's acceptance scenarios are validated manually via `quickstart.md`; automated test scaffolding (unit/integration harnesses) is a later feature's concern once there is domain logic worth testing

**Target Platform**: Local developer machine (macOS/Linux), Docker-capable

**Project Type**: Monorepo scaffold — backend web app plus shared libraries; no frontend in this feature

**Performance Goals**: SC-001 — fresh clone to running environment in under 10 minutes; SC-003 — invalid configuration fails within seconds

**Constraints**: No CI, no cloud infrastructure, no authentication, no product domain logic, no `apps/worker` or `apps/mobile`, no module-boundary-enforcement tooling (dependency-cruiser / eslint-plugin-boundaries) — all explicitly deferred per the spec's Assumptions

**Scale/Scope**: Single developer, single local Postgres instance, one HTTP application

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Compliance approach |
|---|---|
| I. Type Safety Is a Contract | `@fp/config-typescript` sets `strict: true` and `noUncheckedIndexedAccess`, extended by every package with no per-package relaxation. `@fp/config-eslint` enforces `@typescript-eslint/no-explicit-any: error`. |
| II. Validate at Every Boundary | Environment variables are parsed by a Zod schema (`apps/api/src/config/env.schema.ts`) as the first statement in `main.ts`, before `NestFactory.create` runs. Invalid configuration produces a named, per-field error and `process.exit(1)` — the process fails to boot rather than failing later on first use. |
| III. Architecture Boundaries Are Enforced, Not Suggested | Lint/dependency-cruiser boundary tooling is explicitly out of scope for this feature, but the one boundary that matters here is not left to convention: `apps/api/package.json` never lists `@prisma/client`, so pnpm's strict, non-hoisted linking (ADR-001) makes an accidental import a resolution failure, not a lint warning. |
| IV. Persistence Goes Through the Data-Access Layer | `PrismaClient` is instantiated once, in `packages/persistence/src/client.ts`, and is never exported. The package's public surface (`src/index.ts`) exports exactly one function, `checkDatabaseHealth()`. Schema changes ship as plain, reviewed SQL migration files under `prisma/migrations/`. |
| XI. Deletion and Export Are Designed, Not Retrofitted | Already answered as not applicable in `spec.md`'s "Data Handling and Compliance" section: this feature introduces no product or personal data. No further action required here. |
| Cost is a design constraint | Nothing is provisioned before its trigger: the ADR-003 row-level-security client extension is deliberately not built (no family-scoped table exists yet to scope), marked instead with a `TODO(ADR-003-rls)` comment; `apps/worker` is not scaffolded, per the spec's clarification. |

No unjustified violations. Two intentional complexity trade-offs (a full NestJS app for two endpoints; a custom dev script instead of a pure Turborepo pipeline) are recorded in Complexity Tracking below, both traceable to fixed upstream decisions or to spec requirements that a pure build-graph tool cannot express.

*Post-Phase-1 re-check: unchanged. Phase 1 design (data model, contracts, quickstart) introduced nothing that touches a constitution principle differently than assessed above — the one new artifact, the `ScaffoldProbe` table, is explicitly non-domain scaffolding covered by Principle IV's migration-review requirement and nothing else.*

## Project Structure

### Documentation (this feature)

```text
specs/001-monorepo-dev-environment/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── health-endpoint.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
family-platform/
├── package.json, pnpm-workspace.yaml, turbo.json, .npmrc
├── tsconfig.json                  # project-references aggregator only, not load-bearing for builds
├── eslint.config.js               # root-level lint (lints scripts/**)
├── .env.example / .gitignore      # single root-level env template; real .env git-ignored
├── docker-compose.yml             # single `postgres` service, named volume, healthcheck
├── scripts/
│   ├── dev.ts                     # the `pnpm dev` orchestrator: preflight, start Postgres, migrate, start API in watch mode
│   ├── db-reset.ts                # the `pnpm db:reset` orchestrator: down -v, up, migrate
│   ├── verify-env-example.ts      # schema-vs-.env.example drift check
│   └── lib/
│       ├── postgres.ts            # waitForPostgresReady(), stale-container recovery
│       └── exec.ts                # typed child_process wrapper, signal forwarding
├── docs/
│   └── local-development.md       # FR-012 setup + troubleshooting documentation
├── apps/
│   └── api/
│       ├── package.json, tsconfig.json, tsconfig.build.json, eslint.config.js
│       └── src/
│           ├── main.ts                        # loads env FIRST, then boots Nest
│           ├── app.module.ts
│           ├── config/
│           │   ├── env.schema.ts              # Zod schema, single source of truth for required vars
│           │   ├── load-env.ts                 # eager parse + fail-fast reporting
│           │   └── config.module.ts            # exposes parsed config via DI
│           └── health/
│               ├── health.module.ts
│               └── health.controller.ts        # GET /health, GET /health/ready
└── packages/
    ├── persistence/
    │   ├── package.json, tsconfig.json, tsconfig.build.json
    │   ├── prisma/
    │   │   ├── schema.prisma                   # one model: ScaffoldProbe -> _scaffold_probe
    │   │   └── migrations/<timestamp>_baseline_scaffold_probe/migration.sql
    │   └── src/
    │       ├── client.ts                       # singleton PrismaClient, never exported
    │       ├── health.ts                       # checkDatabaseHealth()
    │       └── index.ts                        # exports ONLY checkDatabaseHealth()
    ├── config-typescript/
    │   ├── base.json                           # strict, noUncheckedIndexedAccess
    │   └── nestjs.json                         # extends base.json, adds decorator flags
    ├── config-eslint/
    │   ├── base.js
    │   ├── typescript.js                       # no-explicit-any: error
    │   └── index.js
    └── config-prettier/
        └── index.js                            # referenced once at the workspace root, not per-package
```

**Structure Decision**: Flat and minimal, scoped strictly to this feature's functional requirements — one application (`apps/api`), one data-access package (`packages/persistence`), and three shared config packages, matching ARCHITECTURE.md §8's own enumeration of config packages. Deliberately excluded: `packages/core`, `packages/kernel`, `packages/contracts`, `apps/worker`, `apps/mobile`, and any boundary-enforcement tooling — none are needed to satisfy FR-001 through FR-012, and building them now would be scaffolding without a current requirement to justify it. Prettier is wired once at the workspace root (`"prettier": "@fp/config-prettier"` plus a root `prettier --check .` script) rather than duplicated per package, since formatting is a whole-repository concern, unlike TypeScript compilation and linting which are legitimately scoped per package.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A full NestJS application for two GET endpoints (`/health`, `/health/ready`) | `apps/api`'s framework is fixed by ADR-002 and ARCHITECTURE.md §6 ("Where NestJS lives. Only in `apps/api` and `apps/worker`") — not open for reconsideration in this feature | A bare Express/Fastify handler would be smaller today, but would require a framework migration later once real controllers, guards, and DI-based business logic land — far more expensive than the ~30 lines of Nest boilerplate this costs now |
| A custom `scripts/dev.ts` orchestrator instead of a pure Turborepo task graph for `pnpm dev` | The dev command must poll an external container until healthy, recover from a stale container state, and hard-stop before starting the API if migration fails — none of which are cacheable build-graph operations, and the spec's edge cases require curated, phase-specific error messages (name the conflicting port; distinguish "never came up" from "migration failed") | A `turbo.json`-only pipeline can express task *dependency order* but has no primitive for readiness polling or bounded recovery, and would surface generic per-task failures instead of the specific, actionable messages the spec's edge cases require |
