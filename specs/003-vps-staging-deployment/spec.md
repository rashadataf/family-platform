# Feature Specification: VPS Staging Deployment

**Feature Branch**: `003-vps-staging-deployment`

**Created**: 2026-09-08

**Status**: Draft

**Input**: User description: "Initial staging deployment to the founder's existing VPS, per ADR-013 (staged hosting model) and ADR-004 (Pulumi/TypeScript IaC tooling, unchanged). Deliverable: a documented, repeatable Pulumi stack that deploys the same container images the local environment (spec 001) produces to the existing VPS, reachable at a stable staging URL, seeded from fixtures only. Scope: A new Pulumi stack (vps-staging) in infrastructure/, using Pulumi's command and docker providers to build/push images and bring up the equivalent of the local Docker Compose service set over SSH; Network isolation from the VPS's existing portfolio-site containers (separate Docker network, no shared volumes, no shared database, no shared secrets); Secrets sourced from whatever mechanism already secures the VPS, never committed; A pulumi up / pulumi down (or equivalent pnpm script) entrypoint; Migrations applied automatically as part of deploy, using the same Prisma migration mechanism as local; Documentation stating explicitly what this environment is for, and its synthetic-data-only constraint. Out of scope: any real user or family data (forbidden at this stage per ADR-013); the AWS topology from ADR-004's original table; ephemeral per-PR preview environments (deferred to Stage 1); authentication; any product domain logic beyond what spec 001 already scaffolded."

## Clarifications

### Session 2026-09-08

- Q: Which container registry should hold the images this stack builds and pushes to the VPS? → A: No registry — images are built and transferred directly to the VPS over SSH (e.g. built locally/in CI, transferred, then loaded on the VPS), avoiding any third-party or self-hosted registry.
- Q: If the VPS itself reboots, should the staging containers come back up automatically, or is a manual redeploy acceptable? → A: Automatic restart — staging containers use a restart policy so they come back on their own after a VPS reboot, matching local dev's existing `restart: unless-stopped` convention.
- Q: Does the founder need any way to check application logs or health status for the staging deployment beyond SSHing into the VPS and running docker commands directly? → A: No — SSH plus the Docker CLI is sufficient; this feature introduces no dedicated logging or monitoring tooling.
- Q: Should the Dockerfile this feature introduces for the API also be wired into the local docker-compose.yml (spec 001), or exist solely for the VPS deploy path? → A: Also wire it into docker-compose.yml, so the founder can run the fully containerized stack locally, keeping local and staging shapes as close as ADR-013 intends. **Revised 2026-09-08, before implementation:** the answer stands, but the ownership does not. [ADR-014](../../adr/ADR-014-containerized-development.md) makes the container image foundational rather than a deployment side effect, so the Dockerfile and the local Compose service entry are delivered by [spec 004](../004-containerized-development-environment/spec.md) and merely *consumed* here. See FR-018.
- Q: Should deploys to vps-staging run automatically (e.g. via the existing CI pipeline from spec 002 on merge to main), or stay a manually-triggered command? → A: Automatic via CI on merge to main, extending spec 002's pipeline; the manual `pulumi up`/`pulumi down` entrypoint still exists for ad hoc use and teardown.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Deploy the platform to a reachable staging environment (Priority: P1)

The founder, having only the local development environment (spec 001) working on their own machine, either runs a single documented command or merges a pull request into main, and ends up with the same application running on the existing VPS, reachable at a stable URL, with a database that already reflects every committed migration and contains only fixture data.

**Why this priority**: This is the entire point of the feature — a working deployment the founder can demo, dogfood, and validate against something other than their own laptop. Every other capability in this spec exists in service of this one outcome.

**Independent Test**: From a machine with only the documented prerequisites (VPS access, Pulumi credentials) and no prior deployment history, run the single deploy command and confirm the staging URL responds successfully, serving the same application spec 001 runs locally, with a database schema matching every committed migration and no data beyond the committed fixtures.

**Acceptance Scenarios**:

1. **Given** the staging environment has never been deployed, **When** the founder runs the single deploy command, **Then** the container images are built, transferred to the VPS, and brought up there, and the staging URL becomes reachable and serves the application.
2. **Given** the staging environment does not yet have a database, **When** the deploy command runs, **Then** the database is created, every committed migration is applied, and it is seeded from the committed fixture set before the staging URL is considered ready.
3. **Given** the deploy command has completed successfully, **When** the founder requests the staging URL, **Then** the response comes from the newly deployed containers, not from the VPS's existing portfolio-site containers.

---

### User Story 2 - Redeploy without losing the ability to iterate (Priority: P2)

The founder has a working staging deployment and makes further changes — new application code, a new migration, or both — and needs to push those changes to staging repeatedly over the life of the project using the same single command, without manually cleaning up prior state first.

**Why this priority**: A deployment that can only be created once is not a staging environment, it is a one-off demo. Iteration is what makes it useful for ongoing validation and dogfooding rather than a single snapshot.

**Independent Test**: With a staging environment already deployed, change the application source and add a new migration, run the same single deploy command again, and confirm it completes successfully, the new migration has been applied, and the staging URL serves the updated code.

**Acceptance Scenarios**:

1. **Given** a staging environment that is already deployed and healthy, **When** the founder runs the deploy command again with no changes, **Then** it completes successfully without error, the staging URL remains reachable throughout, and any previously seeded or founder-generated staging data is still present afterward.
2. **Given** a new migration has been added since the last deploy, **When** the founder runs the deploy command, **Then** the new migration is applied automatically as part of that run, with no separate manual migration step.
3. **Given** a staging environment with data the founder wants to discard, **When** the founder runs the deploy command with the explicit reset option, **Then** the database is wiped and reseeded fresh from the committed fixtures before the environment is considered ready again.
4. **Given** a pull request is merged into main, **When** the CI pipeline (spec 002) runs, **Then** it automatically deploys the merged change to the staging environment, with no manual deploy action from the founder.
5. **Given** a staging environment the founder no longer needs running, **When** the founder runs the single teardown command, **Then** every staging-specific container, network, and resource created by this stack is removed from the VPS. Teardown is never triggered automatically by CI.

---

### User Story 3 - Confirm the staging environment cannot affect the existing portfolio site (Priority: P3)

The founder (or anyone reviewing this deployment before trusting it) verifies that standing up and tearing down the staging environment has no effect on the VPS's existing, unrelated portfolio-site containers — they keep running, keep their own data, and are reachable throughout.

**Why this priority**: The VPS is shared with a production site the founder already depends on. A deployment mechanism that risks that site to stand up a demo environment is a net loss regardless of how well the demo itself works, which is why this is validated as its own scenario rather than assumed.

**Independent Test**: With the portfolio site's containers already running, deploy the staging environment, confirm the portfolio site remains reachable and unaffected throughout, then tear the staging environment down and confirm the portfolio site is still unaffected.

**Acceptance Scenarios**:

1. **Given** the portfolio site's containers are running on the VPS, **When** the staging environment is deployed, **Then** the portfolio site's containers keep running without interruption and remain reachable at their existing address.
2. **Given** both the staging environment and the portfolio site are running, **When** the staging environment's containers are inspected, **Then** they share no Docker network, no volume, no database, and no secret with the portfolio site's containers.
3. **Given** the staging environment is torn down, **When** the portfolio site is checked afterward, **Then** it is still running, unaffected, with its own data intact.

---

### Edge Cases

- What happens when the deploy command is run but the SSH connection to the VPS drops partway through? The founder must be able to tell the deploy did not complete, and re-running the command must recover to a working state rather than requiring manual cleanup on the VPS.
- What happens when a migration fails partway through a deploy? The deploy must fail visibly and stop before the staging URL is presented as ready; it must never silently leave the staging URL serving an application against a partially migrated schema.
- What happens when a secret the deployment needs is missing from the VPS's existing secrets mechanism? The deploy must fail with a clear, specific error naming the missing secret, before any container is brought up, rather than starting and failing later.
- What happens when the container ports or resource names this stack wants to use are already occupied by the portfolio site's containers or another process on the VPS? The deploy must fail with a clear, specific conflict error rather than silently colliding with existing services.
- What happens if someone attempts to point the staging deploy at a real family's data instead of the fixture set? The deployment mechanism must provide no supported path for loading anything other than the committed fixtures; this is a documented, procedural constraint rather than a claim of technical enforcement.
- What happens when the VPS itself reboots, for example for host maintenance? The staging containers must restart automatically without a manual redeploy, so the staging URL becomes reachable again on its own.
- What happens when an automatic CI-triggered deploy fails after a pull request has already been merged into main? The merge itself is not reverted; the failure must be clearly visible in CI, and the previous known-good staging deployment must keep running throughout, exactly as it would for a failed manual deploy.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a Pulumi stack, named `vps-staging`, in the same `infrastructure/` package location ADR-004 established, capable of deploying the application to the founder's existing VPS.
- **FR-002**: The deploy MUST build the same container image(s) the local environment (spec 001) is built from and transfer them directly to the VPS, with no intermediate container registry involved, without requiring a separate manual build step outside the deploy command.
- **FR-003**: The deploy MUST bring up, on the VPS over SSH, the deployed equivalent of the local Docker Compose service set spec 001 defines.
- **FR-004**: The deployed staging environment MUST be reachable at a stable URL based on the VPS's existing IP address and a fixed, documented port; no DNS record or TLS certificate provisioning is required by this feature.
- **FR-005**: The staging environment's containers MUST run on a Docker network isolated from the VPS's existing portfolio-site containers, sharing no volume, no database, and no secret with them.
- **FR-006**: Secrets the deployment needs (for example, database credentials and VPS access credentials) MUST be sourced from whatever mechanism already secures the founder's existing VPS deployment, MUST be available to the CI pipeline as encrypted CI secrets so it can run the deploy on merge, and MUST NOT be committed to the repository in any form.
- **FR-007**: The system MUST provide a single documented command that provisions or updates the entire staging environment (a `pulumi up` equivalent), and a single documented command that fully tears it down (a `pulumi down` equivalent).
- **FR-008**: Database schema migrations MUST be applied automatically as part of every deploy, using the same Prisma-based migration mechanism the local environment (spec 001) uses, and MUST complete successfully before the staging URL is considered ready.
- **FR-009**: A deploy MUST fail visibly, leaving the previous known-good deployment (if any) running, if a migration fails partway through; it MUST NOT present the staging URL as ready against a partially migrated schema.
- **FR-010**: The staging database MUST be populated only from a committed fixture data set; the deploy mechanism MUST provide no supported way to load real user or family data into it.
- **FR-011**: On first deploy, the staging database MUST be created, migrated, and seeded from the fixture set automatically, with no separate manual step.
- **FR-012**: On a repeat deploy against an already-running staging environment, previously seeded or founder-generated staging data MUST be preserved by default. The deploy mechanism MUST also support an explicit, operator-controlled option that, when invoked, wipes and reseeds the database fresh from fixtures as part of that run, so the founder can choose either behavior per deploy.
- **FR-013**: Tearing down the staging environment MUST remove every staging-specific container, network, and resource this stack created from the VPS, without affecting the portfolio site's own containers, volumes, or data.
- **FR-014**: The staging URL MUST be openly reachable with no access restriction (no IP allowlist, no authentication gate in front of it); this exposure is accepted at this stage because the environment holds only synthetic fixture data.
- **FR-015**: The repository MUST include committed documentation stating explicitly what the staging environment is for (technical validation, demos, and the founder's own dogfooding) and its synthetic-data-only constraint, including that this environment is never authorized to hold real user or family data.
- **FR-016**: The deploy mechanism MUST connect to the VPS using credentials or configuration that are not committed to the repository.
- **FR-017**: The staging environment's containers MUST be configured to restart automatically if the VPS reboots (for example, for host maintenance), without requiring the founder to manually redeploy for the staging URL to become reachable again.
- **FR-018**: This feature MUST deploy the API container image defined by [spec 004](../004-containerized-development-environment/spec.md), and MUST NOT define an image of its own. The Dockerfile, its production-shaped runtime target, and the local Compose service entry are spec 004's deliverables. This feature's requirement is the dependency itself: the image it ships MUST be the same artifact contributors already run locally and that CI already builds and health-checks on every pull request, so that no image defect can first surface during a deploy. **Spec 003 MUST NOT be implemented before spec 004.**
- **FR-019**: Merging a pull request into main MUST automatically trigger a deploy of the merged change to the staging environment via the existing CI pipeline (spec 002), invoking the same deploy mechanism the manual command uses, with no manual step required from the founder.
- **FR-020**: The teardown command (`pulumi down` equivalent) MUST NOT be triggered automatically by CI or by any merge event; it remains a deliberate, manually-invoked action only.

### Key Entities

- **Staging Deployment**: The running instance of the application on the VPS, produced by the `vps-staging` Pulumi stack. Tracks which container images and which migration state are currently live. Holds no product or personal data — synthetic fixture data only.
- **Fixture Data Set**: The committed, synthetic data used to seed the staging database. Represents no real family, member, or user; exists solely to make the staging environment demonstrable.
- **Staging Environment Documentation**: The committed description of the environment's purpose and its data constraint, read by anyone operating or reviewing this deployment before they trust or extend it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a clean state (no prior staging deployment), running the single deploy command results in a responding staging URL, with database migrations applied and fixtures seeded, within 30 minutes.
- **SC-002**: Running the deploy command again against an already-deployed staging environment completes successfully, with the staging URL remaining reachable throughout and previously present staging data intact, every time it is exercised without the reset option; invoking the reset option instead leaves the database containing only freshly reseeded fixture data, every time it is exercised.
- **SC-003**: A newly added migration is applied automatically the next time staging is deployed, with zero manual database commands required, matching the guarantee already established for local development.
- **SC-004**: Deploying or tearing down the staging environment never causes any measurable interruption to the VPS's existing portfolio-site containers, verified on every deploy and teardown.
- **SC-005**: 100% of data ever present in the staging database originates from the committed fixture set; no real user or family data is ever entered, verified by the absence of any supported mechanism for doing so.
- **SC-006**: A person who has never operated this deployment before, reading only the committed documentation, can correctly state the environment's purpose and its synthetic-data-only constraint without asking anyone.
- **SC-007**: After the VPS reboots, the staging URL becomes reachable again on its own, with no manual redeploy, within a few minutes of the VPS finishing its own restart.
- **SC-008**: A pull request merged into main results in the staging URL serving the merged change automatically, with no manual deploy action taken by the founder, verified on every merge to main.

## Assumptions

- The founder already has SSH access to the existing VPS and whatever secrets mechanism currently secures its portfolio-site deployment; provisioning that access itself is not part of this feature.
- The API container image, its Dockerfile and its local Compose service entry are assumed to already exist, delivered by [spec 004](../004-containerized-development-environment/spec.md) under [ADR-014](../../adr/ADR-014-containerized-development.md). This spec originally claimed that work for itself; that was reassessed before implementation, because an image introduced by a deployment feature is an image whose defects are first discovered during a deployment — the furthest possible point from whoever caused them. ADR-013's requirement that container images are identical across stages is satisfied by spec 004 building and health-checking the runtime target on every pull request, which is a stronger guarantee than this spec could have made on its own. Spec 001's existing tsx-based dev flow remains available and is unaffected by either feature.
- No container registry is used by this deployment; built images are transferred directly to the VPS and loaded there, avoiding a new third-party account or an additional self-hosted service to secure.
- The `vps-staging` stack targets exactly one shared staging environment, not one per branch or per pull request; ephemeral per-PR environments are explicitly deferred to Stage 1 per ADR-013.
- No authentication is introduced for the product itself (per the out-of-scope statement), and per FR-014 the staging URL itself is also left openly reachable rather than gated at the infrastructure level.
- Spec 001's database schema currently holds no product domain data — only a scaffolding table that exists to prove the migration mechanism works. Because no fixture data set exists yet, this feature is responsible for introducing the fixture-seeding mechanism itself (wired into deploy per FR-010/FR-011), proven against that same trivial scaffolding data. This mirrors spec 001's own precedent for its baseline migration: the mechanism is proven now, without modeling any product domain, so a later feature that adds real domain schema only has to add fixture content, not rebuild the seeding pipeline.
- Reasonable staging-grade resource sizing (CPU, memory, disk) is constrained by the VPS's existing spare capacity, shared with the portfolio site; no specific sizing numbers are fixed by this spec.
- No dedicated logging or monitoring tooling is introduced for the staging environment; checking application logs or container health is done by SSHing into the VPS and using the Docker CLI directly, the same operating model already used for the portfolio site there.
- This feature extends spec 002's CI pipeline with a deploy stage/job that runs on push to main (after the existing install/typecheck/lint/test/build steps already gate the merge), reversing spec 002's original "deployment is explicitly out of scope" statement for this one purpose; spec 002's existing checks and branch protection are otherwise unchanged.

## Data Handling and Compliance

This feature introduces no product or personal data, so it is assessed against the project's mandatory data-handling questions on that basis:

1. **Personal data stored and its purpose**: None. This feature's only persisted artifacts are the same structural migration-history record spec 001 already established, plus the committed fixture data set (FR-010/FR-011), which is deliberately synthetic and represents no real family, member, or user.
2. **Effect of a family member's account deletion**: Not applicable; no member or account data exists in this environment.
3. **Effect of a whole family's erasure**: Not applicable; no family data exists in this environment.
4. **Appearance in a user's data export**: Not applicable; nothing produced by this feature is real, user-owned data.
5. **Retention period**: Not applicable to product data. Fixture data persists only as long as the staging environment exists, and is wholesale replaced whenever the reset option (FR-012) is invoked.

This mirrors spec 001's own "not applicable" answers on the same basis; neither this feature's answers nor spec 001's carry forward to a future feature that introduces real product schema, which must answer these five questions again on its own terms.
