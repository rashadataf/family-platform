# Feature Specification: Merge Gate Enforcement

**Feature Branch**: `005-merge-gate-enforcement`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Close the three blocking merge gates the constitution's 'Development Workflow and Quality Gates' table requires but CI does not yet implement, so that every gate in that table is real rather than aspirational. (1) Boundary and cycle validation: dependency-cruiser validating the allowed-edge graph and detecting circular dependencies, plus eslint-plugin-boundaries import zones, per Constitution Principle III and ARCHITECTURE.md section 8.2 — established now, while the package graph is still small, rather than retrofitted once packages/core and its bounded contexts exist. (2) Security scan covering dependency vulnerabilities and secret scanning, closing the constitution's own open TODO(SECURITY_SCAN_TOOLING), plus automated dependency updates and pinning of GitHub Actions to immutable references so the pinning does not rot. (3) Integration tests running against a real PostgreSQL database, with a harness wired into the existing test gate, so the first repository implementation ships with a test rather than having one retrofitted. Constraints: no paid or subscription service of any kind; every check must run in the existing GitHub Actions pipeline; existing CI job names must not be renamed because branch protection on main names required checks by job name; the containerized development environment from spec 004 and the host-based flow from spec 001 must both keep working unchanged. Out of scope: any product domain code, any bounded context, authentication, API contracts, the VPS staging deployment (spec 003), and the AWS topology."

## Why now

The constitution's merge-gate table lists nine blocking gates. After specs 002 and 004 there are seven checks and six of those rows are covered. Three rows have no check at all, and they are the three this feature closes.

The timing is the point. Two of the three get materially more expensive the moment product code exists:

- **Boundary validation** polices `packages/core` and its nine bounded contexts. That package does not exist yet. Writing and proving the rules against today's five-package graph is a small, verifiable job; writing them against nine contexts that already import each other is a migration with an unknown number of violations to argue about.
- **The integration-test harness** should exist *before* the first repository implementation, so that implementation ships with a real-database test. Retrofitting tests onto persistence code is how repositories end up tested against mocks, which the constitution explicitly rejects because row-level security and constraints are the thing being verified.

The third, security scanning, is not time-sensitive in the same way, but it is the constitution's own unresolved `TODO(SECURITY_SCAN_TOOLING)` — carried since ratification and deferred once already by spec 002.

This feature is deliberately the last one whose subject is the repository itself.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An architecture violation fails before review, not during it (Priority: P1)

Someone — a contributor or an AI agent — writes an import that crosses a boundary the architecture forbids, or introduces a dependency cycle. They find out from a failed check within minutes, with the rule and the offending import named, rather than from a reviewer who may or may not spot it.

**Why this priority**: [ADR-002](../../adr/ADR-002-modular-monolith.md) makes a specific claim — that bounded contexts stay extractable later. That claim is only true while the boundary rules hold, and a modular monolith degrades one convenient import at a time, each of which looks harmless on its own. The constitution ranks code review as the weakest of four enforcement layers and states plainly that it is "assumed to fail". Today it is the *only* layer operating.

**Independent Test**: Add an import that violates a declared rule, push, and confirm the check fails naming both the rule and the specific import. Remove it and confirm the check passes.

**Acceptance Scenarios**:

1. **Given** a repository whose imports all conform, **When** the validation runs, **Then** it passes and reports which rules were evaluated.
2. **Given** an import that crosses a forbidden boundary, **When** the validation runs, **Then** it fails, names the rule that was violated, and names the exact file and import that violated it.
3. **Given** a circular dependency spanning several files across more than one package, **When** the validation runs, **Then** it fails and prints the full cycle, not just one edge of it.
4. **Given** a contributor working locally, **When** they write a forbidden import in their editor, **Then** they are told immediately by the editor's own feedback, without waiting for a push.
5. **Given** a new package added to the workspace with no rule written for it, **When** the validation runs, **Then** it **fails** rather than passing silently. A boundary system that ignores what it has not been told about provides no guarantee at all.

---

### User Story 2 - A committed secret or a vulnerable dependency cannot reach main (Priority: P1)

A credential pasted into a file, or a dependency with a known high-severity vulnerability, is caught by an automated check and blocks the merge.

**Why this priority**: Equal to US1 because the failure is immediate and external rather than gradual and internal. A committed secret is an incident from the moment it is pushed, and the repository is one that will hold credentials for a VPS, a database and eventually a payment provider. The constitution has required this gate since ratification and has never had it.

**Independent Test**: On a throwaway branch, add a realistic-looking credential to a file and confirm the check fails. Separately, add a dependency with a known high-severity advisory and confirm the check fails. Confirm neither can be merged.

**Acceptance Scenarios**:

1. **Given** a change that introduces a credential-shaped string, **When** the checks run, **Then** the security check fails and the merge is blocked.
2. **Given** a check that has detected a secret, **When** its output is read, **Then** it identifies the file and location **without reproducing the secret value** in logs that are more widely readable than the repository itself.
3. **Given** a dependency with a known high or critical severity advisory, **When** the checks run, **Then** the security check fails and names the package, the advisory and the fixed version if one exists.
4. **Given** an advisory with no fix available, **When** the team accepts the risk, **Then** it can be suppressed only with a recorded reason and an expiry date, after which it fails again.
5. **Given** the committed environment template, which contains deliberately fake values, **When** the secret scan runs, **Then** it does not fail. A check that cries wolf on its own repository's fixtures gets disabled within a week.

---

### User Story 3 - The first repository implementation can be tested against a real database (Priority: P2)

A harness exists that gives a test a real PostgreSQL instance with every committed migration applied, so that data-access code is verified against the real engine rather than a mock.

**Why this priority**: Below US1 and US2 because nothing depends on it *today* — there is no repository code yet. That is also exactly why it belongs in this feature: the constitution requires integration tests to run "against a real database, not a mock, because row-level security and constraints are the thing being verified", and row-level security is unverifiable against a mock by definition. If the harness does not exist when the first repository is written, that repository will be tested some other way, and the pattern will be set.

**Independent Test**: Run the integration suite locally on both development paths and in CI; confirm it connects to a real PostgreSQL, sees the committed schema, and that a deliberately failing assertion actually fails the build.

**Acceptance Scenarios**:

1. **Given** the harness, **When** an integration test runs, **Then** it has a real PostgreSQL with every committed migration applied.
2. **Given** several integration tests, **When** they run in sequence, **Then** each begins from a known clean state and no test can be affected by another's data.
3. **Given** the containerized development path, **When** the integration suite runs, **Then** it works — and it works on the host-based path too, without either path needing different commands.
4. **Given** the unit test suite, **When** it runs, **Then** it does **not** require a database and stays fast. The two tiers must be separately runnable, or the fast one stops being fast.
5. **Given** an integration test that should fail, **When** the pipeline runs, **Then** the build fails. A harness whose failures do not propagate is worse than none.

---

### User Story 4 - Dependency updates arrive on their own, and pins do not rot (Priority: P3)

Dependency and workflow-action updates are proposed automatically on a schedule, and the pipeline's own action references are pinned to immutable versions that the same automation keeps current.

**Why this priority**: Maintenance rather than a gate, so it blocks nothing. It is in this feature because pinning without automation is actively harmful: a pinned reference that nobody updates is a component that silently stops receiving security patches, which is a worse position than not pinning at all. The two must ship together or neither should.

**Independent Test**: Confirm update proposals appear on schedule, confirm every workflow action reference is immutable, and confirm the automation proposes updates to those references too.

**Acceptance Scenarios**:

1. **Given** an outdated dependency, **When** the scheduled run happens, **Then** an update is proposed automatically with its changelog.
2. **Given** the pipeline's workflow definitions, **When** they are inspected, **Then** every third-party action is referenced immutably rather than by a mutable tag.
3. **Given** an immutably-pinned action with a newer release, **When** the scheduled run happens, **Then** an update to that pin is proposed. Otherwise pinning decays into staleness.
4. **Given** many simultaneous updates, **When** proposals are created, **Then** they are grouped so that routine maintenance does not bury real work under a wall of noise.

---

### Edge Cases

- What happens when a boundary rule cannot yet be expressed because the package it governs does not exist? The rule set must still be written and must **fail closed**: an unknown package is a violation, not an exemption.
- What happens when a legitimate change genuinely needs to cross a boundary? There must be a visible, reviewable way to change the rule — and changing it must be an obvious diff in a rules file, never a comment that silences one line.
- What happens when the secret scan finds something already present in existing git history? Blocking every merge until history is rewritten would halt all work over a commit that is already public. New introductions must be blocked; pre-existing findings must be reported as an audit result to be triaged and remediated by rotation, which is the only remedy that actually works once a secret has been pushed.
- What happens when a vulnerability has no fix available? Blocking indefinitely on something nobody can fix trains people to bypass the gate. It must be suppressible with a reason and an expiry, and it must fail again when that expiry passes.
- What happens when the secret scanner flags the committed environment template's deliberately fake values? It must not. False positives on the repository's own fixtures are how a security gate gets switched off.
- What happens when integration tests run inside the containerized development environment, where the database is a separate container? The harness must reach it there and on the host, with the same command.
- What happens when integration tests run in parallel against one database? Either they are isolated so that parallelism is safe, or parallelism is disabled for that tier — but the choice must be deliberate, because "passes alone, fails together" is among the most expensive failure modes a test suite has.
- What happens to total pipeline time as checks are added? The pipeline must stay fast enough that people wait for it rather than merging around it.
- What happens when a new blocking check is added but the branch protection configuration is not updated? The check runs and reports but cannot block anything — the exact gap this repository is in right now for three existing checks.
- What happens if a new blocking check is added to branch protection *before* it has ever reported? Every merge blocks forever on a check that never arrives.

## Requirements *(mandatory)*

### Functional Requirements

**Boundary and cycle validation**

- **FR-001**: The system MUST validate every import in the repository against a declared allowed-dependency graph, and MUST fail when an import is not permitted.
- **FR-002**: The system MUST detect circular dependencies spanning any number of files and packages, and MUST report the complete cycle rather than a single edge.
- **FR-003**: A violation MUST name the rule that was broken, the file containing the offending import, and the target of that import. A failure that says only "boundary violation" cannot be acted on.
- **FR-004**: Boundary rules MUST also be enforced during ordinary editing, so a contributor sees the violation as they write it rather than after pushing.
- **FR-005**: The rule set MUST encode the architecture's stated constraints, including: no context may import another context's internals; the domain layer may not import a framework, data-access library, cloud SDK, HTTP client, clock or source of randomness; the wire-contract package may not import domain or application code; the data-access client may not be referenced outside its own package; and nothing outside the AI subsystem may depend on the AI subsystem.
- **FR-006**: The rule set MUST **fail closed**. A package or directory with no rule covering it MUST be treated as a violation, not as permitted.
- **FR-007**: Changing an architectural boundary MUST require an explicit, reviewable edit to the rule set. Per-line suppression of a boundary rule MUST NOT be available.
- **FR-008**: Rules MUST be expressed so that adding a bounded context later is a change to one declarative rule set, not edits scattered across many packages.

**Security scanning**

- **FR-009**: Every proposed change MUST be scanned for credential-shaped content, and the merge MUST be blocked on detection.
- **FR-010**: Detection output MUST identify location without reproducing the secret value in any log more widely readable than the repository itself.
- **FR-011**: Dependencies MUST be scanned for known vulnerabilities on every proposed change, and high or critical severity findings MUST block the merge.
- **FR-012**: A vulnerability finding MUST name the affected package, the advisory, and the fixed version where one exists.
- **FR-013**: Findings MUST be suppressible only with a recorded reason and an explicit expiry date, after which they fail again. A suppression without an expiry MUST NOT be possible.
- **FR-014**: Scanning MUST NOT fail on the repository's own committed fixtures and templates, whose values are deliberately fake.
- **FR-015**: Pre-existing findings in historical commits MUST be reported as a triageable audit result rather than blocking all merges, while newly introduced findings block.
- **FR-016**: The container image produced by spec 004 MUST be scanned for known vulnerabilities in its operating-system packages, since it is the artifact that will be deployed.

**Integration testing**

- **FR-017**: A harness MUST provide integration tests with a real PostgreSQL instance carrying every committed migration.
- **FR-018**: Each integration test MUST begin from a known clean state, isolated from every other test.
- **FR-019**: The integration suite MUST run in the pipeline as its own blocking gate, distinct from the unit test gate.
- **FR-020**: The integration suite MUST be runnable locally through both the containerized path and the host-based path, using the same documented command.
- **FR-021**: The unit test tier MUST remain runnable without a database and MUST stay fast.
- **FR-022**: At least one real integration test MUST exist and MUST exercise the harness end to end against the committed schema, proving the mechanism before there is domain code to use it.
- **FR-023**: A failing integration test MUST fail the pipeline.

**Dependency maintenance**

- **FR-024**: Dependency updates MUST be proposed automatically on a schedule, with changelog information attached.
- **FR-025**: Every third-party workflow action MUST be referenced immutably rather than by a mutable tag.
- **FR-026**: The update automation MUST also propose updates to those immutable references, so pinning does not decay into staleness.
- **FR-027**: Updates MUST be grouped so routine maintenance does not bury substantive work.

**Cross-cutting**

- **FR-028**: Existing pipeline job names MUST NOT be renamed. Branch protection names required checks by job name, and a rename blocks every subsequent merge on a check that no longer reports.
- **FR-029**: A newly introduced blocking check MUST be added to the required-checks configuration only after it has reported successfully at least once.
- **FR-030**: On completion, every row in the constitution's merge-gate table MUST have a corresponding check that runs on every proposed change.
- **FR-031**: Both development paths established by specs 001 and 004 MUST continue to work unchanged.
- **FR-032**: This feature MUST NOT introduce any paid, subscription, or usage-billed service.

### Key Entities

- **Boundary Rule Set**: The declarative description of which parts of the codebase may depend on which others. The single artifact an architectural change edits, and the thing a reviewer reads to know what is permitted.
- **Gate**: A check that runs on every proposed change and can block a merge. Has a stable name, because the branch protection configuration refers to it by that name.
- **Suppression**: A recorded, time-bound acceptance of a specific finding. Carries a reason and an expiry; cannot be permanent.
- **Integration Test Harness**: The mechanism that gives a test a real, migrated, isolated database. Used identically in CI and on both local development paths.
- **Dependency Update Policy**: The schedule and grouping rules under which updates are proposed, including updates to the pipeline's own pinned action references.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deliberately introduced boundary violation fails the pipeline 100% of the time, and the failure names the rule and the offending import — verified by introducing one, not by inspecting configuration.
- **SC-002**: A new package added with no rule covering it fails validation rather than passing silently.
- **SC-003**: A deliberately introduced credential-shaped string fails the pipeline 100% of the time, and the failure output does not contain the value itself.
- **SC-004**: A dependency carrying a known high-severity advisory fails the pipeline, naming the package and the fix.
- **SC-005**: The security checks produce zero false positives against the repository as it stands, including its committed environment template.
- **SC-006**: Integration tests run against a real database in the pipeline and on both local development paths, using the same command in all three.
- **SC-007**: The unit test tier runs with no database available and completes in under 30 seconds.
- **SC-008**: Total pipeline wall-clock time for a typical change stays under 10 minutes.
- **SC-009**: Every row in the constitution's merge-gate table maps to a named check that runs on every proposed change — the feature's actual purpose, and verifiable by reading the two lists side by side.
- **SC-010**: Every required check named in branch protection corresponds to a check that actually reports, and every blocking check that reports is required. Neither list contains an entry the other does not.
- **SC-011**: Recurring cost introduced by this feature is zero.
- **SC-012**: Zero existing job names change.

## Assumptions

- **Severity threshold**: high and critical advisories block; medium and low are reported without blocking. Blocking on every advisory in a JavaScript dependency tree produces daily noise and trains people to bypass the gate, which costs more than it saves.
- **Secret scanning covers new changes as a gate and existing history as an audit.** Once a secret has been pushed, rewriting history does not un-publish it; rotation is the only real remedy. Blocking all work on an already-public value would be theatre.
- **The integration suite is a separate pipeline job** from the unit suite. The constitution's own gate table lists them as separate rows, and mixing them would make the fast tier as slow as the slow one.
- **The boundary rules are written for the architecture as documented, not only as currently built.** Most rules will govern packages that do not exist yet. They are written now, with the fail-closed requirement (FR-006) ensuring a future package cannot slip past by being unmentioned.
- **`packages/core` and the bounded contexts remain out of scope.** This feature writes the rules that will govern them; it does not create them.
- **The existing scaffolding table is sufficient to prove the integration harness**, exactly as it proved the migration mechanism in spec 001. No product schema is introduced. A later feature adds real repositories and real assertions, not a new harness.
- **All tooling is free for this repository.** Where a hosted service offers a free tier that a private repository can use indefinitely, that qualifies; anything requiring a subscription does not.
- **Existing branch protection currently requires four of the seven checks that run.** Bringing that configuration in line (SC-010) is part of this feature's completion, not a separate task.

## Data Handling and Compliance

This feature introduces no product or personal data. Assessed against the five mandatory questions from Principle XI:

1. **Personal data stored and its purpose**: None. The artifacts are rule sets, scanner configuration, a test harness and pipeline definitions. The integration harness creates and destroys ephemeral databases containing only whatever a test writes, which at this stage is limited to the committed scaffolding table.
2. **Effect of a family member's account deletion**: Not applicable; no member or account data exists.
3. **Effect of a whole family's erasure**: Not applicable; no family data exists.
4. **Appearance in a user's data export**: Not applicable; nothing produced here is user-owned data.
5. **Retention period**: Not applicable to product data. Ephemeral test databases are destroyed at the end of each run.

Two handling requirements arise, and both are security rather than privacy concerns:

- **Scanner output is itself sensitive.** A tool that finds a secret and then prints it into a build log has moved that secret somewhere potentially more accessible than where it started. FR-010 exists for this reason.
- **Findings must not accumulate silently.** FR-013's expiry requirement mirrors the constitution's governance rule that an exception without an expiry must not be granted — the failure mode being a suppression file that grows for a year until nobody knows which entries still matter.

These answers do not carry forward to a later feature introducing real product schema, which must answer all five again on its own terms.
