# Feature Specification: Containerized Development Environment

**Feature Branch**: `004-containerized-development-environment`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Everything Dockerized, so that if I gave it to any teammate, they will be able to start the process immediately without the need to install any support — no Java, no TypeScript toolchain, nothing. It's just Docker. That's it."

**Owning decision**: [ADR-014: The container image is the unit of truth, including on a developer's laptop](../../adr/ADR-014-containerized-development.md). This specification implements ADR-014; it does not re-decide it. Where this document states a shape (two build targets, Debian-slim base, container-owned dependency trees), ADR-014 carries the reasoning and the rejected alternatives.

## Clarifications

### Session 2026-09-08

- Q: Should the containerized path or the existing host-based `pnpm dev` path be the documented default? → A: The containerized path. `docker compose up` is what a newcomer is told to run; the host loop is retained as a documented optimisation for someone who already has the toolchain (ADR-014, Decision 3).
- Q: Does this feature remove the existing `pnpm dev` flow? → A: No. It is kept working and kept documented, explicitly as the second-class path.
- Q: Does "just Docker" extend to the future Expo mobile app? → A: No, and the documentation must say so. Expo requires host-native simulators and platform SDKs (ADR-014, Explicit limit).
- Q: Where does spec 003's Dockerfile requirement (FR-018) now live? → A: Here. Spec 003 becomes a consumer of the image this feature produces, rather than the feature that introduces it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new contributor runs the platform with only Docker installed (Priority: P1)

Someone who has never worked on this project, on a machine with Docker installed and no Node.js, no pnpm, no version manager and no PostgreSQL, clones the repository and gets a working, hot-reloading API talking to a migrated database, using only commands printed in the README.

**Why this priority**: This is the entire feature. Every other story exists to keep this one true over time. It is also the only story that can be tested honestly by exactly one person once — the next person to actually onboard.

**Independent Test**: On a machine (or a fresh VM) with Docker installed and the Node.js/pnpm toolchain deliberately absent, follow only the committed documentation from `git clone` to a successful `/health/ready` response, without consulting anyone.

**Acceptance Scenarios**:

1. **Given** a machine with Docker installed and no Node.js or pnpm anywhere on the PATH, **When** the contributor clones the repository, copies the environment template, and runs the single documented start command, **Then** the API becomes reachable and its readiness endpoint reports success against a fully migrated database.
2. **Given** the environment is running, **When** the contributor edits a source file under the API, **Then** the running API reflects the change without any container being manually rebuilt or restarted.
3. **Given** the contributor has no pnpm installed, **When** they need to run a workspace command such as the test suite or a migration, **Then** the documentation gives them a container-native form of that command that works.
4. **Given** a contributor who has never created the environment file, **When** they run the start command without it, **Then** they are told exactly which file to create and from which template, rather than seeing a failure from a container that could not resolve its configuration.

---

### User Story 2 - The image that ships is the image that was developed against (Priority: P1)

The same Dockerfile produces both the contributor's development container and the artifact deployed to the staging VPS, so that a defect in the deployable surfaces on a developer's machine and in CI rather than during a deploy.

**Why this priority**: Equal priority to Story 1, and the reason this feature is foundational rather than a convenience. ADR-013 already commits to "container images are identical across both stages"; without this story that commitment is an assumption nobody tests until a deploy fails.

**Independent Test**: Build both targets from the same Dockerfile in CI on a pull request, run the production-shaped target against a database, and confirm it serves the same health responses as the development target.

**Acceptance Scenarios**:

1. **Given** a pull request that changes application source or dependencies, **When** the pipeline runs, **Then** the production-shaped image target is built, and the pipeline fails if it cannot be.
2. **Given** the production-shaped image, **When** it is inspected, **Then** it contains no package manager, no development dependencies, no application source, and no build toolchain, and it runs as a non-root user.
3. **Given** the production-shaped image, **When** it is started against a reachable, migrated database, **Then** its readiness endpoint reports success — proving the pruned dependency tree is complete.
4. **Given** the container receives a termination signal, **When** it shuts down, **Then** it stops accepting new connections, completes in-flight work, and releases its database connections before exiting, rather than being killed outright.

---

### User Story 3 - The founder keeps the fast host-based loop (Priority: P2)

The person working in this repository every day continues to use the existing `pnpm dev` flow, which avoids container filesystem overhead, and that flow keeps working as the containerized path evolves.

**Why this priority**: Below the first two because it protects an existing capability rather than adding one — but it is not optional. A daily driver that silently rots is worse than one that was never offered, and the cost of bind-mounted filesystems on macOS is real, not theoretical.

**Independent Test**: On a machine with the full host toolchain, run the existing start command and confirm it behaves exactly as `docs/local-development.md` describes today, with the containerized services it depends on still available.

**Acceptance Scenarios**:

1. **Given** a machine with Node.js and pnpm installed, **When** the founder runs the existing host-based start command, **Then** it behaves as it does today: database up, migrations applied, API running with file-watch reload.
2. **Given** both paths exist, **When** either is used, **Then** it operates against the same database service and the same committed migrations, so switching between them requires no reset.
3. **Given** a contributor reads the setup documentation, **When** they reach the host-based path, **Then** it is clearly presented as an optional optimisation with stated prerequisites, not as the primary route.

---

### Edge Cases

- What happens when a contributor's host machine already has a `node_modules` directory from a previous host-based install? The container must not use it, and must not be corrupted by it — host and container dependency trees are built for different platforms, and a native binary from the wrong one produces failures that read as application bugs.
- What happens when the database container is not yet accepting connections at the moment the API container starts? The API must wait or retry rather than crash-looping, and the start command must not report readiness before the database is genuinely migrated.
- What happens when a migration fails during startup? The environment must fail visibly and must not present a running API against a partially migrated schema — the same guarantee the existing host-based flow already provides.
- What happens when the environment file is missing or holds an invalid value? Startup must fail immediately, naming the specific variable, rather than starting and failing on the first request that needs it.
- What happens when the port the API publishes is already in use on the contributor's machine? The failure must name the port and say how to change it, not surface as an opaque container error.
- What happens when a contributor changes a dependency rather than source code? The environment must pick up the new dependency through a documented command, without requiring them to understand image layer caching.
- What happens when the Node.js version pinned for the host and the version baked into the image drift apart? A check must fail, because this duplication is forced by tooling and will otherwise be discovered as a behavioural difference between the two paths.
- What happens on a machine with a different CPU architecture (Apple Silicon versus an x86 CI runner or VPS)? The development path must work natively on both, and the artifact intended for the VPS must be built for the VPS's architecture.
- What happens when a contributor runs the containerized path and the host-based path at the same time? They must either coexist or fail with a clear conflict message; they must not silently share a port or corrupt each other's state.

## Requirements *(mandatory)*

### Functional Requirements

**Contributor experience**

- **FR-001**: A contributor MUST be able to go from a fresh clone to a running, reachable API on a machine whose only prerequisite is a container runtime — no Node.js, no package manager, no language runtime, and no separately installed database.
- **FR-002**: The system MUST provide a single documented start command that brings up every service the application needs, applies all committed migrations, and does not report the environment as ready until both have succeeded.
- **FR-003**: Editing application source on the host MUST be reflected in the running containerized API without a manual rebuild or restart.
- **FR-004**: The system MUST provide a documented container-native form for running arbitrary workspace commands (tests, linting, migration authoring, code generation), so that a contributor without the host toolchain is never blocked.
- **FR-005**: The repository's primary setup documentation MUST present the containerized path first and list host toolchain components as optional, and MUST state plainly which parts of the project this guarantee does not cover.
- **FR-006**: The system MUST provide a documented command that tears the environment down, and a separate documented command that resets it to a clean state, with the distinction between them stated as explicitly as the existing documentation already states it.

**Image shape**

- **FR-007**: A single build definition per deployable MUST produce both a development target and a production-shaped runtime target, sharing a common base so the two cannot diverge in language runtime or system libraries.
- **FR-008**: The runtime target MUST contain no package manager, no development dependencies, no application source, and no build toolchain, and MUST execute as a non-root user.
- **FR-009**: The runtime target MUST handle process signals correctly: a termination signal MUST result in a graceful shutdown that stops accepting new work, completes in-flight requests, and releases database connections before exit.
- **FR-010**: Container dependency trees and build output MUST be owned by the container and MUST NOT be shared with, or read from, the host filesystem.
- **FR-011**: No secret value MUST be present in the build context, passed as a build argument, or recoverable from image metadata. Configuration MUST be supplied at container start.
- **FR-012**: The build context MUST exclude any local environment file, so a contributor's real credentials cannot be captured into an image layer.
- **FR-013**: Each service MUST declare a health check the container runtime can use to determine readiness, and dependent services MUST wait on it rather than on a fixed delay.
- **FR-014**: The language runtime version MUST have a single authoritative source, and an automated check MUST fail when the image's version and that source disagree.

**Continuous integration**

- **FR-015**: The pipeline MUST build the production-shaped runtime target on every pull request, and MUST fail when it cannot be built.
- **FR-016**: The pipeline MUST start the built runtime image against a database and assert that it reports readiness, so that an incomplete production dependency tree fails a merge rather than a deploy.

**Preserving what exists**

- **FR-017**: The existing host-based development flow MUST continue to work unchanged for a contributor who has the host toolchain installed, and MUST remain documented as an optional optimisation.
- **FR-018**: Both paths MUST operate against the same database service and the same committed migration history, so a contributor can switch between them without resetting state.
- **FR-019**: This feature MUST NOT introduce any paid, subscription, or usage-billed service.

### Key Entities

- **Build Definition**: The per-deployable description of how the application is packaged, exposing a development target and a runtime target from a shared base. The single artifact both this feature and the staging deployment (spec 003) depend on.
- **Service Set**: The collection of containers that together constitute a running environment — the application, its database, and any one-shot startup task such as migration. Shared in shape between local and staging, differing only in configuration.
- **Runtime Configuration**: The values supplied to a container at start. Distinct from build inputs, and the only channel through which a secret may ever reach a container.
- **Onboarding Documentation**: The committed instructions a contributor follows without assistance. Its correctness is a deliverable of this feature, verified by someone who has not onboarded before, not by the author.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with only a container runtime installed, following only committed documentation and asking no questions, reaches a successful readiness response. This is the feature's definition of done and is verified by observation of a real first-time contributor, not by the author's own re-run.
- **SC-002**: The number of tools a backend contributor must install before the start command works is exactly one.
- **SC-003**: A source edit is reflected in the running containerized API within seconds, with no manual rebuild or restart, on every edit.
- **SC-004**: On a warm image cache, the documented start command reaches a ready environment in under five minutes; a cold first run, including the image build, completes in under fifteen.
- **SC-005**: 100% of pull requests build the production-shaped runtime target and verify it reports readiness against a real database, so no image defect can reach a deploy through a green pipeline.
- **SC-006**: The production-shaped image contains zero package managers, zero development dependencies and zero application source files, verified by inspection rather than by assertion.
- **SC-007**: A version drift between the pinned host language runtime and the image's runtime fails a check, every time, rather than surfacing as a behavioural difference between the two development paths.
- **SC-008**: The existing host-based flow continues to satisfy every acceptance scenario spec 001 defined for it, unchanged.
- **SC-009**: Recurring infrastructure cost introduced by this feature is zero.

## Assumptions

- The contributor's machine can run Linux containers. This is true of Docker Desktop on macOS and Windows and of Docker Engine on Linux; no other runtime is assumed, though a compatible one is not excluded.
- The existing environment-file mechanism from spec 001 remains the configuration channel. This feature changes where values are consumed, not how they are declared.
- Bind-mounted source is acceptable for the development path at current repository size. If measured performance makes it unacceptable, ADR-014 names the replacement (a watch-and-sync mechanism) without reopening the decision.
- Only `apps/api` is containerized by this feature, because it is the only deployable that exists. `apps/worker` will follow the same shape when ADR-002's second deployable is built. `apps/mobile` is explicitly out of scope and cannot be brought into it.
- Spec 003's FR-018 is satisfied by this feature rather than by spec 003 itself. Spec 003 should be amended to consume the image defined here; that amendment is a change to spec 003, tracked there, not a deliverable of this one.
- No container registry is assumed by this feature. Whether one is introduced is a separate decision, currently owned by spec 003's clarification record and flagged there as worth revisiting.
- The current database schema holds only the scaffolding table spec 001 introduced. This feature adds no schema and no data.

## Data Handling and Compliance

This feature introduces no product or personal data. Assessed against the five mandatory questions from Principle XI on that basis:

1. **Personal data stored and its purpose**: None. This feature produces build definitions, service definitions and documentation. The only data that exists in an environment it creates is whatever the already-committed migrations define, which today is a single scaffolding table with no personal fields.
2. **Effect of a family member's account deletion**: Not applicable; no member or account data exists.
3. **Effect of a whole family's erasure**: Not applicable; no family data exists.
4. **Appearance in a user's data export**: Not applicable; nothing produced by this feature is user-owned data.
5. **Retention period**: Not applicable to product data. Local container state persists only as long as a contributor's own volumes, and the documented reset command destroys it.

One handling requirement does arise, and it is a security requirement rather than a privacy one: FR-011 and FR-012 exist because an image is a distributable artifact. Under ADR-013 the runtime image is transferred whole to a VPS that also hosts an unrelated public site, so any secret captured at build time would leave the developer's machine. These answers do not carry forward to a later feature that introduces real product schema, which must answer all five again on its own terms.
