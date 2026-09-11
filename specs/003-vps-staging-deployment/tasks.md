---
description: "Task list for spec 003: VPS Staging Deployment"
---

# Tasks: VPS Staging Deployment

**Input**: Design documents from `/specs/003-vps-staging-deployment/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/cli-and-config.md](contracts/cli-and-config.md), [quickstart.md](quickstart.md)

**Tests**: One real assertion (T026), per research.md §5 — Pulumi's mock testing harness, not a speculative suite. Everything else is verified by running it, which is where this feature differs sharply from specs 004 and 005: those were fully verifiable locally. This one deploys to a VPS I have no access to, so a large share of verification below is marked **Requires the user** rather than something I can run myself.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 reach a working deployment · US2 redeploy and iterate · US3 portfolio-site isolation
- Exact paths in every task

---

## Phase 1: Setup

- [X] T001 Create the `infrastructure/` workspace package skeleton: `package.json` (name `@fp/infrastructure`; dependencies `@pulumi/pulumi`, `@pulumi/docker-build`, `@pulumi/command`, `zod`; devDependencies `@fp/config-eslint`, `@fp/config-typescript`, `typescript`, `eslint`, `vitest`), `tsconfig.json` (extends `@fp/config-typescript/base.json`), `eslint.config.js` (extends `@fp/config-eslint`) — the same three-file shape every existing workspace package already has
- [X] T002 Add `infrastructure` to `pnpm-workspace.yaml`'s package list — a literal path, not a glob, since `apps/*` and `packages/*` do not match it. ARCHITECTURE.md §8 already reserves this location; the workspace glob does not yet include it
- [X] T003 `pnpm install`; confirm `infrastructure` resolves as a workspace member and its declared dependencies install cleanly

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prove the boundary gate catches a new package with no rule (again — this is the second time this exact proof matters, per spec 005 T025), then give the program a config surface that fails before touching anything if it's wrong.

- [X] T004 Run `pnpm boundaries`; confirm it **FAILS** — `infrastructure` has no `WORKSPACE_GRAPH` entry in `.dependency-cruiser.cjs`, so its own `eslint.config.js` importing `@fp/config-eslint` is `not-in-allowed`. If this passes, the fail-closed configuration T005 of spec 005 built has regressed
- [X] T005 Add `'infrastructure': []` to `WORKSPACE_GRAPH` in `.dependency-cruiser.cjs` — its only workspace dependency is `packages/config-*`, already implicit in the existing expansion (matches plan.md's Constitution Check: "does not import `packages/core`, `packages/persistence`'s client, or any application package"). Confirm `pnpm boundaries` passes again
- [X] T006 Create `infrastructure/src/config.ts`: `StackConfig`, a Zod schema per [data-model.md](data-model.md) — `vpsHost`, `vpsSshUser`, `vpsSshPort` (default 22), `vpsSshPrivateKey` (secret, MUST parse as a well-formed PEM key), `postgresPassword` (secret), `apiPublishedPort` (default 8080, 1024–65535), `stagingNetworkName` (default `family-platform-staging`), `resetData` (default `false`) — parsed once at program start and MUST fail before any Pulumi resource is constructed on an invalid value (Constitution Principle II), mirroring `apps/api/src/config/env.schema.ts` exactly
- [X] T007 [P] Write `infrastructure/src/config.spec.ts`: unit tests for every `StackConfig` validation rule in T006 — empty `vpsHost`/`vpsSshUser` fails, a malformed `vpsSshPrivateKey` fails before any resource construction, `apiPublishedPort` outside 1024–65535 fails. Pure schema tests — no VPS, no Pulumi runtime, unit tier

**Checkpoint**: A misconfigured stack fails immediately and by name, before anything reaches the VPS.

---

## Phase 3: User Story 1 - Deploy the platform to a reachable staging environment (Priority: P1) 🎯 MVP

**Goal**: One documented command builds the API image, transfers it to the VPS with no registry, brings up the deployed Compose service set on an isolated network, migrates and seeds the database, and the staging URL responds.

**Independent Test**: From a machine with only VPS access and Pulumi credentials and no prior deployment history, run the deploy command and confirm the staging URL responds, serving spec 001's application, with every committed migration applied and no data beyond fixtures.

### Implementation for User Story 1

- [X] T008 [US1] Create `docker-compose.staging.yml` per [data-model.md](data-model.md)'s `ComposeServiceSet`: `postgres` override (`restart: unless-stopped`, joins `stagingNetworkName`); `migrate` override (joins `stagingNetworkName`, `DATABASE_URL` from `StackConfig` — **no bind mount** of `packages/persistence/prisma`, unlike the local override; the deployed image's own baked-in migrations are what proves the transferred artifact, not the deploy host's working tree); `api` override (`restart: unless-stopped` FR-017, published port from `apiPublishedPort` FR-004, joins `stagingNetworkName`, environment from `StackConfig`)
- [X] T009 [P] [US1] Create `infrastructure/src/image.ts`: a `docker-build.Image` resource building `apps/api/Dockerfile`'s `runtime` target locally, on whichever machine runs `pulumi up` (research.md §1) — the same artifact CI's `image` job already builds and health-checks on every pull request (FR-018); this feature defines no Dockerfile of its own
- [X] T010 [P] [US1] Create `infrastructure/src/transfer.ts`: a `command.remote.CopyToRemote` resource transferring the built image tarball plus `docker-compose.yml` and `docker-compose.staging.yml` to the VPS, connecting with `StackConfig`'s `vpsHost`/`vpsSshUser`/`vpsSshPort`/`vpsSshPrivateKey`
- [X] T011 [US1] Create `infrastructure/src/deploy.ts`: a `command.remote.Command` sequence implementing research.md §2's corrected ordering — `docker load`, then `docker compose -f docker-compose.yml -f docker-compose.staging.yml run --rm migrate`, then **only on success** `docker compose ... up -d`. A failed migration MUST leave the previous deployment running and MUST NOT reach the `up` step (FR-009) — this is the ordering the whole feature exists to get right
- [X] T012 [US1] Create `infrastructure/index.ts`: the program entrypoint, wiring config (T006) → image (T009) → transfer (T010) → deploy (T011); export the staging URL (`http://<vpsHost>:<apiPublishedPort>`) as a stack output
- [X] T013 [US1] Add `pnpm staging:preview` / `staging:deploy` / `staging:deploy:reset` / `staging:destroy` scripts to the root `package.json`, exactly matching [contracts/cli-and-config.md](contracts/cli-and-config.md)'s command table (`staging:destroy` runs `pulumi state unprotect --all` before `pulumi destroy`)
- [X] T014 [US1] Create `packages/persistence/prisma/seed.ts` (FR-010/FR-011): seeds the fixture data set against the `ScaffoldProbe` table spec 001 already defined, proving the seeding mechanism end to end against today's schema. Contains no real name, address, document, or any field resembling one — and by construction offers **no supported path** for anything else (SC-005). Wire `prisma.seed` into `packages/persistence/package.json` so `prisma db seed` runs it
- [X] T015 [US1] Create `docs/staging-environment.md` (FR-015): states explicitly what the staging environment is for (technical validation, demos, the founder's own dogfooding) and its synthetic-data-only constraint, including that it is never authorized to hold real user or family data — written so SC-006 holds without the reader needing to ask anyone

### Verification for User Story 1 — mine, no VPS needed

- [X] T016 [US1] `pnpm typecheck && pnpm lint` clean across `infrastructure/` and the amended `packages/persistence`
- [X] T017 [US1] Run quickstart Scenario 5 cold: read `docs/staging-environment.md` with no other context and confirm SC-006 holds — the purpose and the data constraint are both restatable unaided

### Verification for User Story 1 — **Requires the user** (real VPS + Pulumi Cloud)

- [X] T018 [US1] **Requires the user.** `pulumi login`; create the `vps-staging` stack; `pulumi config set` for `vpsHost`/`vpsSshUser`/`apiPublishedPort` (and `stagingNetworkName` only if overriding the default); `pulumi config set --secret` for `vpsSshPrivateKey` and `postgresPassword`
- [X] T019 [US1] **Requires the user.** Run quickstart Scenario 1 for real: from a clean state, `pnpm staging:deploy`; confirm the staging URL responds within 30 minutes (SC-001) and, via SSH, that the running containers share no network, volume, or name with the portfolio site's containers (User Story 3 acceptance scenario 2 — checked here since access is already at hand)

**Checkpoint**: A working, reachable staging deployment exists. This is the MVP — stop and validate here before automating iteration.

---

## Phase 4: User Story 2 - Redeploy without losing the ability to iterate (Priority: P2)

**Goal**: The same single command redeploys repeatedly — preserving data by default, applying new migrations automatically, and supporting an explicit reset — and merging to `main` triggers it automatically.

**Independent Test**: With staging already deployed, change the source and add a migration, redeploy, and confirm it completes successfully with the new migration applied and prior data intact.

### Implementation for User Story 2

- [X] T020 [US2] Amend `infrastructure/src/deploy.ts`: add the `resetData`-conditional path (FR-012) — when `true`, wipe and reseed the database fresh from fixtures as part of the same deploy run; when `false` (the default), previously seeded or founder-generated data is left untouched. Same file as T011; sequential, not parallel
- [X] T021 [US2] Add `infra-preview` and `infra-deploy` jobs to `.github/workflows/ci.yml`, per the corrected CI trigger contract in [contracts/cli-and-config.md](contracts/cli-and-config.md): `infra-preview` on `pull_request` → `main` (`pnpm staging:preview`, mutates nothing); `infra-deploy` on `push` → `main`, `needs:` the full ten-job blocking set — `typecheck`, `lint`, `format`, `test`, `test-integration`, `verify-env`, `boundaries`, `security`, `build`, `image`. **No existing job renamed** — branch protection names required checks by job name

### Verification for User Story 2 — mine

- [X] T022 [US2] Confirm, by reading the workflow file rather than running it, that `infra-preview`'s steps never invoke `pulumi up`, `staging:deploy`, `staging:deploy:reset`, or `staging:destroy` — a preview job that can mutate state is not a preview job

### Verification for User Story 2 — **Requires the user**

- [X] T023 [US2] **Requires the user.** Add `PULUMI_ACCESS_TOKEN` as a GitHub Actions encrypted secret — the one secret CI needs (research.md §4); everything else resolves from Pulumi Cloud's encrypted stack config at apply time
- [X] T024 [US2] **Requires the user.** Run quickstart Scenario 2 for real: redeploy with no changes (data preserved, SC-002); add a trivial non-domain migration and redeploy (applies automatically, no manual database command, SC-003); run `pnpm staging:deploy:reset` (database wiped and reseeded fresh, SC-002's reset-path guarantee); run `pnpm staging:destroy` (every staging resource removed; portfolio site containers still running afterward, SC-004)
- [X] T025 [US2] **Requires the user.** Run quickstart Scenario 3 for real: open a pull request with a trivial change, confirm `infra-preview` posts a preview result without altering the live environment; merge to `main`, confirm `infra-deploy` waits for every other blocking check and then the staging URL serves the merged change with no manual step (SC-008); confirm directly in `.github/workflows/ci.yml` that no CI job ever invokes `staging:destroy` or `staging:deploy:reset` (FR-020)

**Checkpoint**: Staging is a living environment, not a one-off demo, and merges reach it without a manual step.

---

## Phase 5: User Story 3 - Confirm the staging environment cannot affect the portfolio site (Priority: P3)

**Goal**: Standing up and tearing down staging never touches the VPS's existing, unrelated portfolio-site containers.

**Independent Test**: With the portfolio site's containers already running, deploy staging, confirm the portfolio site is unaffected throughout, tear staging down, confirm it is still unaffected.

### Implementation for User Story 3

- [X] T026 [US3] Write `infrastructure/deploy.test.ts` using `@pulumi/pulumi/testing`'s mock harness (research.md §5): assert the staging network name/config can never resolve to a value that would collide with the portfolio site's own containers, and that every `command.remote.*` resource's connection host is sourced from the same `StackConfig.vpsHost` value rather than a second, possibly-drifted literal. No VPS, no Pulumi Cloud, no network call — this is the one real assertion behind the constitution's "Unit tests" gate for this package, not an empty stub (research.md §5 rejects that explicitly)
- [X] T027 [US3] Confirm `infrastructure`'s `test` script is picked up by the root `test` / `turbo run test` chain and `pnpm test` passes with no database and no VPS reachable — it stays in the fast unit tier (the same SC-007 discipline spec 005 established applies here too)

### Verification for User Story 3 — **Requires the user**

- [X] T028 [US3] **Requires the user.** Run [quickstart.md](quickstart.md) Scenario 3 for real: with the portfolio site's containers already running, `pnpm staging:deploy` and confirm the portfolio site remains reachable and unaffected throughout (acceptance scenario 1); `pnpm staging:destroy` and confirm the portfolio site is still running, with its own data intact (acceptance scenario 3)
- [X] T029 [US3] **Requires the user.** Run quickstart Scenario 4: reboot the VPS (or restart just the Docker daemon if a full reboot is too disruptive to rehearse against the shared portfolio site); confirm `postgres` and `api` come back up on their own within a few minutes via `restart: unless-stopped`, with no `pnpm staging:deploy` invocation (FR-017, SC-007)

**Checkpoint**: All three user stories are independently functional. Only the founder's own VPS can prove any of them end to end — that is a property of what this feature is, not a gap in how it was built.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T030 [P] Update `README.md` with a short pointer to `docs/staging-environment.md`, consistent with the Continuous Integration section spec 005 already added there
- [X] T031 Re-read `contracts/cli-and-config.md`, `data-model.md`, and `quickstart.md` end to end against what was actually implemented, correcting any further drift — the same discipline that caught the stale four-job `infra-deploy` dependency list before this task list was written
- [X] T032 Confirm the constitution's "Infrastructure validation and preview" gate row now maps to a named, reporting check (`infra-preview`) — the same row-by-row reconciliation spec 005's T041 performed for its own three rows
- [X] T033 **Requires the user.** Once `infra-preview` has reported green at least once on a real pull request, add it to branch protection's required-check list. **`infra-deploy` cannot be a required PR check** — it triggers on `push` to `main`, after merge, so there is structurally nothing for a pull request to wait on
- [X] T034 Open a follow-up issue proposing a check that verifies `infra-deploy`'s `needs:` list is a superset of every other blocking job name in `ci.yml`. Named as a real, live gap during this feature's planning correction (contracts/cli-and-config.md) rather than left as an unenforced comment: a future feature that adds another blocking CI job and forgets to extend `infra-deploy`'s `needs:` list silently reopens the exact gap spec 005 exists to close, and nothing today would catch that but a human re-reading two lists side by side. Opened as [#19](https://github.com/rashadataf/family-platform/issues/19)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)**: none
- **Foundational (2)**: after Setup. **Blocks Phases 3–5** — T006's config schema is imported by every resource file that follows
- **US1 (3)**: after Foundational. The MVP
- **US2 (4)**: after US1 — `deploy.ts` (T011) must exist before its reset path (T020) can be added, and `infra-deploy` (T021) deploys via the mechanism US1 builds
- **US3 (5)**: after US1, for the same reason a mock test needs something to test. Independent of US2
- **Polish (6)**: after all stories; T033 additionally requires a green `infra-preview` run

### Critical path

```
T001 → T002 → T004 (must FAIL) → T005 → T006 → T009/T010 → T011 → T012 → T013 → T018 → T019
                                                                              (MVP: real deploy reaches SC-001)
```

### Sequential constraints (same file — not parallel)

- `infrastructure/src/deploy.ts`: T011, T020
- `.github/workflows/ci.yml`: T021 (this feature's only edit to it)
- Root `package.json`: T013

### Parallel opportunities

- T007 can run alongside T008–T012 (different files, no shared dependency beyond T006)
- T009 ∥ T010 (different files, both depend on T006 but not on each other)
- T030 has no dependency on the rest of Phase 6

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 → Phase 2 → Phase 3
2. **T018/T019 require the founder** — this is the point where "does it actually work" stops being something I can answer and starts being something only a real deploy can
3. At that point the platform is reachable at a stable staging URL for the first time, which is the entire point of this feature

### Incremental delivery

1. Setup + Foundational → the program has a config surface that fails safely
2. Add US1 → a working deployment exists — **the deliverable**
3. Add US2 → staging becomes iterable and merges reach it automatically
4. Add US3 → the isolation guarantee is tested, not assumed
5. Polish → T032 confirms the last constitution gate row this repository owed a check now has one

### Notes

- Commit after each task or logical group; `pnpm verify` should stay green throughout (it does not include anything VPS-reaching — `pulumi preview`/`up` are invoked only by the founder or by CI's `infra-preview`/`infra-deploy` jobs, never by `pnpm verify`)
- **T004 is designed to fail**, the same way spec 005's T025 was. If it passes, `.dependency-cruiser.cjs`'s fail-closed configuration has regressed and every guarantee built on it in spec 005 is no longer real
- **T018, T019, T023, T024, T025, T028, T029, T033 all require the founder** — real VPS SSH access, a real Pulumi Cloud login, and a GitHub Actions secret I cannot set. This is roughly a third of the task list, and it is a property of what "deploy to a VPS" means, not a shortfall in how this was planned. Everything else — the Pulumi program itself, its config validation, its one required test, the CI job definitions, the seed mechanism, the documentation — is built and verified without touching the founder's infrastructure at all
- After this feature, [ADR-004](../../adr/ADR-004-infrastructure-as-code.md)'s original AWS topology and ADR-013's Stage 1 trigger (real user data) are the next infrastructure milestone — not before then, per Additional Engineering Constraints' "a component MUST NOT be provisioned before the trigger that justifies it"
