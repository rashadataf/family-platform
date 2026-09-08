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

- [ ] T007 [US1] Create `.dependency-cruiser.cjs` with `options` (TypeScript resolution, workspace awareness, `node_modules`/`dist`/`generated` exclusions) and — the load-bearing part — an **`allowed`** rule set with `allowedSeverity: 'error'`. A `forbidden`-only configuration fails **open**: anything unmentioned passes. Since most rules here govern packages that do not exist yet, fail-open would leave the entire rule set decorative until `packages/core` arrives (FR-006, research §1)
- [ ] T008 [US1] Add `forbidden` rules to `.dependency-cruiser.cjs` for the constraints that apply to today's tree, each with a `comment` explaining the architectural rule so a failure is self-explanatory: `no-circular` (FR-002) and `persistence-client-is-private` — the Prisma client must not be importable outside `packages/persistence` (ADR-003, Principle IV)
- [ ] T009 [US1] Add the `forbidden` rules governing packages that do not exist yet, per data-model.md §1: `domain-is-pure` (no framework, ORM, cloud SDK, HTTP client, clock or RNG under `core/*/domain/**`), `no-cross-context-internals` (cross-context imports only via `application/ports/**`), `contracts-are-standalone`, `nothing-depends-on-ai`. Writing them now is the entire timing argument for this feature (FR-005)
- [ ] T010 [US1] Create `packages/config-eslint/boundaries.js` with `eslint-plugin-boundaries` element types and zones mirroring T007–T009, and export it from `packages/config-eslint/index.js`. This is for **latency, not coverage** — it marks the violating import in the editor as it is typed. `dependency-cruiser` remains authoritative because a per-file linter structurally cannot see a cycle spanning packages
- [ ] T011 [US1] Add a `boundaries` job to `.github/workflows/ci.yml` using the existing composite setup action, running `pnpm boundaries`. **Do not rename any existing job** — branch protection names required checks by job name (FR-028)

### Verification for User Story 1

- [ ] T012 [US1] Run quickstart scenario 1: append `import { PrismaClient } from '@prisma/client';` to `apps/api/src/main.ts`, confirm `pnpm boundaries` fails naming the rule, the file **and** the import target, then revert. A failure saying only "boundary violation" does not satisfy FR-003
- [ ] T013 [P] [US1] Run quickstart scenario 3: create a deliberate two-file cycle (`apps/api/src/__cycle-a.ts` importing `__cycle-b.ts` and back), run `pnpm boundaries`, confirm the failure prints the **complete cycle** rather than one edge, then delete both files (FR-002)
- [ ] T014 [P] [US1] Confirm FR-007 holds: verify there is no per-line comment that suppresses a `dependency-cruiser` rule. The constitution ranks a rule "that can be disabled with a comment" below one that cannot; changing a boundary must be a reviewable diff in the rule set
- [ ] T015 [US1] Confirm `pnpm boundaries` passes on the clean tree and reports which rules were evaluated (US1 acceptance scenario 1)

**Checkpoint**: Architecture boundaries are mechanically enforced for the first time. Stop and validate here — this is the MVP.

---

## Phase 4: User Story 2 - A secret or vulnerable dependency cannot reach main (Priority: P1)

**Goal**: Credential-shaped content and high-severity advisories block the merge.

**Independent Test**: Plant a fake credential on a throwaway branch and confirm the merge is blocked; add a known-vulnerable dependency and confirm the same.

> **Note before starting.** GitHub secret scanning and push protection are **already enabled** (the repository is public, where both are free). Push protection is stronger than the gate FR-009 asked for — it rejects the push, so the secret never enters history. The work below is the second layer that catches what GitHub's partner-pattern list does not, such as `DATABASE_URL=postgresql://postgres:realpassword@host/db` (research §2).

### Implementation for User Story 2

- [ ] T016 [P] [US2] Create `.gitleaks.toml` allowlisting `.env.example` by path. Its values are deliberately fake and its whole purpose is to be a template; a scanner that fails on the repository's own fixtures gets switched off within a week, and then it protects nothing (FR-014)
- [ ] T017 [P] [US2] Create `osv-scanner.toml` with no entries yet and a header comment stating the rule every future entry must follow: an `ignore` entry MUST carry an `until` date. This mirrors the constitution's own governance rule that an exception without an expiry MUST NOT be granted (FR-013)
- [ ] T018 [US2] Add a `security` job to `.github/workflows/ci.yml` running `gitleaks` against the pull request's changes and `osv-scanner` against `pnpm-lock.yaml`, failing on HIGH and CRITICAL. Configure output so a detected secret's **location** is reported without its **value** — this repository is public, so a build log is at least as readable as the code (FR-010)
- [ ] T019 [US2] Add a `trivy` step to the **existing** `image` job scanning the built `runtime` image for HIGH/CRITICAL OS and library CVEs. A step rather than a job: that job already builds the artifact, and `osv-scanner` reads the lockfile so it cannot see the Debian packages in the base layer — which are on a different update cadence and are what ADR-013 ships to a VPS (FR-016)
- [ ] T020 [US2] Add `.github/workflows/secret-audit.yml`: a scheduled, **non-blocking** full-history `gitleaks` scan. Blocking every merge on a secret already published in a public repository would be theatre — it is already harvested, and rotation is the only remedy. New introductions block; pre-existing findings are triaged (FR-015)

### Verification for User Story 2

- [ ] T021 [US2] Run quickstart scenario 5 first: `gitleaks detect --no-git --config .gitleaks.toml` MUST be clean against the repository as it stands, including `.env.example` (SC-005). Do this before scenario 4 — a scanner with false positives is not worth testing for true ones
- [ ] T022 [US2] Run quickstart scenario 4 on a throwaway branch with an obviously fake but credential-shaped value (**never a real credential — this repository is public**). Confirm either push protection rejects the push or the `security` job fails, and confirm the output does **not** contain the value (FR-010). Delete the branch
- [ ] T023 [US2] Run quickstart scenario 6: add a dependency with a known HIGH advisory, confirm `security` fails naming package, advisory and fix; then add an `osv-scanner.toml` entry with an expiry **in the past** and confirm it still fails. An expiry that does not re-fail is permanent silence with extra steps (FR-013)
- [ ] T024 [US2] Run quickstart scenario 9: confirm the `image` job's `trivy` step runs and fails the job on a HIGH/CRITICAL finding

**Checkpoint**: Secrets and vulnerable dependencies are blocked, and the constitution's `TODO(SECURITY_SCAN_TOOLING)` — open since ratification — can be struck.

---

## Phase 5: User Story 3 - The first repository can be tested against a real database (Priority: P2)

**Goal**: A harness gives tests a real, migrated, isolated PostgreSQL, identically on both local paths and in CI.

**Independent Test**: Run the integration suite on both paths and in CI; confirm it sees the committed schema and that a deliberately failing assertion fails the build.

### Implementation for User Story 3

- [ ] T025 [US3] Create the `packages/testing` skeleton (`package.json`, `tsconfig.json`, `eslint.config.js`) in the location [ARCHITECTURE §8](../../ARCHITECTURE.md) already reserves for it — **then run `pnpm boundaries` and confirm it FAILS.** This is the fail-closed proof (FR-006, SC-002, quickstart scenario 2): a package with no rule covering it must be a violation. **If this passes, the T007 configuration is fail-open and the entire boundary guarantee is imaginary — stop and fix it before continuing**
- [ ] T026 [US3] Add the `allowed` entry for `packages/testing` to `.dependency-cruiser.cjs` and confirm `pnpm boundaries` passes again. Record in the task notes that T025 failed as required
- [ ] T027 [P] [US3] Implement `packages/testing/src/database.ts`: ensure a `family_platform_test` database exists and carries every committed migration, once per run. A **separate** database from development — a suite that truncates the database you were just working in teaches people not to run it (FR-017, FR-018)
- [ ] T028 [P] [US3] Implement `packages/testing/src/transaction.ts`: open a transaction per test and roll it back afterwards. This gives clean state at negligible cost and makes the parallelism edge case moot, since tests never observe each other's uncommitted work (FR-018)
- [ ] T029 [US3] Implement `packages/testing/src/index.ts` exporting the harness surface. Do not export a Prisma client — `packages/persistence` owns that and never exposes it (Principle IV)
- [ ] T030 [US3] Create a root `vitest.config.ts` using Vitest's `projects` to split `unit` (no database) from `integration` (real database). Vitest 5.0.0 is already installed
- [ ] T031 [US3] Add a `test:integration` root script and keep `test` running the **unit tier only**. The `test` job name must not change (FR-028), and the unit tier must stay database-free and under 30s (FR-021, SC-007)
- [ ] T032 [US3] Write `packages/persistence/src/scaffold-probe.integration.spec.ts` exercising the harness end to end against the committed scaffolding table — proving the mechanism before there is domain code to use it, exactly as spec 001 proved the migration mechanism (FR-022)
- [ ] T033 [US3] Add a `test-integration` job to `.github/workflows/ci.yml` with a PostgreSQL service container, applying migrations and running the integration tier. Separate from `test` because the constitution's own gate table lists unit and integration tests as separate rows, and one job would make the fast tier as slow as the slow one (FR-019)

### Verification for User Story 3

- [ ] T034 [US3] Run quickstart scenario 7 on **both** paths — `docker compose run --rm api pnpm test:integration` and `pnpm test:integration` — confirming the same command works with no path-specific flags (FR-020, SC-006). Then run `docker compose down` and confirm `pnpm test` still passes in under 30 seconds with no database anywhere; if it needs one, the tiers have leaked (SC-007)
- [ ] T035 [US3] Run quickstart scenario 8: break an assertion in the integration test, confirm a non-zero exit locally and a failed `test-integration` job on a pull request, then revert. A harness whose failures do not propagate produces a green check that means nothing — the vacuous-gate problem this project already fixed once (FR-023)

**Checkpoint**: The first repository implementation can now ship with a real-database test instead of getting one retrofitted.

---

## Phase 6: User Story 4 - Updates arrive automatically and pins do not rot (Priority: P3)

**Goal**: Dependency and action updates are proposed on a schedule, keeping T003–T004's pins current.

**Independent Test**: Confirm the configuration covers both ecosystems, groups updates, and that every action reference is immutable.

- [ ] T036 [US4] Create `.github/dependabot.yml` covering the `npm` ecosystem (pnpm workspace, at `/`) and the **`github-actions`** ecosystem, with `groups:` to batch routine updates. The actions ecosystem is the half that makes T003–T004 safe rather than merely stale: a pin nobody updates is a component that silently stops receiving security patches (FR-024, FR-026, FR-027). Dependabot rather than Renovate because Renovate's hosted form is a third-party service with write access, which the constitution requires an ADR and privacy review for (research §5)
- [ ] T037 [US4] Run quickstart scenario 10: confirm `grep -rn "uses:" .github/ | grep -v "@[0-9a-f]\{40\}"` prints nothing, that `.github/dependabot.yml` includes `github-actions`, and that grouping is configured. Note that the first update pull requests may take up to a day to appear; the configuration is what this task verifies

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T038 [P] Update `docs/local-development.md`: the two test tiers and when to run each, `pnpm boundaries`, and the container-native form of both — a contributor without the host toolchain must not be blocked (spec 004 FR-004)
- [ ] T039 [P] Update the root `README.md` Continuous Integration section to list all ten checks
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
