---
description: "Task list for spec 005: Merge Gate Enforcement"
---

# Tasks: Merge Gate Enforcement

**Input**: Design documents from `/specs/005-merge-gate-enforcement/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/gates-and-config.md](contracts/gates-and-config.md), [quickstart.md](quickstart.md)

**Tests**: This feature's verification is behavioural — every gate is proven by **making it fail on purpose**. A gate confirmed only by watching it pass has been shown to run, not to catch anything. The one unit-tested piece is the harness itself, via the integration test that proves it (T032).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 boundaries · US2 security · US3 integration tests · US4 dependency updates
- Exact paths in every task

---

## Phase 1: Setup

- [X] T001 Add `dependency-cruiser` and `eslint-plugin-boundaries` as root devDependencies via `pnpm add -D -w`. These are the two tools [Constitution Principle III](../../.specify/memory/constitution.md) names in its own "Enforced by" clause, so this is implementing a decision rather than taking one
- [X] T002 Add a `boundaries` script to the root `package.json` (`depcruise --config .dependency-cruiser.cjs .`), append it to the `verify` chain, and declare a `//#boundaries` task in `turbo.json` with inputs covering `apps/**`, `packages/**`, `scripts/**` and the config file

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pin the pipeline's own supply chain before three new jobs are added to it. Doing this first avoids rebasing every new job onto a pin change, and `.github/dependabot.yml` (T036) is meaningless until the pins exist.

**⚠️ CRITICAL**: T003–T005 touch the same files every later CI task edits. Complete them before Phase 3.

- [X] T003 Pin every third-party action in `.github/workflows/ci.yml` to a full commit SHA with the human-readable version in a trailing comment (`uses: actions/checkout@11d5960… # v4`). A tag is mutable and repointable by whoever controls that repository, which is a supply-chain path into a pipeline holding write access; the comment exists because a bare 40-character hash is unreviewable (FR-025). Resolve each SHA with `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha`
- [X] T004 Pin the actions inside `.github/actions/setup/action.yml` the same way — it is a composite action and its `uses:` lines are just as mutable
- [X] T005 Verify no mutable references remain. **The command as specified is wrong**: it reports the six `uses: ./.github/actions/setup` lines as violations, and a local composite action resolves from the commit the job already checked out, so it has no external pointer to pin. Replaced with `scripts/verify-action-pins.ts` (+ `.spec.ts`), which skips local references and additionally requires the trailing version comment FR-025 asks for. Wired into the existing `verify-env` job and `pnpm verify` — a check nobody runs is not a gate
- [X] T006 **Requires the user.** Enable Dependabot alerts, currently disabled: `gh api -X PUT repos/rashadataf/family-platform/vulnerability-alerts`. This is a live repository setting. Alerts answer a question no pull-request gate can — "has something we already shipped become vulnerable since" — because nothing changed on our side for a gate to notice (research §3)

**Checkpoint**: The pipeline's own dependencies are immutable and the out-of-band notifier is on.

---

## Phase 3: User Story 1 - An architecture violation fails before review (Priority: P1) 🎯 MVP

**Goal**: A forbidden import or a dependency cycle fails a check within minutes, naming the rule and the offending import.

**Independent Test**: Add a violating import, confirm the check fails naming rule, file and target; remove it, confirm it passes.

### Implementation for User Story 1

- [X] T007 [US1] Create `.dependency-cruiser.cjs` with `options` (TypeScript resolution, workspace awareness, `node_modules`/`dist`/`generated` exclusions) and — the load-bearing part — an **`allowed`** rule set with `allowedSeverity: 'error'`. A `forbidden`-only configuration fails **open**: anything unmentioned passes. Since most rules here govern packages that do not exist yet, fail-open would leave the entire rule set decorative until `packages/core` arrives (FR-006, research §1)
- [X] T008 [US1] Add `forbidden` rules to `.dependency-cruiser.cjs` for the constraints that apply to today's tree, each with a `comment` explaining the architectural rule so a failure is self-explanatory: `no-circular` (FR-002) and `persistence-client-is-private` — the Prisma client must not be importable outside `packages/persistence` (ADR-003, Principle IV)
- [X] T009 [US1] Add the `forbidden` rules governing packages that do not exist yet, per data-model.md §1: `domain-is-pure` (no framework, ORM, cloud SDK, HTTP client, clock or RNG under `core/*/domain/**`), `no-cross-context-internals` (cross-context imports only via `application/ports/**`), `contracts-are-standalone`, `nothing-depends-on-ai`. Writing them now is the entire timing argument for this feature (FR-005)
- [X] T010 [US1] Create `packages/config-eslint/boundaries.js` with `eslint-plugin-boundaries` element types and zones mirroring T007–T009, and export it from `packages/config-eslint/index.js`. This is for **latency, not coverage** — it marks the violating import in the editor as it is typed. `dependency-cruiser` remains authoritative because a per-file linter structurally cannot see a cycle spanning packages
- [X] T011 [US1] Add a `boundaries` job to `.github/workflows/ci.yml` using the existing composite setup action, running `pnpm boundaries`. **Do not rename any existing job** — branch protection names required checks by job name (FR-028)

### Verification for User Story 1

- [X] T012 [US1] Ran scenario 1. **The scenario's own example does not exercise the rule it names**: `import { PrismaClient } from '@prisma/client'` in `apps/api` fails as `not-in-allowed` + `no-unresolvable`, because `@prisma/client` is not declared in `apps/api/package.json` and pnpm strict linking (ARCHITECTURE §8.2 layer 4) already makes it unresolvable — a stronger outcome, but a different rule. The import that reaches `persistence-client-is-private` is the deep one, `../../../packages/persistence/src/client.js`, which resolves. Confirmed it names rule, file and target, and `--output-type err-long` prints the rule's `comment` too
- [X] T013 [P] [US1] Run quickstart scenario 3: create a deliberate two-file cycle (`apps/api/src/__cycle-a.ts` importing `__cycle-b.ts` and back), run `pnpm boundaries`, confirm the failure prints the **complete cycle** rather than one edge, then delete both files (FR-002)
- [X] T014 [P] [US1] Confirm FR-007 holds: verify there is no per-line comment that suppresses a `dependency-cruiser` rule. The constitution ranks a rule "that can be disabled with a comment" below one that cannot; changing a boundary must be a reviewable diff in the rule set
- [X] T015 [US1] Confirm `pnpm boundaries` passes on the clean tree and reports which rules were evaluated (US1 acceptance scenario 1)

**Checkpoint**: Architecture boundaries are mechanically enforced for the first time. Stop and validate here — this is the MVP.

---

## Phase 4: User Story 2 - A secret or vulnerable dependency cannot reach main (Priority: P1)

**Goal**: Credential-shaped content and high-severity advisories block the merge.

**Independent Test**: Plant a fake credential on a throwaway branch and confirm the merge is blocked; add a known-vulnerable dependency and confirm the same.

> **Note before starting.** GitHub secret scanning and push protection are **already enabled** (the repository is public, where both are free). Push protection is stronger than the gate FR-009 asked for — it rejects the push, so the secret never enters history. The work below is the second layer that catches what GitHub's partner-pattern list does not, such as `DATABASE_URL=postgresql://postgres:<password>@host/db` (research §2).

### Implementation for User Story 2

- [X] T016 [P] [US2] Created `.gitleaks.toml`. **The path allowlist alone was not enough, and was not even load-bearing at first**: gitleaks' default rules do not flag `.env.example` at all, *and* they do not flag `DATABASE_URL=postgresql://user:pw@host/db` — the exact example research §2 used to justify adding gitleaks as a second layer. Verified by planting one and getting a clean scan. Added a `database-connection-string-password` rule, which makes the allowlist real; allowlisted the placeholder values (`localdev`, `${VAR}`, `<password>`) by value rather than by file, so a genuine credential landing in `.env.example` later is still caught
- [X] T017 [P] [US2] Created `osv-scanner.toml`. **The key is `ignoreUntil`, not `until`** — a file using `until` does not parse. More importantly the expiry is **optional as far as osv-scanner is concerned**, so FR-013 could not be met by the config file alone: an entry without one silences its finding permanently. Added `scripts/verify-suppressions.ts` (+ 8 tests) enforcing it, wired into the `security` job and `pnpm verify`
- [X] T018 [US2] Add a `security` job to `.github/workflows/ci.yml` running `gitleaks` against the pull request's changes and `osv-scanner` against `pnpm-lock.yaml`, failing on HIGH and CRITICAL. Configure output so a detected secret's **location** is reported without its **value** — this repository is public, so a build log is at least as readable as the code (FR-010)
- [X] T019 [US2] Add a `trivy` step to the **existing** `image` job scanning the built `runtime` image for HIGH/CRITICAL OS and library CVEs. A step rather than a job: that job already builds the artifact, and `osv-scanner` reads the lockfile so it cannot see the Debian packages in the base layer — which are on a different update cadence and are what ADR-013 ships to a VPS (FR-016)
- [X] T020 [US2] Add `.github/workflows/secret-audit.yml`: a scheduled, **non-blocking** full-history `gitleaks` scan. Blocking every merge on a secret already published in a public repository would be theatre — it is already harvested, and rotation is the only remedy. New introductions block; pre-existing findings are triaged (FR-015)

### Verification for User Story 2

- [X] T021 [US2] Scenario 5 passes — clean against the repository including `.env.example`. Run before scenario 4, as specified. Two findings needed fixing first: the connection-string rule added in T016 flagged this feature's **own** research.md and tasks.md, which illustrated a credential using a credential-shaped literal. Fixed the prose to `<password>` rather than allowlisting `specs/**` — allowlisting the documents would have blinded the scanner to a real credential pasted into a spec later
- [X] T022 [US2] Scenario 4 verified locally rather than by pushing a probe branch to a public repository. **The scenario's own example value is undetectable**: `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` is AWS's documentation key and is allowlisted by gitleaks as a known false positive, so following the quickstart literally would have produced a clean scan and 'proved' a gate that does nothing. With non-famous fake values, `github-pat` and `generic-api-key` both fire, and `--redact` reports `secret=REDACTED` — FR-010 holds
- [X] T023 [US2] Scenario 6 verified end to end, and the gate found real vulnerabilities on its first run: **5 advisories, 4 HIGH** (`multer` ×4 via @nestjs/platform-express, `deepmerge-ts` CVSS 8.2 via @prisma/config). Neither parent has a release that drops them — @nestjs/platform-express@12 still requires multer 2.2.0 — so both were pinned past the advisory with pnpm `overrides` rather than suppressed: an override removes the risk, a suppression only accepts it. Prisma verified working on the major deepmerge-ts bump. Expiry proved by experiment: 4 findings → 3 with a future `ignoreUntil` → 4 again with a past one
- [X] T024 [US2] Scenario 9 verified. The configured gate (HIGH/CRITICAL, `--ignore-unfixed`) reports 0 on the runtime image. Proved it *can* fail rather than assuming: at a lowered threshold the same image yields 230 findings and trivy exits 1. That run also justified `--ignore-unfixed` empirically — the base image carries HIGH Debian CVEs with `fixed: none` (e.g. CVE-2026-53613 in bsdutils), so without it this gate would be permanently red for reasons nobody here can action

**Checkpoint**: Secrets and vulnerable dependencies are blocked, and the constitution's `TODO(SECURITY_SCAN_TOOLING)` — open since ratification — can be struck.

---

## Phase 5: User Story 3 - The first repository can be tested against a real database (Priority: P2)

**Goal**: A harness gives tests a real, migrated, isolated PostgreSQL, identically on both local paths and in CI.

**Independent Test**: Run the integration suite on both paths and in CI; confirm it sees the committed schema and that a deliberately failing assertion fails the build.

### Implementation for User Story 3

- [X] T025 [US3] **Done, and it failed exactly as required.** Creating the skeleton turned the gate red: `not-in-allowed: packages/testing/eslint.config.js → packages/config-eslint/index.js`, exit 1. The configuration is fail-closed, proved by experiment rather than by reading it (FR-006, SC-002)
- [X] T026 [US3] Add the `allowed` entry for `packages/testing` to `.dependency-cruiser.cjs` and confirm `pnpm boundaries` passes again. Record in the task notes that T025 failed as required
- [X] T027 [P] [US3] Implement `packages/testing/src/database.ts`: ensure a `family_platform_test` database exists and carries every committed migration, once per run. A **separate** database from development — a suite that truncates the database you were just working in teaches people not to run it (FR-017, FR-018)
- [X] T028 [P] [US3] Implement `packages/testing/src/transaction.ts`: open a transaction per test and roll it back afterwards. This gives clean state at negligible cost and makes the parallelism edge case moot, since tests never observe each other's uncommitted work (FR-018)
- [X] T029 [US3] Implement `packages/testing/src/index.ts` exporting the harness surface. Do not export a Prisma client — `packages/persistence` owns that and never exposes it (Principle IV)
- [X] T030 [US3] Create a root `vitest.config.ts` using Vitest's `projects` to split `unit` (no database) from `integration` (real database). Vitest 5.0.0 is already installed
- [X] T031 [US3] Add a `test:integration` root script and keep `test` running the **unit tier only**. The `test` job name must not change (FR-028), and the unit tier must stay database-free and under 30s (FR-021, SC-007)
- [X] T032 [US3] Written as `packages/testing/src/harness.integration.spec.ts`, **not** in `packages/persistence` as specified. Putting it there would need `@fp/testing` as a devDependency of `@fp/persistence`, which already depends on it — a workspace dependency cycle, weakening ARCHITECTURE §8.2's strongest boundary layer (package.json dependency absence) to place one test file. The test exercises the same thing from the package that owns the harness. 6 tests, including a guard that `current_database()` ends in `_test`
- [X] T033 [US3] Add a `test-integration` job to `.github/workflows/ci.yml` with a PostgreSQL service container, applying migrations and running the integration tier. Separate from `test` because the constitution's own gate table lists unit and integration tests as separate rows, and one job would make the fast tier as slow as the slow one (FR-019)

### Verification for User Story 3

- [X] T034 [US3] Scenario 7 verified on **both** paths with the identical command — 6 passed each (FR-020, SC-006). **The containerized path failed the first time**: `Cannot find package '@fp/persistence'`. `apps/api/Dockerfile` enumerates each workspace package's package.json for layer caching and did not know about the new one, so the image installed no dependencies for it. Only the container path shows this, so a host-based contributor would never see it. Added `scripts/verify-workspace-packages.ts` (+7 tests) enforcing all three declarations, per ADR-014's rule that a duplication be guarded by a check rather than a comment — both files already carried such a comment, and I missed one anyway. Then `docker compose down` + `pnpm test`: 53 tests, 0.72s, no database (SC-007)
- [X] T035 [US3] Scenario 8 verified: a broken assertion gives a non-zero exit and a red suite; reverted, 6 pass (FR-023)

**Checkpoint**: The first repository implementation can now ship with a real-database test instead of getting one retrofitted.

---

## Phase 6: User Story 4 - Updates arrive automatically and pins do not rot (Priority: P3)

**Goal**: Dependency and action updates are proposed on a schedule, keeping T003–T004's pins current.

**Independent Test**: Confirm the configuration covers both ecosystems, groups updates, and that every action reference is immutable.

- [X] T036 [US4] Create `.github/dependabot.yml` covering the `npm` ecosystem (pnpm workspace, at `/`) and the **`github-actions`** ecosystem, with `groups:` to batch routine updates. The actions ecosystem is the half that makes T003–T004 safe rather than merely stale: a pin nobody updates is a component that silently stops receiving security patches (FR-024, FR-026, FR-027). Dependabot rather than Renovate because Renovate's hosted form is a third-party service with write access, which the constitution requires an ADR and privacy review for (research §5)
- [X] T037 [US4] Scenario 10 verified: no mutable non-local action reference remains, `github-actions` is configured, and updates are grouped. Also added the `docker` ecosystem for the Node base image. Recorded the gap it does not close: the scanner images in `ci.yml`/`secret-audit.yml` are digests inside `run:` steps and no ecosystem sees them — they are bumped by hand

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T038 [P] Update `docs/local-development.md`: the two test tiers and when to run each, `pnpm boundaries`, and the container-native form of both — a contributor without the host toolchain must not be blocked (spec 004 FR-004)
- [X] T039 [P] Update the root `README.md` Continuous Integration section to list all ten checks
- [ ] T040 **Requires the user.** Reconcile branch protection once every new job has reported green at least once (FR-029), using the `gh api -X PATCH .../branches/main/protection/required_status_checks` command in [contracts/gates-and-config.md §4](contracts/gates-and-config.md) with the ten-check target list. **Adding a check before it has ever reported blocks every merge forever on a check that never arrives** — this is the reason for the ordering, not caution for its own sake
- [ ] T041 Verify SC-009 and SC-010 by reading lists side by side: every row of the constitution's merge-gate table maps to a named check, and the required-check list exactly equals the set of reporting blocking checks. Today seven checks report and four are required — `format`, `verify-env` and `image` block nothing. This task is the feature's actual purpose and cannot be delegated to an assumption
- [ ] T042 Strike `TODO(SECURITY_SCAN_TOOLING)` from the constitution's sync impact report, since US2 resolves it. **A constitution edit MUST be its own pull request** (Governance: an amendment must not be bundled with a feature change) — open it separately
- [ ] T043 Re-read `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`, `.github/dependabot.yml` and `vitest.config.ts` end to end against [contracts/gates-and-config.md](contracts/gates-and-config.md), confirming every job name, command and configuration path matches
- [ ] T044 Open a follow-up issue (`gh issue create`) proposing an ADR that records the **public repository** decision deliberately ([research.md](research.md) §0). Public is defensible, but nothing currently records it as chosen, and for a project that will hold children's data the three consequences — permanently public history, publicly readable authorization controls, and scrapers harvesting commits within seconds — deserve a decision rather than an inheritance

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)**: none
- **Foundational (2)**: after Setup. **Blocks Phases 3–6** — T003/T004 touch the files every later CI task edits
- **US1 (3)**: after Foundational. The MVP
- **US2 (4)**: after Foundational. Independent of US1
- **US3 (5)**: after **US1**, not merely after Foundational — T025 depends on the boundary gate existing in order to prove fail-closed behaviour
- **US4 (6)**: after Foundational (needs the pins from T003/T004)
- **Polish (7)**: after all stories; T040/T041 additionally require green CI runs

### Critical path

```
T001 → T002 → T003 → T007 → T011 → T012        (MVP: boundaries enforced)
                        └──→ T025 (must FAIL) → T026 → T033 → T034
```

### Sequential constraints (same file — none of these are parallel)

- `.dependency-cruiser.cjs`: T007, T008, T009, T026
- `.github/workflows/ci.yml`: T003, T011, T018, T019, T033
- Root `package.json`: T002, T031

### Parallel opportunities

- T013 ∥ T014 (different concerns, no shared files)
- T016 ∥ T017 (different config files)
- T027 ∥ T028 (different source files)
- T038 ∥ T039 (different documents)
- **US1 and US2 can proceed in parallel** after Phase 2, if two people are available. US3 cannot — it depends on US1.

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 → Phase 2 → Phase 3
2. **STOP and VALIDATE** at T012–T015
3. At that point architecture boundaries are mechanically enforced for the first time, and the rules governing `packages/core` are in place *before* it exists — which is the whole timing argument for this feature

### Incremental delivery

1. Setup + Foundational → the pipeline's own supply chain is pinned
2. Add US1 → boundaries enforced → **the deliverable**
3. Add US2 → the constitution's oldest open TODO is closed
4. Add US3 → the next feature's repositories can ship with real tests
5. Add US4 → pins stay current instead of rotting
6. Polish → T041 confirms the gate table is finally complete

### Notes

- Commit after each task or logical group; `pnpm verify` should stay green throughout
- **T025 is the one task designed to fail.** If it passes, stop — the boundary configuration is fail-open and everything built on it is decoration
- T006, T040 and T044 involve something outside the repository: a live setting, branch protection, and a decision for the founder. None can be marked complete on my judgement alone
- After this feature, the next work should be ADR-007 (authentication) and the first bounded context. This is intended to be the last feature whose subject is the repository itself
