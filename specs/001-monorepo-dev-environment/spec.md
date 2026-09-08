# Feature Specification: Monorepo Scaffolding & Local Development Environment

**Feature Branch**: `001-monorepo-scaffolding`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Monorepo scaffolding and local development environment for a UK family life management platform, per ADR-00X (monorepo tooling) and ADR-00Y (database/ORM). Deliverable: a new developer can clone the repo, run one command, and have a working local environment — API, database, and migrations running. Scope: Workspace structure per ARCHITECTURE.md (apps/, packages/); Shared TypeScript, ESLint, Prettier config packages; Local Postgres via Docker; Database migration tooling wired up (per ADR-00Y) with a working baseline migration; A single command (pnpm dev or equivalent) that starts everything locally; Environment variable handling for local dev (.env.example committed, real .env gitignored). Out of scope: CI, cloud infrastructure, authentication, any product domain logic."

## Clarifications

### Session 2026-09-08

- Q: Should this feature scaffold a stub `apps/worker` application now, alongside `apps/api`, even though it will do nothing yet? → A: No — only `apps/api` is scaffolded now; `apps/worker` is deferred to a later feature, once there is an event system for it to consume from.
- Q: Should local environment configuration live in a single root-level `.env`/`.env.example` shared by the whole workspace, or in per-application env files? → A: A single root-level `.env`/`.env.example`, shared by the whole workspace.
- Q: Should the API automatically restart when a developer edits its source code while the dev command is running? → A: Yes — the API auto-restarts on source-file changes while the dev command is running.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fresh clone to running environment (Priority: P1)

A developer joining the project clones the repository for the first time. Without asking anyone for undocumented steps, they install the declared prerequisites, run a single documented command, and end up with the API application running locally, connected to a local database whose schema is already up to date.

**Why this priority**: This is the entire point of the feature. Every other capability in this spec exists to make this one journey true. Without it, every future feature adds friction that compounds across the life of the project, which for now is a team of one.

**Independent Test**: On a machine that only has the declared prerequisites installed, clone the repository, follow only the committed setup documentation, and confirm the API responds to a request and the database contains the expected baseline schema. No undocumented step, no help from another person, and no manual database command should be required.

**Acceptance Scenarios**:

1. **Given** a freshly cloned repository and no prior local setup, **When** the developer installs dependencies and runs the single startup command, **Then** the API application starts, a local database becomes available, and the database schema reflects every committed migration.
2. **Given** the repository has been cloned but no `.env` file has been created, **When** the developer follows the setup documentation, **Then** the documentation tells them to copy the committed environment template into a real, git-ignored file before anything will start.
3. **Given** the developer has not installed a required local prerequisite (for example, a container runtime), **When** they run the startup command, **Then** they receive a clear, specific error identifying the missing prerequisite rather than a silent hang or an unrelated failure.

---

### User Story 2 - Repeatable, resettable local iteration (Priority: P2)

A developer who already has a working local environment stops and restarts it repeatedly over the course of a normal working day, and occasionally wants to throw away local data and start from a clean database without reinstalling anything.

**Why this priority**: A one-time setup that cannot be safely repeated turns into a support burden the first time a developer's local state drifts, which happens routinely during schema changes. This makes the environment trustworthy enough to use daily rather than something to route around.

**Independent Test**: With an already-provisioned local environment, stop it, start it again with the same single command, and confirm no previously created local data is lost and no error occurs. Separately, trigger the reset path and confirm the database returns to a clean, migrated-from-nothing state.

**Acceptance Scenarios**:

1. **Given** a local environment that was previously started and then stopped, **When** the developer runs the single startup command again, **Then** the environment starts successfully and previously created local data is still present.
2. **Given** a local environment with data the developer no longer wants, **When** the developer runs the documented reset action, **Then** the local database is recreated from nothing and every committed migration is reapplied successfully.
3. **Given** a new migration file has been added since the environment was last started, **When** the developer runs the single startup command, **Then** the new migration is applied automatically before the API becomes available, with no separate manual migration command.
4. **Given** the environment is running under the single startup command, **When** the developer edits and saves the API's source code, **Then** the API restarts automatically and serves the updated code, without the developer stopping or re-running the startup command.

---

### User Story 3 - Consistent tooling for every workspace member (Priority: P3)

A developer adds a new application or package to the workspace (or edits an existing one) and expects type-checking, linting and formatting to behave identically to every other package, without writing that configuration from scratch each time.

**Why this priority**: This does not block getting an environment running, which is why it is P3, but its absence means every subsequently added package either duplicates configuration or silently diverges from project conventions, which is a cost that compounds with every package added after this one.

**Independent Test**: Add a new, minimal package to the workspace that intentionally contains one type error, one lint violation and one formatting inconsistency, using only the shared configuration packages, and confirm each of the three problems is reported through the normal workspace-wide commands without any package-local configuration beyond referencing the shared config.

**Acceptance Scenarios**:

1. **Given** a new package added under the workspace's package directory, **When** it extends the shared TypeScript, ESLint and Prettier configuration, **Then** running the workspace's standard type-check, lint and format commands cover that package with no additional per-package rule-writing.
2. **Given** two existing applications or packages, **When** their shared configuration is inspected, **Then** both resolve to the same base rules from the same shared configuration packages rather than maintaining independent copies.

---

### Edge Cases

- What happens when the local database port (or another port the environment needs) is already occupied by an unrelated process on the developer's machine? The failure must name the conflicting port rather than failing opaquely.
- What happens when the committed `.env.example` file and the code that reads environment variables fall out of sync (a variable is read by the code but missing from the template)? This drift should be detectable rather than discovered only when someone's local start fails.
- What happens when a developer's real `.env` file is missing a value the API needs to start? The API must refuse to start and identify the specific missing or invalid value, rather than starting and failing on the first request that needs it.
- What happens if the startup command is run while the local database container from a previous run is in a stopped or partially-initialized state? The command must recover into a working state, or fail with a clear, actionable message, rather than leaving the developer to diagnose Docker state by hand.
- What happens when a migration fails partway through being applied? The developer must be able to tell that it failed and why, and the environment must not silently present itself as ready with a partially migrated schema.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST be organized as a single workspace with a top-level directory for deployable applications and a top-level directory for shared, installable packages, matching the structure recorded in the architecture documentation. Within the applications directory, only the API application is scaffolded by this feature; the asynchronous worker application is deferred to a later feature.
- **FR-002**: The system MUST provide one documented command that, run after cloning and installing dependencies, starts every local service a developer needs for day-to-day work: the API application and the local database, with the database schema brought up to date automatically as part of that command. While running under this command, the API MUST automatically restart when its source code changes, without the developer re-running the command.
- **FR-003**: The local database MUST run in an isolated, disposable local container so that no developer needs to install or manage a database engine directly on their own machine.
- **FR-004**: The system MUST provide database migration tooling capable of building the schema from nothing and applying schema changes in a defined, reviewable order.
- **FR-005**: At least one baseline migration MUST exist and MUST apply successfully against a freshly created database, demonstrating that the migration mechanism works end-to-end. This baseline is a proof that the mechanism functions; it MUST NOT encode product domain schema, which is explicitly out of scope for this feature.
- **FR-006**: The repository MUST include a single, root-level committed template file listing every environment variable required for local development across the workspace, with safe placeholder or example values, so a developer can create a working local configuration by copying it.
- **FR-007**: The repository's ignore rules MUST prevent a developer's real local environment file at the workspace root, and any file containing real secret values, from being committed.
- **FR-008**: The API application MUST validate its required configuration at startup and MUST refuse to start when a required value is missing or malformed, reporting which value is the problem, rather than starting and failing later on first use.
- **FR-009**: The workspace MUST provide shared, centrally maintained configuration packages for TypeScript compilation, linting, and code formatting, and every application and package in the workspace MUST consume them rather than defining independent equivalents.
- **FR-010**: A developer MUST be able to stop and restart the local environment via the same single command without losing previously created local data.
- **FR-011**: A developer MUST be able to explicitly reset the local database to a clean, freshly migrated state on demand, distinct from the normal start/stop flow.
- **FR-012**: The repository MUST include committed setup documentation describing local prerequisites and the exact steps from a fresh clone to a running environment, sufficient for the journey in User Story 1 to require no undocumented step.

### Key Entities

- **Local Environment Configuration**: The set of environment variables an instance of the API needs to start (for example, database connection details and application-level settings). Represented in the repository by a single, root-level committed example template and, locally and never committed, a single root-level real values file. Holds no product or personal data.
- **Migration History**: The ordered record of schema changes that have been applied to a given database instance, used to determine which migrations still need to run. Holds structural metadata only (migration identifiers and timestamps), never product or personal data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer who has never set up the project before, and who has only the documented prerequisites installed, reaches a running API and database from a fresh clone in under 10 minutes using only committed documentation, with no undocumented step and no help from another person.
- **SC-002**: Running the single startup command on an already-provisioned local environment succeeds without any loss of previously created local data, verified across repeated stop/start cycles.
- **SC-003**: Starting the environment with a required environment variable missing or malformed fails within seconds and names the specific variable at fault, every time it is tested.
- **SC-004**: A newly added migration file is applied automatically the next time the environment is started, with zero manual database commands required.
- **SC-005**: No real secret or credential value ever appears in the repository's version-controlled history; only the example template is committed.
- **SC-006**: A new package added to the workspace inherits working type-checking, linting and formatting from the shared configuration packages with no package-local rule configuration beyond a reference to the shared config.
- **SC-007**: An edit to the API's source code while the environment is running is reflected in the running API without the developer stopping or re-running the startup command.

## Assumptions

- The developer's machine can run a container runtime capable of running Docker images; installing that runtime itself is a prerequisite documented by this feature, not something this feature automates.
- "One command" means one command from the developer's perspective (for example, a single package-manager script); it may orchestrate multiple underlying processes (API process, database container, migration run) behind that single entry point.
- The baseline migration exists to prove the migration mechanism works, not to model any part of the product domain (families, members, calendars, tasks, documents, etc.); a schema-per-context data model is a separate, later feature.
- No authentication, authorization, or user-facing product functionality is introduced by this feature; the API application started by the single command may expose no more than a minimal health or readiness signal.
- This feature covers only local developer machines. Continuous integration environments and any cloud or hosted environment are explicitly out of scope and are expected to be addressed by later, separate features.
- Exact tool versions (container runtime, database version, package manager version) follow what is already fixed by the project's accepted architecture decisions; where a decision leaves room, the choice is deferred to the implementation plan rather than fixed here.
- The asynchronous worker application described in the architecture documentation is not scaffolded by this feature. It has no work to do until an event system exists, and adding it now would be structure without purpose.

## Data Handling and Compliance

This feature introduces no product or personal data, so it is assessed against the project's mandatory data-handling questions on that basis:

1. **Personal data stored and its purpose**: None. This feature's only persisted artifacts are structural: a migration-history record and, transiently, whatever a future baseline migration creates for its own proof-of-function purpose. No family, member, or user data is introduced.
2. **Effect of a family member's account deletion**: Not applicable; no member or account data exists at this layer.
3. **Effect of a whole family's erasure**: Not applicable; no family data exists at this layer.
4. **Appearance in a user's data export**: Not applicable; nothing produced by this feature is user-facing or user-owned data.
5. **Retention period**: Not applicable to product data. Local environment configuration and container state are developer-machine-local and are retained only for as long as a developer keeps them.

Any future feature that adds real product schema on top of this scaffolding must answer these five questions again on its own terms; this feature's "not applicable" answers do not carry forward to it.
