---

description: "Task list template for feature implementation"
---

# Tasks: GitHub Actions CI Pipeline

**Input**: Design documents from `/specs/002-ci-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/required-checks.md, quickstart.md (all present)

**Tests**: No dedicated test-writing tasks — this feature adds CI plumbing, not application code; "testing" this feature means running it for real against the live repository, which is what each story's verification tasks do.

**Organization**: Tasks are grouped by user story (spec.md's User Story 1/2/3) to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every task's target file lives in the repository root (`family-platform/`)

## Phase 1: Setup

**Purpose**: Add the minimal plumbing needed for a `test` step to exist and pass with zero test files, per research.md decision 3. Nothing here depends on the workflow file, so all three tasks touch different files with no ordering dependency.

- [X] T001 [P] Add a `test` task to `turbo.json`, matching the existing shape of `build`/`typecheck`/`lint` (no `dependsOn` beyond what those already declare)
- [X] T002 [P] Add a root `test` script (`"test": "turbo test"`) to `package.json`, alongside the existing `typecheck`/`lint`/`build` scripts
- [X] T003 [P] Add a guaranteed-passing stub script (`"test": "echo \"no tests yet\" && exit 0"`) to `apps/api/package.json` — no other package in the workspace gets a `test` script

**Checkpoint**: `pnpm test` succeeds at the workspace root with zero test files anywhere (FR-005 plumbing in place, verified for real later in User Story 1).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core workflow skeleton every job in every user story runs inside. No user story can be verified until this exists.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Create `.github/workflows/ci.yml` with the workflow `name`, the `on` triggers (`pull_request` against `main`, `push` to `main`), the top-level `permissions: contents: read` block, and the `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` block, exactly matching `specs/002-ci-pipeline/contracts/required-checks.md` — no `jobs:` yet

**Checkpoint**: The workflow file exists with correct triggers/permissions/concurrency; job definitions are added in User Story 1.

---

## Phase 3: User Story 1 - Automatic, clearly-attributed pull request feedback (Priority: P1) 🎯 MVP

**Goal**: Every pull request and every push to `main` runs four independently visible checks — `typecheck`, `lint`, `test`, `build` — each reporting its own pass/fail status.

**Independent Test**: Open a pull request containing a change that breaks exactly one gate (e.g. a lint violation with no type or build errors); confirm the pull request's checks list shows that one check failed while the others show passed, visible from the checks list itself.

### Implementation for User Story 1

- [X] T005 [US1] Add the `typecheck` job to `.github/workflows/ci.yml`: `actions/checkout@v4`, `actions/setup-node@v4` (`node-version-file: .nvmrc`), `pnpm/action-setup@v4`, `pnpm install --frozen-lockfile`, `pnpm exec turbo run typecheck`
- [X] T006 [US1] Add the `lint` job to `.github/workflows/ci.yml`, same install pattern as T005, running `pnpm exec turbo run lint`
- [X] T007 [US1] Add the `test` job to `.github/workflows/ci.yml`, same install pattern as T005, running `pnpm exec turbo run test`
- [X] T008 [US1] Add the `build` job to `.github/workflows/ci.yml`, same install pattern as T005, running `pnpm exec turbo run build`

### Verification for User Story 1

- [ ] T009 [US1] Push `.github/workflows/ci.yml` on a throwaway branch, open a real pull request against `main`, and confirm the checks list shows four independent entries (`typecheck`, `lint`, `test`, `build`), with `test` passing despite zero test files existing (FR-005), per `quickstart.md` scenario 1
- [ ] T010 [US1] From that same branch, introduce a single deliberate lint violation only (no type or build error), push, and confirm only the `lint` check shows failed while the other three show passed, per `quickstart.md` scenario 2 (SC-005)
- [ ] T011 [US1] Fix the lint violation, merge the pull request, and confirm on the repository's Actions tab that the push-triggered run for the new `main` commit executed all four jobs, per `quickstart.md` scenario 4 (FR-002)

**Checkpoint**: User Story 1 is fully functional and independently verifiable — every check is automatic and individually attributable, with no caching and no merge-blocking yet.

---

## Phase 4: User Story 2 - Merge is blocked until required checks pass (Priority: P2)

**Goal**: A pull request cannot be merged while any of the four required checks is failing or still in progress.

**Independent Test**: Open a pull request with a deliberately failing check and confirm the merge control is blocked and identifies which required check has not passed; separately, confirm a pull request where every required check has passed is permitted to merge.

### Implementation for User Story 2

- [ ] T012 [US2] Apply branch protection to `main` requiring the `typecheck`, `lint`, `test`, `build` status checks, using the exact `gh api` command documented in `specs/002-ci-pipeline/contracts/required-checks.md` — this is a live, shared repository setting; confirm with the user before running it

### Verification for User Story 2

- [ ] T013 [US2] Open a pull request with a deliberately failing check and confirm the merge control is blocked and states which required check is not passing, per `quickstart.md` scenario 3 (FR-004, SC-003)
- [ ] T014 [US2] Fix the failure, push, wait for all four checks to pass, and confirm the same pull request becomes mergeable, per `quickstart.md` scenario 3 (SC-004)

**Checkpoint**: User Stories 1 and 2 both work independently — checks run and are individually visible, and a failing check now genuinely blocks merge.

---

## Phase 5: User Story 3 - Fast feedback through avoiding redundant work (Priority: P3)

**Goal**: Dependency installation and per-package task results are reused across runs so unaffected work isn't repeated.

**Independent Test**: Run the pipeline twice with only a trivial change to a single package between the two runs; confirm the second run's output shows unaffected packages' tasks restored from a prior result, and total run time is measurably shorter than the first, cold run.

### Implementation for User Story 3

- [X] T015 [US3] Add `cache: 'pnpm'` to each of the four jobs' `actions/setup-node` step in `.github/workflows/ci.yml`, keyed on `pnpm-lock.yaml` (FR-006, research.md decision 2)
- [X] T016 [US3] Add an `actions/cache@v4` step for the `.turbo` directory to each of the four jobs in `.github/workflows/ci.yml`, placed before the `turbo run` step, keyed per-job as `turbo-<job>-${{ runner.os }}-${{ github.sha }}` with restore-keys `turbo-<job>-${{ runner.os }}-` (FR-007, research.md decision 2)

### Verification for User Story 3

- [ ] T017 [US3] Push a trivial change touching only one workspace package on top of an already-cached branch, and confirm the run completes within 5 minutes with cache-hit output visible in the job logs for every unaffected package, per `quickstart.md` scenario 6 (SC-001, SC-006)
- [ ] T018 [US3] Confirm a cold run (e.g. after a lockfile change invalidates the cache) still completes correctly within 15 minutes, per `quickstart.md` scenario 6 (SC-002, FR-008)

**Checkpoint**: All three user stories are independently functional — automatic per-step feedback, merge blocking, and cache-accelerated re-runs.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the edge cases that span all three stories rather than belonging to one, and close out documentation.

- [ ] T019 [P] Run the remaining `quickstart.md` scenarios not yet exercised by story verification — scenario 5 (a superseded run is cancelled and does not block the PR's current status, FR-011) and scenario 8 (a fork pull request runs with read-only token permissions, FR-012)
- [X] T020 [P] Add a short "Continuous Integration" section to the root `README.md` naming the four required checks and linking to `specs/002-ci-pipeline/contracts/required-checks.md`
- [X] T021 Re-read `.github/workflows/ci.yml` against `specs/002-ci-pipeline/contracts/required-checks.md` end to end and confirm every job name, trigger, permission, and concurrency setting matches the contract exactly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: No dependencies on Setup's file changes, but conventionally follows it — BLOCKS all user stories (no job can be added to a workflow file that doesn't exist yet).
- **User Story 1 (Phase 3)**: Depends on Foundational. Depends on Setup's `test` task/scripts existing, since T007's `test` job has nothing to run otherwise.
- **User Story 2 (Phase 4)**: Depends on User Story 1 — branch protection references check names (`typecheck`, `lint`, `test`, `build`) that must already exist as real check runs on the repository before GitHub will let branch protection require them.
- **User Story 3 (Phase 5)**: Depends on User Story 1 — caching steps are added inside the same four job definitions US1 creates. Does not depend on User Story 2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- User Story 1: the four job-definition tasks (T005-T008) all edit the same file (`.github/workflows/ci.yml`) and are sequential, not parallel, despite defining independent jobs — same-file edits are never marked `[P]`. Verification tasks (T009-T011) follow in order since each pushes a new commit building on the last.
- User Story 2: T012 (a live `gh api` call, not a file edit) precedes its own verification tasks.
- User Story 3: T015-T016 are sequential edits to the same file; verification follows.

### Parallel Opportunities

- Setup: T001, T002, and T003 touch three different files with no dependency between them — run in parallel.
- Polish: T019 (live verification) and T020 (README edit) touch unrelated files — run in parallel. T021 should run last, after both.
- No parallel opportunities exist within a user story's implementation tasks, since every implementation task in this feature edits the single shared workflow file.

---

## Parallel Example: Setup

```bash
# Launch all three Setup tasks together:
Task: "Add a `test` task to turbo.json"
Task: "Add a root `test` script to package.json"
Task: "Add a stub `test` script to apps/api/package.json"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (test plumbing).
2. Complete Phase 2: Foundational (workflow skeleton).
3. Complete Phase 3: User Story 1 (four jobs, individually visible checks).
4. **STOP and VALIDATE**: run T009-T011 for real against the live repository.
5. This alone delivers the constitution's CI-gate visibility requirement, even before merge is actually blocked.

### Incremental Delivery

1. Setup + Foundational → workflow skeleton ready.
2. Add User Story 1 → verify independently → checks run and are attributable (MVP).
3. Add User Story 2 → verify independently → merge is now actually gated.
4. Add User Story 3 → verify independently → runs get measurably faster.
5. Polish → edge cases (fork PRs, superseded runs) and documentation.

---

## Notes

- Every implementation task in this feature (T004-T008, T015-T016) edits the same single file, `.github/workflows/ci.yml` — this is expected for a one-workflow CI feature and is why `[P]` is reserved for Setup and Polish only.
- T012 (branch protection) is the one task in this feature that is not a file edit — it is a live, shared repository setting change and must be explicitly confirmed before running, per the caveat already recorded in `research.md` decision 6 and `contracts/required-checks.md`.
- Verify each story's checkpoint for real (push a real commit, open a real pull request) rather than only reading the YAML — this feature's correctness is only observable by watching GitHub Actions and the PR checks UI actually behave as specified, the same rigor spec 001's implementation used against a real local Postgres instance.
