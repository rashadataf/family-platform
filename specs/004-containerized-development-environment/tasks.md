---
description: "Task list for spec 004: Containerized Development Environment"
---

# Tasks: Containerized Development Environment

**Input**: Design documents from `/specs/004-containerized-development-environment/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/cli-and-compose.md](contracts/cli-and-compose.md), [quickstart.md](quickstart.md)

**Owning decision**: [ADR-014](../../adr/ADR-014-containerized-development.md)

**Tests**: This feature's verification is behavioural — the quickstart scenarios are the test suite, and FR-016's "start the runtime image and reach `/health/ready`" runs in CI. One unit test is included, for the drift check, because it is ordinary logic that would otherwise be checked only by breaking it on purpose.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are given in every task

## Path Conventions

Repository root is the Docker build context. Application code lives in `apps/api/`, shared packages in `packages/*`, orchestration scripts in `scripts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The Dockerfile's shared stages and the version-drift guard. Nothing here is target-specific, so everything downstream inherits one definition of the platform.

- [X] T001 Create `apps/api/Dockerfile` with `ARG NODE_VERSION=24` (matching `.nvmrc`) and a `base` stage: `FROM node:${NODE_VERSION}-bookworm-slim`, `apt-get install --no-install-recommends openssl ca-certificates` followed by an apt cache clean, `corepack enable`, `WORKDIR /app`. Install openssl explicitly rather than assuming it — Prisma's query engine links against libssl and its absence produces a container that builds cleanly and dies at first query (research.md §1)
- [X] T002 Add the `deps` stage to `apps/api/Dockerfile`, deriving `FROM base`: copy `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `.npmrc` and every workspace `package.json` **before** any source, then `pnpm install --frozen-lockfile`. Manifest-before-source ordering is what keeps a source edit from re-resolving dependencies (data-model.md §1, SC-004)
- [X] T003 [P] Create `scripts/verify-node-version.ts`: read the major version from `.nvmrc`, parse `ARG NODE_VERSION=` from `apps/api/Dockerfile`, exit non-zero naming **both** values when they differ (FR-014). Export the comparison as a named function so T004 can test it without spawning a process, mirroring how `scripts/verify-env-example.ts` exports `findMissingKeys`
- [X] T004 [P] Create `scripts/verify-node-version.spec.ts` covering: matching versions pass; differing majors fail; a missing or unparseable `ARG NODE_VERSION` fails with a clear message rather than silently passing
- [X] T005 Add `"verify:node-version": "tsx scripts/verify-node-version.ts"` to the root `package.json` scripts and append it to the `verify` chain, alongside the existing `verify:env` (contracts/cli-and-compose.md §1)

**Checkpoint**: `pnpm verify:node-version` passes, and `pnpm verify` runs it. The Dockerfile has shared stages but no addressable targets yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `migrator` target and graceful shutdown. Both user stories need these, and neither can be satisfied by Dockerfile changes alone.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 Add the `migrator` stage to `apps/api/Dockerfile`, deriving `FROM deps`: copy `packages/persistence/prisma/` (schema plus `migrations/`), set the default command to `pnpm --filter @fp/persistence exec prisma migrate deploy`. Carries no application source and no HTTP server. **This stage exists because `prisma` (the CLI) is a devDependency while `@prisma/client` is a runtime dependency — FR-008 forbids dev dependencies in the runtime image, so migrations cannot run from it** (research.md §3)
- [X] T007 Amend `apps/api/src/main.ts`: call `app.enableShutdownHooks()` before `app.listen()`, and bind explicitly to `0.0.0.0` so the container's port publishing is unambiguous. Without the shutdown hook Nest registers no `SIGTERM` handler at all (research.md §6, FR-009)
- [X] T008 Create `packages/persistence/src/lifecycle.ts` exporting a Nest provider implementing `OnModuleDestroy` that calls `prisma.$disconnect()`. Keep the `PrismaClient` instance itself unexported, per the existing comment in `packages/persistence/src/client.ts` and Constitution Principle IV
- [X] T009 Export the lifecycle provider from `packages/persistence/src/index.ts` and register it in `apps/api/src/app.module.ts`, so connections close on shutdown rather than being severed by the runtime
- [X] T010 Add `exclude: ["**/*.spec.ts"]` to `packages/persistence/tsconfig.build.json`, matching `apps/api/tsconfig.build.json`. Without it, the first test file added to that package is emitted into `dist/`

**Checkpoint**: Migrations can run from a dedicated image, and the API shuts down cleanly on `SIGTERM`. Verified in T025.

---

## Phase 3: User Story 1 - A new contributor runs the platform with only Docker installed (Priority: P1) 🎯 MVP

**Goal**: `git clone` → `cp .env.example .env` → `docker compose up` yields a hot-reloading API against a migrated database, on a machine with no Node.js and no pnpm.

**Independent Test**: On a machine or VM with Docker installed and the Node.js/pnpm toolchain deliberately absent, follow only `docs/local-development.md` from clone to a successful `/health/ready`, asking no questions.

### Implementation for User Story 1

- [X] T011 [US1] Add the `development` stage to `apps/api/Dockerfile`, deriving `FROM deps`: default command `pnpm --filter @fp/api run dev`. Source arrives by bind mount at runtime rather than by `COPY`, so the image does not need rebuilding on every edit (data-model.md §1)
- [X] T012 [US1] Add the `migrate` service to `docker-compose.yml`: built from the `migrator` target, `depends_on: postgres: {condition: service_healthy}`, `restart: "no"` (one-shot). Give it a `DATABASE_URL` in its own `environment:` block pointing at host `postgres`, not `localhost` (data-model.md §4)
- [X] T013 [US1] Add the `api` service to `docker-compose.yml`: built from the `development` target, `depends_on: migrate: {condition: service_completed_successfully}`, `init: true`, `restart: unless-stopped`, port `${PORT:-3000}:3000`, repository bind-mounted at `/app`, `DATABASE_URL` overridden to the `postgres` host, and a `healthcheck` calling `/health`. The `service_completed_successfully` condition is what makes it structurally impossible to serve traffic against a partially migrated schema (research.md §5, FR-002)
- [X] T014 [US1] Add the six named `node_modules` volumes to `docker-compose.yml` and mount them on the `api` and `migrate` services: `/app/node_modules`, `/app/apps/api/node_modules`, and one for each of `packages/persistence`, `packages/config-eslint`, `packages/config-prettier`, `packages/config-typescript`. **One root volume is not enough**: `apps/api/node_modules/@fp/persistence` is a symlink escaping its own package directory, so a bind mount over `/app` leaves dangling links anywhere without its own volume (research.md §4, data-model.md §3)
- [X] T015 [US1] Add a comment block above the volume list in `docker-compose.yml` stating that a new workspace package requires a new volume entry, and why the single-volume alternative (`node-linker=hoisted`) is rejected — it would delete the pnpm strict-linking layer ARCHITECTURE.md §8.2 names as the strongest boundary enforcement in this repository
- [X] T016 [US1] Rewrite `docs/local-development.md` so the containerized path is first and Node.js/pnpm are listed as **optional** (FR-005): the three-command start, the container-native form of every workspace command (`docker compose run --rm api pnpm <cmd>`, FR-004), and the stop / stop-keeping-data / reset distinction the current document already draws (FR-006)
- [X] T017 [US1] Add an explicit section to `docs/local-development.md` stating what "Docker and nothing else" does **not** cover: `apps/mobile` will require host-native Expo simulators and platform SDKs. State it plainly rather than letting a contributor discover it (ADR-014 Explicit limit, FR-005)

### Verification for User Story 1

- [X] T018 [US1] Run `quickstart.md` scenario 1 on a machine or VM with **no Node.js or pnpm on `PATH`** — running it on the development machine proves layer caching works, not that onboarding works. Confirm postgres → migrate → api ordering, and that both `/health` and `/health/ready` return `{"status":"ok"}` (FR-001, FR-002, SC-002, SC-004)
- [X] T019 [P] [US1] Run `quickstart.md` scenario 2: edit a file under `apps/api/src/` and confirm the API restarts within seconds with no rebuild (FR-003, SC-003). If file-watch events do not cross the bind mount, document the polling fallback in `docs/local-development.md` rather than leaving it for the next person to rediscover (research.md §4)
- [X] T020 [P] [US1] Run `quickstart.md` scenario 3: `docker compose run --rm api pnpm test`, `… pnpm lint`, and a Prisma CLI invocation, confirming each propagates its exit code (FR-004)
- [X] T021 [US1] Run `quickstart.md` scenario 4, all four rows. The third row is the one that matters: with a deliberately broken migration, confirm `migrate` exits non-zero and `docker compose ps` shows **no running `api`** (spec.md Edge Cases, FR-002)

**Checkpoint**: A contributor with only Docker can run the platform. This is the MVP — stop and validate here.

---

## Phase 4: User Story 2 - The image that ships is the image that was developed against (Priority: P1)

**Goal**: The same Dockerfile produces the deployable artifact, and CI proves on every pull request that it starts and reaches a migrated database.

**Independent Test**: Build the `runtime` target in CI, inspect it for forbidden contents, start it against Postgres with migrations applied, and confirm `/health/ready` succeeds.

### Implementation for User Story 2

- [X] T022 [US2] Add the `runtime` stage to `apps/api/Dockerfile`, deriving `FROM base`: run `pnpm deploy --filter @fp/api --prod --legacy /app/deploy` in a build stage and copy the resulting self-contained directory plus compiled `dist/`. **`--legacy` is required**: pnpm 10's modern `deploy` needs `inject-workspace-packages=true` in `.npmrc`, and setting that would change workspace linking repository-wide to solve a packaging problem (research.md §2). Final image: `USER node`, no package manager, no source, no Prisma CLI
- [X] T023 [US2] Add a `HEALTHCHECK` to the `runtime` stage using `node --eval` with Node 24's global `fetch` against `/health` — no `curl` or `wget` package needed. Target liveness, not readiness: a container should not be restarted because its database is briefly unavailable (research.md §7)
- [X] T024 [US2] Add an `image` job to `.github/workflows/ci.yml` using `docker/setup-buildx-action` and `docker/build-push-action` with GitHub Actions cache, building the `runtime` target for `linux/amd64`. **Push nothing** — whether a registry exists is spec 003's open question and is not decided here (FR-015, research.md §8, §9)
- [X] T025 [US2] Add inspection assertions to the `image` job: `pnpm`, `prisma` and `typescript` absent; `whoami` reports `node`, not root; no `src/` directory (FR-008, SC-006, quickstart.md scenario 7)
- [X] T026 [US2] Add a runtime smoke step to the `image` job: start a Postgres service container, apply migrations with the `migrator` target, run the `runtime` image against it, and assert `/health/ready` returns success. **This is the step that catches an incomplete production dependency prune**, which is the failure mode the target split exists to prevent (FR-016, research.md §9)
- [X] T027 [US2] Add `pnpm verify:node-version` as a **step inside the existing `verify-env` job** in `.github/workflows/ci.yml`. **Do not rename that job.** Branch protection on `main` names required checks by job name, so a rename blocks every later merge on a check that no longer reports (contracts/cli-and-compose.md §4, research.md §9)

### Verification for User Story 2

- [X] T028 [P] [US2] Run `quickstart.md` scenario 7 locally: build the `runtime` target and confirm all four inspection assertions. Note this builds arm64 on Apple Silicon while CI builds `linux/amd64`; do not attempt to cross-build locally (research.md §8)
- [X] T029 [P] [US2] Run `quickstart.md` scenario 5: `docker compose stop api` and time it. **Well under 10 seconds means `SIGTERM` was handled; exactly ~10 seconds means it was ignored and Docker fell back to `SIGKILL`** — which would mean T007/T008 or `init: true` is not working (FR-009)
- [X] T030 [P] [US2] Run `quickstart.md` scenario 8: confirm `pnpm verify:node-version` passes, then temporarily set the Dockerfile's `NODE_VERSION` to `22` and confirm it fails naming both values, then revert (FR-014, SC-007)
- [X] T031 [US2] **OPEN — requires the user.** After the `image` job has reported green on a real pull request at least once, add it to `main`'s required status checks alongside `format` and `verify-env`. **This is a live shared repository setting — confirm with the user before running it**, as spec 002's own branch-protection task did

**Checkpoint**: The deployable artifact is built and proven on every pull request. Spec 003 now has a real image to consume.

---

## Phase 5: User Story 3 - The founder keeps the fast host-based loop (Priority: P2)

**Goal**: `pnpm dev` behaves exactly as it does today, against the same database and the same migrations.

**Independent Test**: On a machine with the host toolchain, run `pnpm dev` and confirm it matches what `docs/local-development.md` describes today.

### Implementation for User Story 3

- [X] T032 [US3] Add the host-based path to the rewritten `docs/local-development.md` as a clearly-labelled **optional optimisation**, stating its prerequisites (Node.js 24, pnpm 10) and its rationale (bind-mount filesystem overhead on macOS). Do not present it as the primary route (FR-017, ADR-014 Decision 3). Touches the same file as T016, so not parallel with it
- [X] T033 [US3] Document the port conflict in `docs/local-development.md`: both paths publish the API on the same host port, so running them simultaneously fails with a binding error. This is documented behaviour, not a defect — the alternative would be two divergent database states (contracts/cli-and-compose.md §1)

### Verification for User Story 3

- [X] T034 [US3] Run `quickstart.md` scenario 6: `docker compose down`, then `pnpm install && pnpm dev`, and confirm it behaves exactly as spec 001 defined — database up, migrations applied, API running with watch reload (FR-017, SC-008)
- [X] T035 [US3] Confirm shared state per `quickstart.md` scenario 6: write a row through the host path (`pnpm dev`), stop it, bring up `docker compose up -d`, and confirm the same row is present with no reset required — both paths use the same `postgres` service and the `postgres_data` volume declared in `docker-compose.yml` (FR-018)

**Checkpoint**: Both paths work, share state, and are documented at their correct relative priority.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T036 **OPEN — requires a real first-time contributor; cannot be self-certified.** Run `quickstart.md` scenario 9 — **the only success criterion the author cannot verify** (SC-001). Give the repository to someone who has never onboarded, watch them work from `docs/local-development.md` alone, and **do not answer their questions — write them down**. Every question is a documentation defect; the list is this task's output. Passing means they reach `/health/ready` with zero questions answered
- [X] T037 [P] Add a "Running the platform" section to the root `README.md` naming `docker compose up` as the supported path and linking to `docs/local-development.md`
- [X] T038 [P] Update the repository tree in `ARCHITECTURE.md` §8 to include `apps/api/Dockerfile`, so the normative structure document does not omit the artifact every environment now runs from
- [X] T039 Re-read `apps/api/Dockerfile`, `docker-compose.yml` and `.github/workflows/ci.yml` end to end against `contracts/cli-and-compose.md` and confirm every target name, service name, job name, port and dependency condition matches the contract exactly
- [X] T040 Open a follow-up issue or pull request against spec 003: its `plan.md` runs migrations via `docker compose run --rm api … prisma migrate deploy`, which cannot work against a correctly-built `runtime` image. It must invoke the `migrator` target instead (research.md §3). Recorded here rather than changed, because spec 003 is a merged document

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (needs `deps` stage) — **BLOCKS all user stories**
- **User Story 1 (Phase 3)**: Depends on Phase 2. Delivers the MVP
- **User Story 2 (Phase 4)**: Depends on Phase 2. Independent of US1, though T026 reuses the `migrator` target from T006
- **User Story 3 (Phase 5)**: Depends on Phase 2 only for correctness of the shared services; its documentation tasks touch the same file as T016 and so follow US1
- **Polish (Phase 6)**: Depends on all three stories

### Critical path

```
T001 → T002 → T006 → T011 → T013 → T018   (MVP: contributor runs with only Docker)
                └──→ T022 → T026 → T031    (deployable artifact proven in CI)
```

### Within Each User Story

- Dockerfile stage before the Compose service that uses it
- Compose services before verification
- Documentation before the first-contributor test (T036), which is the only test of the documentation

### Parallel Opportunities

- **Phase 1**: T003 and T004 in parallel with each other, after T001 exists
- **Phase 3**: T019 and T020 in parallel; T021 alone (mutates a migration)
- **Phase 4**: T028, T029 and T030 all in parallel — different concerns, no shared files
- **Phase 6**: T037 and T038 in parallel (different files)
- **US1 and US2 can be built in parallel** once Phase 2 is complete, if two people are available. They share only the Dockerfile, at different stages

### Sequential constraints worth naming

- T016, T017, T032 and T033 all edit `docs/local-development.md` — **none are parallel with each other**
- T012, T013, T014 and T015 all edit `docker-compose.yml` — same
- T024, T025, T026 and T027 all edit `.github/workflows/ci.yml` — same
- T031 must follow a green `image` run and needs user confirmation (live repository setting)

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — Dockerfile shared stages, drift guard
2. Phase 2: Foundational — `migrator` target, graceful shutdown
3. Phase 3: User Story 1 — `development` target, Compose services, documentation
4. **STOP and VALIDATE**: T018 on a clean machine with no Node.js
5. At this point the founder's stated goal is met: a teammate installs Docker and nothing else

### Incremental Delivery

1. Setup + Foundational → shared stages exist, shutdown is correct
2. Add US1 → contributor onboarding works → **this is the deliverable**
3. Add US2 → deployable artifact proven in CI → unblocks spec 003
4. Add US3 → host loop documented at its correct priority
5. Polish → the first-contributor test, which is the only honest measure of SC-001

### Notes

- `[P]` tasks touch different files and have no dependency on incomplete work
- Commit after each task or logical group; `pnpm verify` should stay green throughout
- T031 and T036 both involve something outside the repository — a live setting and a real person. Neither can be faked, and neither should be marked complete on the author's own judgement
