---
description: "Task list for Monorepo Scaffolding & Local Development Environment"
---

# Tasks: Monorepo Scaffolding & Local Development Environment

**Input**: Design documents from `/specs/001-monorepo-dev-environment/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Not requested in the feature specification. No automated test tasks are included; validation is manual, via the acceptance scenarios and `quickstart.md`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root (`/Users/rashad/Work/family-platform/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Clear stale artifacts and establish the workspace's root-level tooling before any package exists.

- [X] T001 Delete the stray leftover directories from the disregarded stash (no tracked or real source files in any of them): `rm -rf packages/kernel packages/persistence packages/config-eslint tools/boundary-fixtures`
- [X] T002 Create root `package.json`: `"private": true`, `"type": "module"`, `"packageManager": "pnpm@10.33.0"`, `"engines": {"node": ">=24.0.0 <25", "pnpm": ">=10.0.0 <11"}`, empty `"scripts"` object to be filled in by later tasks, `"prettier": "@fp/config-prettier"`, `devDependencies` for `turbo`, `typescript`, `prettier`, `dotenv-cli`, `tsx`
- [X] T003 [P] Create `pnpm-workspace.yaml` declaring `apps/*` and `packages/*` as workspace packages, with `onlyBuiltDependencies: ['@prisma/client', 'prisma', 'esbuild']`
- [X] T004 [P] Create `.npmrc` with `engine-strict=true`
- [X] T005 [P] Create `.nvmrc` containing `24`
- [X] T006 [P] Create root `.gitignore` (`node_modules/`, `dist/`, `.turbo/`, `*.tsbuildinfo`, `.env`, `coverage/`, `.DS_Store`)
- [X] T007 [P] Create root `tsconfig.json` as a TypeScript project-references aggregator only (`"files": []`, `"references"` listing `apps/api` and `packages/persistence`)
- [X] T008 [P] Create `turbo.json` with cacheable tasks only — `build`, `lint`, `typecheck`, `format:check` — and deliberately no `dev` task (per research.md decision 1)
- [X] T009 [P] Create root `README.md` linking to `ARCHITECTURE.md`, `adr/`, and `docs/local-development.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three shared configuration packages every app/package will consume (FR-009). No user story's work can begin until these exist.

**⚠️ CRITICAL**: No task in Phase 3, 4, or 5 that creates a `tsconfig.json`, `eslint.config.js`, or relies on the root Prettier config may start before this phase's checkpoint.

- [X] T010 Create `packages/config-typescript/package.json` (`@fp/config-typescript`, no runtime dependencies)
- [X] T011 [P] Create `packages/config-typescript/base.json`: `strict: true`, `noUncheckedIndexedAccess: true`, Node 24 + ESM-appropriate `target`/`module`/`moduleResolution`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`
- [X] T012 [P] Create `packages/config-typescript/nestjs.json`: extends `./base.json`, adds `experimentalDecorators: true`, `emitDecoratorMetadata: true`
- [X] T013 Create `packages/config-eslint/package.json` (`@fp/config-eslint`; deps: `eslint`, `typescript-eslint`, `eslint-config-prettier`)
- [X] T014 [P] Create `packages/config-eslint/base.js`: flat-config array with core recommended rules and import hygiene
- [X] T015 [P] Create `packages/config-eslint/typescript.js`: extends `base.js`; `typescript-eslint`'s `strictTypeChecked` + `stylisticTypeChecked` via `languageOptions.parserOptions.projectService: true`; explicit `'@typescript-eslint/no-explicit-any': 'error'`
- [X] T016 [P] Create `packages/config-eslint/index.js`: default export combining `base.js` + `typescript.js`
- [X] T017 Create `packages/config-prettier/package.json` (`@fp/config-prettier`; dep: `prettier`)
- [X] T018 [P] Create `packages/config-prettier/index.js`: shared Prettier options object
- [X] T019 Create root `.prettierignore` (`dist`, `.turbo`, `node_modules`, `pnpm-lock.yaml`) and root `eslint.config.js` importing `@fp/config-eslint`'s default export to lint `scripts/**`
- [X] T020 Run `pnpm install` at the repository root and confirm all three shared config packages resolve with no dependency errors (checkpoint — nothing in Phase 3 may start until this passes)

**Checkpoint**: Foundational tooling ready. All user story phases can now begin.

---

## Phase 3: User Story 1 - Fresh clone to running environment (Priority: P1) 🎯 MVP

**Goal**: A developer clones the repo, runs one command, and gets a running API connected to a migrated local database.

**Independent Test**: On a machine with only the declared prerequisites, clone the repo, `cp .env.example .env`, `pnpm install`, `pnpm dev` — confirm `GET /health` and `GET /health/ready` both return 200 and the database contains every committed migration, entirely from committed documentation.

### Implementation for User Story 1

**`packages/persistence` — Prisma confined per ADR-003/research.md decision 5:**

- [X] T021 [P] [US1] Create `packages/persistence/package.json` (`@fp/persistence`; dep: `@prisma/client`; devDeps: `prisma`, `@fp/config-typescript`, `@fp/config-eslint`, `typescript`; scripts: `db:generate="prisma generate"`, `build="prisma generate && tsc -p tsconfig.build.json"`, `lint`, `typecheck`) — MUST NOT list `prisma`/`@prisma/client` as dependencies of any other package
- [X] T022 [P] [US1] Create `packages/persistence/tsconfig.json` (extends `@fp/config-typescript/base.json`)
- [X] T023 [P] [US1] Create `packages/persistence/tsconfig.build.json` (extends `tsconfig.json`, `outDir: dist`)
- [X] T024 [P] [US1] Create `packages/persistence/eslint.config.js` (imports `@fp/config-eslint`)
- [X] T025 [US1] Create `packages/persistence/prisma/schema.prisma`: `datasource db` (`provider = "postgresql"`, `url = env("DATABASE_URL")`), default `generator client`, and one model `ScaffoldProbe` (`id` UUID default, `createdAt` timestamptz default now) mapped to `_scaffold_probe`, with a comment marking it for deletion once real domain schema lands (per research.md decision 3 / data-model.md)
- [X] T026 [US1] Run `pnpm --filter @fp/persistence exec prisma migrate dev --name baseline_scaffold_probe` against a local scratch database to generate `packages/persistence/prisma/migrations/<timestamp>_baseline_scaffold_probe/migration.sql` and `migration_lock.toml` (depends on T025)
- [X] T027 [US1] Create `packages/persistence/src/client.ts`: singleton `PrismaClient` instance, never exported, with a `// TODO(ADR-003-rls):` comment marking where the `SET LOCAL app.family_id` extension attaches once a family-scoped table exists
- [X] T028 [US1] Create `packages/persistence/src/health.ts`: `checkDatabaseHealth(): Promise<void>`, queries `_scaffold_probe` via `client.ts`'s singleton, throws a plain `Error` on failure
- [X] T029 [US1] Create `packages/persistence/src/index.ts`: exports **only** `checkDatabaseHealth` from `health.ts` — no `PrismaClient`, no generated types

**`apps/api` — minimal NestJS host per ADR-002/ARCHITECTURE.md §6:**

- [X] T030 [P] [US1] Create `apps/api/package.json` (`@fp/api`; deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`, `zod`, `@fp/persistence: workspace:*`; devDeps: `@fp/config-typescript`, `@fp/config-eslint`, `typescript`, `tsx`, `@types/node`; scripts: `dev="tsx watch --clear-screen=false src/main.ts"`, `build`, `start`, `lint`, `typecheck`) — MUST NOT list `prisma` or `@prisma/client` in any dependency field
- [X] T031 [P] [US1] Create `apps/api/tsconfig.json` (extends `@fp/config-typescript/nestjs.json`)
- [X] T032 [P] [US1] Create `apps/api/tsconfig.build.json` (extends `tsconfig.json`, excludes `**/*.spec.ts`, `outDir: dist`)
- [X] T033 [P] [US1] Create `apps/api/eslint.config.js` (imports `@fp/config-eslint`'s default export)
- [X] T034 [US1] Create `apps/api/src/config/env.schema.ts`: Zod object schema for `NODE_ENV`, `PORT`, `LOG_LEVEL`, `POSTGRES_PORT`, `POSTGRES_DB`, `DATABASE_URL`; export `type AppEnv = z.infer<typeof envSchema>`
- [X] T035 [US1] Create `apps/api/src/config/load-env.ts`: `loadEnv(raw = process.env): AppEnv` via `envSchema.safeParse`; on failure, map each Zod issue to a `"path: message"` line, `console.error`, `process.exit(1)` (Constitution Principle II / FR-008)
- [X] T036 [US1] Create `apps/api/src/config/config.module.ts`: NestJS module exposing the already-parsed `AppEnv` via a DI token (`APP_CONFIG`)
- [X] T037 [US1] Create `apps/api/src/health/health.controller.ts`: `GET /health` (always 200 `{status:"ok"}`) and `GET /health/ready` (calls `checkDatabaseHealth` from `@fp/persistence`; 200 on resolve, 503 with `{status:"error", message}` on throw) — per `contracts/health-endpoint.md`
- [X] T038 [US1] Create `apps/api/src/health/health.module.ts` wiring `HealthController`
- [X] T039 [US1] Create `apps/api/src/app.module.ts` importing `ConfigModule` and `HealthModule`
- [X] T040 [US1] Create `apps/api/src/main.ts`: import `reflect-metadata` first; call `loadEnv()` as the first executable statement, before `NestFactory.create`; boot the Nest app; listen on `env.PORT`

**Root dev-loop infrastructure:**

- [X] T041 [P] [US1] Create root `.env.example` listing every key from `env.schema.ts` (`NODE_ENV`, `PORT`, `LOG_LEVEL`, `POSTGRES_PORT`, `POSTGRES_DB`, `DATABASE_URL`) with safe placeholder values and a comment that `DATABASE_URL` must stay in sync with the `POSTGRES_*` values above it (depends on T034)
- [X] T042 [P] [US1] Create root `docker-compose.yml`: single `postgres` service (`postgres:16-alpine`), env-driven `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, published port from `POSTGRES_PORT`, a **named volume** (not bind-mounted) for data, `pg_isready` healthcheck (depends on T034)
- [X] T043 [P] [US1] Create `scripts/lib/exec.ts`: typed wrapper over `child_process.spawn` — inherits stdio, forwards `SIGINT`/`SIGTERM`, resolves the child's exit code
- [X] T044 [P] [US1] Create `scripts/lib/postgres.ts`: `waitForPostgresReady()` (bounded `pg_isready` polling) and a stale/exited-container detection + one-cycle recovery helper, shared by `dev.ts` and (later) `db-reset.ts`
- [X] T045 [US1] Create `scripts/verify-env-example.ts`: import `envSchema` from `apps/api`, parse `.env.example` with `dotenv`, assert every schema key appears as a key in the template; runs as a warning when invoked from `dev.ts`, exits non-zero when run standalone
- [X] T046 [US1] Create `scripts/dev.ts` (the `pnpm dev` orchestrator, per research.md decision 1): **Preflight** (`.env` exists, else instruct `cp .env.example .env`; Docker reachable, else name the missing runtime; run `verify-env-example` as a warning) → **Start Postgres** (`docker compose up -d postgres`; detect port-conflict stderr and name the port; one bounded recovery cycle on stale/exited container state; poll readiness via `scripts/lib/postgres.ts`, dumping container logs on timeout) → **Migrate** (`prisma migrate deploy` via `pnpm --filter @fp/persistence exec`; non-zero exit stops here — the API is never started on a failed migration) → **Start API** (spawn `pnpm --filter @fp/api run dev`, stay foregrounded, forward signals)
- [X] T047 [US1] Add a `"dev": "dotenv -e .env -- tsx scripts/dev.ts"` script and a `"postinstall": "pnpm --filter @fp/persistence run db:generate"` script to root `package.json` (the latter ensures a fresh `pnpm install` always produces the Prisma client before any typecheck/build/dev runs)
- [X] T048 [US1] Create `docs/local-development.md`: prerequisites (Node 24, pnpm 10, Docker), fresh-clone-to-running steps, and a troubleshooting section covering each edge case's expected message (missing `.env`, missing Docker, port conflict, stale container, failed migration)

**Checkpoint**: User Story 1 is independently testable — fresh clone, `cp .env.example .env`, `pnpm install`, `pnpm dev` → `GET /health` and `GET /health/ready` both 200, database has the baseline schema.

---

## Phase 4: User Story 2 - Repeatable, resettable local iteration (Priority: P2)

**Goal**: Stopping/restarting the environment never loses data; an explicit action rebuilds the database from nothing.

**Independent Test**: With US1's environment running, stop and restart it — confirm no data loss and no re-migration errors. Separately, run the reset action — confirm the database is rebuilt from nothing with every migration reapplied.

### Implementation for User Story 2

- [X] T049 [US2] Create `scripts/db-reset.ts`: log a destructive-action notice; `docker compose down -v` (removes the named volume from T042); `docker compose up -d postgres`; reuse `waitForPostgresReady()` from `scripts/lib/postgres.ts` (T044); run `prisma migrate deploy`; on failure, exit non-zero with the same migration-failure reporting as `dev.ts`
- [X] T050 [US2] Add `"dev:down": "docker compose down"` (no `-v` — preserves the data volume), `"db:reset": "tsx scripts/db-reset.ts"`, and `"db:migrate:create": "pnpm --filter @fp/persistence exec prisma migrate dev"` script entries to root `package.json`
- [X] T051 [P] [US2] Add a "Stopping, restarting, and resetting" section to `docs/local-development.md` distinguishing `dev:down` (data preserved), `db:reset` (data destroyed and rebuilt), and `db:migrate:create` (authoring a new migration — a distinct, interactive workflow from `dev.ts`'s internal apply-only `migrate deploy`), per research.md decision 4

**Checkpoint**: User Story 2 is independently testable — stop/restart preserves data across repeated cycles; `pnpm db:reset` rebuilds from nothing; a newly added migration file is picked up automatically on the next `pnpm dev`.

---

## Phase 5: User Story 3 - Consistent tooling for every workspace member (Priority: P3)

**Goal**: A new package inherits working type-checking, linting, and formatting from the shared config packages alone.

**Independent Test**: Scaffold a temporary package extending the three shared configs with one deliberate type error, one lint violation, and one formatting inconsistency — confirm each is reported through the standard workspace-wide commands with no package-local rule configuration.

### Implementation for User Story 3

- [X] T052 [US3] Add `"typecheck": "turbo typecheck"`, `"lint": "turbo lint"`, `"format": "prettier --write ."`, `"format:check": "prettier --check ."`, `"build": "turbo build"`, and `"verify": "pnpm typecheck && pnpm lint && pnpm format:check && pnpm build"` script entries to root `package.json`
- [X] T053 [US3] Extend `turbo.json`'s `typecheck`, `lint`, and `build` task definitions with `dependsOn: ["^build"]` plus a dependency on `@fp/persistence`'s `db:generate` output, so generated Prisma types exist before any package depending on `@fp/persistence` is typechecked, linted, or built
- [X] T054 [P] [US3] Add an "Adding a new package" section to `docs/local-development.md` documenting that a new package extends `@fp/config-typescript`, `@fp/config-eslint`, and the root Prettier config with no package-local rule duplication
- [X] T055 [US3] Manually validate: scaffold a temporary throwaway package extending the three shared configs with one deliberate type error, one lint violation, and one formatting inconsistency; confirm `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` each report their respective problem; then delete the throwaway package

**Checkpoint**: User Story 3 is independently testable — a new package inherits working type-checking, linting, and formatting from the shared config packages with zero package-local rule configuration.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency pass across all three stories.

- [X] T056 [P] Create root `.dockerignore` (`node_modules`, `dist`, `.git`, `.turbo`)
- [X] T057 [P] Review `docs/local-development.md` against every scenario in `specs/001-monorepo-dev-environment/quickstart.md` and correct any drift
- [X] T058 Manually walk through all 10 scenarios in `specs/001-monorepo-dev-environment/quickstart.md` end-to-end and confirm every expected outcome holds
- [X] T059 Confirm no `any` appears anywhere in `apps/api` or `packages/persistence` source (`pnpm lint` clean) and TypeScript strict mode reports zero errors (`pnpm typecheck` clean), per Constitution Principle I

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (needs the root `package.json`/workspace files to exist). Blocks all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational. No dependency on US2 or US3.
- **User Story 2 (Phase 4)**: Depends on User Story 1 (reuses `scripts/lib/postgres.ts` and the Postgres/migration setup US1 builds).
- **User Story 3 (Phase 5)**: Depends on Foundational only, not on US1/US2's application code — sequenced last because its validation step is more meaningful once real packages exist to compare against, not because of a hard technical dependency.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### User Story Dependencies

- User Story 1 (P1): No dependency on other stories. This is the MVP.
- User Story 2 (P2): Builds on User Story 1's Postgres/orchestration infrastructure.
- User Story 3 (P3): Builds on the Foundational config packages only.

### Within Each User Story

- `packages/persistence` tasks (T021-T029) before `apps/api` tasks that depend on `@fp/persistence` (T030 lists it as a dependency; T037 calls `checkDatabaseHealth`).
- `apps/api/src/config/*` tasks (T034-T036) before `main.ts` (T040), which consumes them.
- `scripts/lib/*` (T043-T044) before `scripts/dev.ts` (T046) and `scripts/db-reset.ts` (T049), which both depend on them.

### Parallel Opportunities

- All of Phase 1's file-creation tasks (T003-T009) can run in parallel once T002 exists.
- All of Phase 2's sibling config files within one package (e.g., T011-T012, T014-T016, T018) can run in parallel once that package's `package.json` anchor task exists.
- Within Phase 3, the four package/tooling files for `packages/persistence` (T021-T024) can run in parallel with each other, and separately the four for `apps/api` (T030-T033) can run in parallel with each other; `.env.example` and `docker-compose.yml` (T041-T042) can run in parallel once T034 is done; `scripts/lib/exec.ts` and `scripts/lib/postgres.ts` (T043-T044) can run in parallel with each other and with T041-T042.

---

## Parallel Example: User Story 1

```bash
# After T034 (env.schema.ts) is complete, these two can run together:
Task: "Create root .env.example listing every key from env.schema.ts (T041)"
Task: "Create root docker-compose.yml with a single postgres:16-alpine service (T042)"

# Independently, these two can run together at any point after Phase 2:
Task: "Create packages/persistence/package.json (T021)"
Task: "Create apps/api/package.json (T030)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

Complete Phase 1 (Setup) → Phase 2 (Foundational) → Phase 3 (User Story 1) and stop. This alone delivers the feature's stated deliverable: clone, run one command, get a working API + database + migrations. Validate against `quickstart.md` scenarios 1-3.

### Incremental Delivery

1. Setup + Foundational + User Story 1 → validate independently (quickstart scenarios 1-3) → this is a demoable, usable increment.
2. Add User Story 2 → validate independently (quickstart scenarios 4-9) → safer daily iteration.
3. Add User Story 3 → validate independently (quickstart scenario 10) → confidence for every subsequent feature that adds a package.
4. Polish → final cross-cutting pass.

### Parallel Team Strategy

With Foundational complete, User Story 1 and User Story 3 could in principle be split across two people (US3 only needs the config packages, not US1's application code), though User Story 3's validation step is more useful once US1's real packages exist to compare its throwaway test package against. User Story 2 must wait for User Story 1 regardless, since it directly extends `dev.ts`'s infrastructure.

## Notes

- `[P]` tasks touch different files with no code dependency on an incomplete task.
- `[Story]` labels map every user-story-phase task back to spec.md for traceability.
- Each user story's phase is independently completable and testable per its own Independent Test above.
- Commit after each task or logical group of parallel tasks.
- Stop at any checkpoint to validate before proceeding — especially after Phase 3 (MVP).
- No two tasks in the same phase are marked `[P]` if they write to the same file (e.g., the three separate `package.json` edits across T047/T050/T052 are each in different phases, never marked parallel against each other).
