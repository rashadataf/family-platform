# Feature Specification: GitHub Actions CI Pipeline

**Feature Branch**: `002-ci-pipeline`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "GitHub Actions CI pipeline for the family life management platform monorepo, built on the workspace scaffolding from spec 001. Deliverable: every pull request automatically runs install, typecheck, lint, unit tests, and build, and blocks merge on failure, per the constitution's CI gate requirement. Scope: Workflow triggers: pull_request and push to main; Steps: install (with caching), typecheck, lint, unit tests, build; Branch protection requiring these checks to pass before merge; Clear, fast feedback — failing step should be obvious from the PR checks UI; Turborepo/Nx task caching in CI if applicable per ADR-00X, to avoid re-running unaffected packages. Out of scope: integration tests, contract tests, E2E, security scanning, deployment. Those are separate specs once there's application code and infrastructure to test against."

## Clarifications

### Session 2026-09-08

- Q: Should the CI workflow run pull requests from forked repositories using GitHub's standard `pull_request` trigger with a read-only default token, or does it need broader repository access while checking out fork code? → A: Standard `pull_request` trigger, with explicit minimal (read-only) `GITHUB_TOKEN` permissions — the repository is public and this pipeline needs no secrets, so fork-submitted code must never run with elevated access.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic, clearly-attributed pull request feedback (Priority: P1)

A contributor opens or updates a pull request against the main branch. Without doing anything beyond pushing their branch, they see a defined set of verification steps — install, typecheck, lint, unit tests, and build — run automatically, and if any one of them fails, they can tell exactly which one from the pull request's list of checks, without opening logs to find out.

**Why this priority**: This is the entire point of the feature. Automated, clearly-attributed feedback is what replaces "did someone remember to run the checks locally before merging" with a guarantee. Every other capability in this spec supports this journey.

**Independent Test**: Open a pull request containing a change that breaks exactly one gate (for example, a lint violation with no type or build errors). Confirm the pull request's checks list shows that one check as failed while the others show as passed, and that this is visible from the checks list itself, not only from inside a log.

**Acceptance Scenarios**:

1. **Given** a pull request is opened or updated against the main branch, **When** the pipeline runs, **Then** install, typecheck, lint, unit tests, and build each execute and each reports its own pass or fail status, individually visible in the pull request's checks list.
2. **Given** a pull request contains a change that fails exactly one gate, **When** the pipeline runs, **Then** only that gate's check shows as failed while the others show as passed.
3. **Given** a pull request contains changes that do not affect a particular package in the workspace, **When** the pipeline runs, **Then** that package's tasks are skipped or restored from a prior result rather than re-executed from scratch, and the run completes faster than a full cold run.

---

### User Story 2 - Merge is blocked until required checks pass (Priority: P2)

A maintainer relies on the main branch being protected: a pull request cannot be merged while any required check (install, typecheck, lint, unit tests, build) is failing or still in progress.

**Why this priority**: Checks that run and report status but do not actually prevent a bad merge are advisory only. The constitution's CI gate requirement is specifically about blocking merge, not just producing a visible result, which is why this is P2 rather than folded into P1: the checks from User Story 1 must exist before there is anything to gate on.

**Independent Test**: Open a pull request with a deliberately failing check, and confirm the merge control is blocked and identifies which required check has not passed. Separately, confirm a pull request where every required check has passed is permitted to merge.

**Acceptance Scenarios**:

1. **Given** a pull request with at least one failing required check, **When** a maintainer attempts to merge it, **Then** the merge is blocked and the interface states which required check is not passing.
2. **Given** a pull request where every required check has passed, **When** a maintainer attempts to merge it, **Then** the merge is permitted.
3. **Given** a commit is pushed directly to the main branch, **When** the pipeline runs, **Then** the same verification steps execute against that commit, surfacing any regression even though no merge was being gated.

---

### User Story 3 - Fast feedback through avoiding redundant work (Priority: P3)

A contributor whose change only touches one package in the workspace expects the pipeline to avoid re-installing dependencies from scratch and to avoid re-running verification for packages the change did not touch, so their feedback arrives quickly.

**Why this priority**: This does not change what is correct or blocked, which is why it ranks below User Stories 1 and 2, but a pipeline slow enough to be routinely ignored or worked around undermines the entire gate. Speed is what keeps the gate actually used.

**Independent Test**: Run the pipeline twice, with only a trivial change to a single package between the two runs. Confirm the second run's output shows unaffected packages' tasks restored from a prior result rather than re-executed, and that total run time is measurably shorter than the first, cold run.

**Acceptance Scenarios**:

1. **Given** a prior successful run has left reusable results in place, **When** a new run starts with an unchanged dependency manifest, **Then** dependency installation reuses those results rather than downloading every dependency again.
2. **Given** a change touches only one package in the workspace, **When** the pipeline's typecheck, lint, and build tasks run, **Then** tasks for every unaffected package are restored from a prior result rather than re-executed, and this is visible in the pipeline's output.

---

### Edge Cases

- What happens when a pull request touches a workspace that currently has zero test files (the state of this repository today)? The unit test step MUST NOT fail solely because no tests exist; it MUST fail only when an existing test actually fails.
- What happens when there are no reusable prior results at all (the very first run, or a run after something invalidates them, such as a dependency lockfile change)? The pipeline MUST still complete and produce a definitive pass or fail result — reuse is a speed optimization, never a correctness requirement.
- What happens when two or more required checks fail at the same time? Each MUST be individually visible as failing, not just the first one encountered.
- What happens when a new commit is pushed to a pull request while a previous run for that same pull request is still in progress? The outcome of the superseded run MUST NOT continue to block or misrepresent the pull request's current, up-to-date status.
- What happens when a required check has not finished running yet and a maintainer attempts to merge? This MUST be treated the same as a failing check: merge is blocked until a definitive result is available.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically run a defined set of verification steps — install, typecheck, lint, unit tests, and build — whenever a pull request is opened against, or updated on, the main branch.
- **FR-002**: The system MUST run the same verification steps whenever a commit is pushed directly to the main branch.
- **FR-003**: Each verification step MUST report its own individually visible pass or fail status on the pull request, distinguishable from every other step without opening a combined log.
- **FR-004**: The main branch MUST be protected such that a pull request cannot be merged while any required verification step is failing or has not yet completed.
- **FR-005**: The unit test step MUST NOT fail solely because no test files currently exist in the workspace; it MUST fail when an existing test fails.
- **FR-006**: The system MUST reuse a prior dependency installation result when the dependency lockfile has not changed, rather than performing a full network install on every run.
- **FR-007**: The system MUST reuse a prior task result, per package and per task, for any package unaffected by a given change, rather than re-executing typecheck, lint, and build for every package on every run.
- **FR-008**: The pipeline MUST complete and produce a correct result even when no prior reusable results exist (a cold run) — reuse MUST be a performance optimization only, never a condition for correctness.
- **FR-009**: A contributor MUST be able to identify which specific verification step failed directly from the pull request's list of checks, without needing to search through a single combined log to find the responsible step.
- **FR-010**: The verification steps MUST run the same install, typecheck, lint, test, and build commands already established for local development, so that a passing local run and a passing pipeline run are checking the same thing.
- **FR-011**: A pull request's required-check status MUST reflect only its most recently triggered run; a run superseded by a newer commit on the same pull request MUST NOT continue to block or misrepresent the pull request's current status.
- **FR-012**: The pipeline MUST run pull requests from forked repositories using the standard, safe-by-default trigger (not the variant that grants fork-submitted code access to repository secrets or write permissions), and MUST scope its default repository token to the minimum, read-only access the verification steps need.

### Key Entities

- **Pipeline Run**: One execution of the verification steps against a specific commit, holding a pass/fail result per step and an indication of whether each step's result was freshly computed or reused from a prior run.
- **Required Check**: A named, individually tracked status (one per verification step) attached to a commit or pull request, which branch protection depends on when deciding whether merge is permitted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When reusable prior results are available, every required check for a pull request reports a definitive result within 5 minutes of the triggering push.
- **SC-002**: Even with no reusable prior results available, every required check still reports a definitive result, with the full set of checks completing within 15 minutes.
- **SC-003**: 100% of pull requests carrying at least one failing required check are blocked from merging.
- **SC-004**: 100% of pull requests where every required check has passed are permitted to merge, with no false-positive blocks caused by the checks themselves.
- **SC-005**: A contributor can identify which specific verification step failed by looking at the pull request's list of checks alone, without opening any log.
- **SC-006**: Re-running the pipeline against a change that affects only one package completes noticeably faster than the first, cold run, with unaffected packages' tasks visibly marked as reused rather than re-executed.

## Assumptions

- The workspace currently has no test framework or test files wired up (per the scaffolding delivered in spec 001). The unit test step is wired to run whatever test command the workspace defines and must treat "zero tests found" as a pass, not a failure; adding actual test coverage is separate work, out of scope here.
- "Caching" in this feature means reusing results within the CI provider's own storage (for example, keyed on the dependency lockfile and on a task's inputs), not standing up a separate remote-caching service. Provisioning a dedicated remote cache backend is infrastructure work and is out of scope for this feature.
- The main branch is the repository's protected branch, matching how the repository is already configured.
- Each required verification step is surfaced as its own individually named, individually trackable check, rather than being bundled into a single opaque status, because that is what "obvious from the checks UI" requires.
- Branch protection is configured appropriately for the project's current single-maintainer stage. Requirements around required reviewer counts or approval rules are not specified by this feature and are left at the repository owner's discretion.
- No deployment credentials or secrets are required by this pipeline, since deployment is explicitly out of scope.
- The verification steps reuse the install, typecheck, lint, test, and build commands already established for local development (spec 001), rather than defining a separate, parallel set of commands.

## Data Handling and Compliance

This feature introduces no product or personal data, so it is assessed against the project's mandatory data-handling questions on that basis:

1. **Personal data stored and its purpose**: None. This feature only reads and reports on repository source code and its own run metadata (timestamps, pass/fail status per step). No family, member, or user data is introduced or touched.
2. **Effect of a family member's account deletion**: Not applicable; no member or account data exists at this layer.
3. **Effect of a whole family's erasure**: Not applicable; no family data exists at this layer.
4. **Appearance in a user's data export**: Not applicable; nothing produced by this feature is user-facing or user-owned data.
5. **Retention period**: Not applicable to product data. Pipeline run history and logs are retained according to the CI provider's own default retention, which this feature does not change.

Any future feature that adds real product schema is unaffected by this one; this feature's "not applicable" answers do not carry forward to product features.
