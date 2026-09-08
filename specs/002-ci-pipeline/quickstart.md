# Quickstart: Validating the CI Pipeline

These scenarios validate this feature end-to-end once implemented. Each maps back to an acceptance scenario or success criterion in [spec.md](spec.md). This is a validation guide, not an implementation reference — see [plan.md](plan.md), [research.md](research.md), and [contracts/required-checks.md](contracts/required-checks.md) for design detail.

## Prerequisites

- The workflow file exists at `.github/workflows/ci.yml` and is pushed to the repository.
- `gh` CLI authenticated against `rashadataf/family-platform`.
- Branch protection has been applied per [contracts/required-checks.md](contracts/required-checks.md) (a separate, explicitly-confirmed step — see that document).

## 1. Every check runs and reports individually (User Story 1, Acceptance Scenario 1)

```sh
git checkout -b ci-quickstart-check
git commit --allow-empty -m "trigger CI"
git push -u origin ci-quickstart-check
gh pr create --fill
```

**Expected**: The pull request's checks list shows four separate entries — `typecheck`, `lint`, `test`, `build` — each independently reporting pass/fail, visible without opening any job's log.

## 2. A single failing gate is individually attributable (User Story 1, Acceptance Scenario 2 / SC-005)

Introduce a single lint violation only (e.g. an unused variable) with no type or build error, push it, and open/update a pull request.

**Expected**: Only the `lint` check shows as failed; `typecheck`, `test`, and `build` show as passed. The failing step is identifiable from the checks list alone.

## 3. Merge is blocked on a failing or pending required check (User Story 2, Acceptance Scenarios 1–2 / SC-003, SC-004)

With the failing PR from step 2 still open:

```sh
gh pr merge --auto
```

**Expected**: Merge is blocked; the interface states which required check (`lint`) is not passing. Fix the violation, push, wait for all four checks to pass, then confirm the same PR is now mergeable.

## 4. Push directly to `main` runs the same checks (User Story 2, Acceptance Scenario 3 / FR-002)

After merging a change, confirm on the repository's Actions tab that the push-triggered run for the new `main` commit executed all four jobs, not just the pull request run.

## 5. A superseded run does not block the current status (Edge Case / FR-011)

Push a commit to an open PR's branch, then immediately push a second commit before the first run finishes.

**Expected**: The first run is cancelled (visible in the Actions tab); the PR's checks list reflects only the second, latest run — no stale pending/failed state from the cancelled run.

## 6. Cold run vs. warm run speed and cache visibility (User Story 3, Acceptance Scenarios 1–2 / SC-001, SC-002, SC-006)

Run the pipeline twice: once against a change that invalidates the dependency lockfile or `.turbo` cache (cold), and once with only a trivial change to a single package immediately after (warm).

**Expected**: The cold run completes within 15 minutes (SC-002); the warm run completes within 5 minutes (SC-001) and its job logs show Turborepo reporting cache hits (`>>> FULL TURBO` or equivalent per-task `cache hit` output) for every package the trivial change did not touch, with only the touched package's tasks actually re-executing — visibly faster than the cold run (SC-006).

## 7. Zero tests present still passes (Edge Case / FR-005)

With no test files anywhere in the workspace (the current state), confirm the `test` check passes on an ordinary PR — not skipped, not failing, a genuine pass from the stub `apps/api` `test` script (research.md decision 3).

## 8. Fork pull request runs safely with restricted permissions (FR-012)

Open a pull request from a fork of the repository (or inspect the workflow run's "Permissions" panel on an existing fork PR, if one exists).

**Expected**: All four checks run normally; the run's token permissions show read-only `contents` access, confirming no elevated access was granted to fork-submitted code.
