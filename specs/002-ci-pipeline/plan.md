# Implementation Plan: GitHub Actions CI Pipeline

**Branch**: `002-ci-pipeline` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-ci-pipeline/spec.md`

## Summary

Every pull request against `main`, and every push to `main`, must automatically run typecheck, lint, unit tests, and build, with each reporting its own individually visible pass/fail status, and merge must be blocked while any of them is failing or incomplete. The technical approach: a single GitHub Actions workflow (`.github/workflows/ci.yml`) defining four independent jobs — `typecheck`, `lint`, `test`, `build` — each installing dependencies itself (cache-hit, via `actions/setup-node`'s pnpm cache) and running its own `turbo run <task>`, restoring/saving its own per-job-keyed Turborepo cache via `actions/cache`. The `pull_request` trigger (not `pull_request_target`) with an explicit read-only `permissions` block keeps fork-submitted pull requests safe now that the repository is public. A `concurrency` group cancels superseded runs. Branch protection on `main` requires all four job names to pass before merge; applying that live repository setting is a separate, explicitly-confirmed action at implementation time, not decided here. Since no test framework exists yet anywhere in the workspace, this feature adds the minimal plumbing (a `test` task in `turbo.json`, a guaranteed-passing stub script in `apps/api`) needed for the `test` check to exist and pass — choosing and adopting a real test framework is out of scope, per the spec's own Assumptions.

## Technical Context

**Language/Version**: The CI pipeline itself is YAML (GitHub Actions workflow syntax); it verifies the TypeScript 5.x / Node 24.x workspace scaffolded by spec 001.

**Primary Dependencies**: `actions/checkout@v4`, `actions/setup-node@v4` (pnpm cache support, `node-version-file: .nvmrc`), `pnpm/action-setup@v4` (version resolved from the root `packageManager` field), `actions/cache@v4` (per-job `.turbo` cache); Turborepo `^2.5.8` (already present) for `typecheck`/`lint`/`test`/`build` task execution and caching, per ADR-001.

**Storage**: N/A — this feature reads and reports on repository source code and CI run metadata only (see spec.md, Data Handling and Compliance).

**Testing**: None added by this feature beyond the minimal stub described above. A real test framework and test suite are explicitly out of scope, per spec.md's Assumptions.

**Target Platform**: GitHub-hosted Actions runners (`ubuntu-latest`).

**Project Type**: CI/CD workflow configuration for an existing pnpm + Turborepo monorepo (spec 001). No application code changes.

**Performance Goals**: SC-001 — warm run (reusable cache available) reports a definitive result within 5 minutes. SC-002 — cold run (no reusable cache) still completes within 15 minutes.

**Constraints**: No integration tests, contract tests, E2E tests, security scanning, or deployment (all explicitly out of scope per spec.md); no remote/hosted Turborepo cache service (Assumptions); no changes to required-reviewer counts or approval rules (left at the repository owner's discretion, per Assumptions).

**Scale/Scope**: Single workflow file, four jobs, one repository, one protected branch (`main`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / Gate | Compliance approach |
|---|---|
| Development Workflow and Quality Gates — merge-gate table | This feature implements 4 of the constitution's eventual 9 merge gates: Typecheck, Lint, Unit tests, Build. The remaining 5 (boundary/cycle validation, integration tests, contract/API tests, security scan, infrastructure validation) are explicitly out of scope for this feature, per spec.md's own scope statement, and are legitimately deferred: integration/contract/E2E tests need application code and infrastructure this repository doesn't have yet; boundary/cycle validation needs tooling (dependency-cruiser, eslint-plugin-boundaries) that spec 001 did not stand up and no bounded contexts exist yet to enforce boundaries between; security scanning has an open `TODO(SECURITY_SCAN_TOOLING)` in the constitution itself, explicitly deferred to when the CI pipeline is specified — i.e., a future increment of this same area, not a violation of this one. This mirrors the same incremental-adoption pattern spec 001 used for `apps/worker`. |
| I. Type Safety Is a Contract | The `typecheck` job is exactly the CI-side enforcement this principle names ("Enforced by: CI typecheck"). No relaxation introduced. |
| VI. Children and Family Data Are Sensitive by Default | Not applicable — no personal or family data exists in this repository yet, and this feature introduces none (spec.md, Data Handling and Compliance). |
| X. Infrastructure Is Code | GitHub Actions workflow files are code, committed and reviewed like any other change — consistent with this principle's spirit. Branch protection itself is a repository *setting*, not infrastructure of the kind ADR-004 (Pulumi) is scoped to own (ADR-004 covers cloud infrastructure); it is applied via a documented, explicitly-confirmed `gh api` command rather than left as an undocumented manual click, which is the closest equivalent this feature's scope allows to "infrastructure is code." |
| Cost is a design constraint | GitHub-hosted runners on the free tier for a public repository; no new paid service introduced (remote cache explicitly rejected in research.md decision 2). |

No unjustified violations. One intentional complexity trade-off (splitting verification into four separate jobs rather than one simpler sequential job) is recorded in Complexity Tracking below, required by FR-003/FR-009's own literal wording rather than chosen for its own sake.

*Post-Phase-1 re-check: unchanged. Phase 1 design (data model, contracts, quickstart) introduced nothing that touches a constitution principle differently than assessed above — the two "entities" in data-model.md are GitHub-owned operational metadata, not anything this repository persists.*

## Project Structure

### Documentation (this feature)

```text
specs/002-ci-pipeline/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── required-checks.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
family-platform/
├── .github/
│   └── workflows/
│       └── ci.yml                 # the 4-job workflow: typecheck, lint, test, build
├── turbo.json                     # add a `test` task alongside existing build/typecheck/lint/db:generate
├── package.json                   # add root `test` script (`turbo test`)
└── apps/
    └── api/
        └── package.json           # add minimal, guaranteed-passing `test` script (stub, no framework)
```

**Structure Decision**: A single new workflow file plus the minimal plumbing needed for a `test` step to exist (turbo task + one stub script). No new packages, no new applications, no changes to `apps/api`'s source or `packages/persistence`. This is deliberately the smallest change set that satisfies every FR in spec.md — nothing here anticipates or scaffolds for the later specs that will add integration tests, contract tests, or security scanning.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Four separate GitHub Actions jobs instead of one job with five sequential steps | FR-003/FR-009 require each verification step's pass/fail status to be individually visible on the pull request "without opening a combined log," and SC-005 requires identifying the failing step "from the pull request's list of checks alone" — GitHub's checks list renders one row per job, not per step | A single job is simpler to write and avoids the redundant per-job `install`/upstream-build cost noted in research.md decision 1, but a contributor would have to open the job's log to find which of five steps failed, which directly fails FR-003/FR-009/SC-005 |
