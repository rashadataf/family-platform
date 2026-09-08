# Phase 1 Data Model: GitHub Actions CI Pipeline

This feature introduces no product or personal data (see spec.md's "Data Handling and Compliance" section). The two Key Entities from spec.md are structural/operational metadata owned entirely by the CI provider (GitHub Actions), not by this repository's own database — they are documented here for traceability between the spec's requirements and the design in `research.md` / `contracts/required-checks.md`, not as anything this feature persists itself.

## Pipeline Run

One execution of the workflow, triggered by a single event (a pull request opened/updated, or a push to `main`).

| Field | Meaning | Source of truth |
|---|---|---|
| Commit SHA | The exact commit this run verifies | GitHub Actions (`github.sha`) |
| Trigger type | `pull_request` or `push` | GitHub Actions (`github.event_name`) |
| Per-job conclusion | Pass/fail/cancelled, one per job (`typecheck`, `lint`, `test`, `build`) | GitHub Actions Checks API |
| Per-job cache state | Whether that job's Turborepo cache was a hit or miss for each task it ran | Turborepo's own run summary output (surfaced in job logs, not persisted elsewhere) |

Superseded runs (FR-011) are handled structurally, not by any field on this entity: the `concurrency` group (research.md decision 4) cancels the previous run for the same ref outright rather than leaving two runs whose results must be reconciled.

## Required Check

A named, individually tracked status attached to a commit or pull request, which branch protection depends on when deciding whether merge is permitted.

| Field | Meaning | Source of truth |
|---|---|---|
| Name | One of `typecheck`, `lint`, `test`, `build` — stable job names, the exact contract in `contracts/required-checks.md` | This feature's workflow definition |
| Associated run | The Pipeline Run (by commit SHA) it belongs to | GitHub Actions |
| Conclusion | Success, failure, or pending/in-progress | GitHub Actions Checks API |

Branch protection (FR-004) references these four names directly; a Required Check that is pending or failing blocks merge, per spec.md's Edge Cases ("a required check has not finished running yet... MUST be treated the same as a failing check").

## No local persistence

Neither entity is stored in this repository's own database (`packages/persistence`) or anywhere else under this feature's control. Both are entirely owned and retained by GitHub Actions per its own default retention policy, which this feature does not change (spec.md, Data Handling and Compliance, item 5).
