# Implementation Plan: VPS Staging Deployment

**Branch**: `003-vps-staging-deployment` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-vps-staging-deployment/spec.md`

## Summary

Add a new Pulumi stack, `vps-staging`, in a new `infrastructure/` workspace package (per ADR-004,
amended only on topology by ADR-013) that deploys the API and Postgres to the founder's existing
VPS. The `docker` provider builds the API image locally (wherever `pulumi up` runs); the `command`
provider transfers it to the VPS over SSH and orchestrates it there via plain `docker compose`,
reusing the same `docker-compose.yml` local dev already uses — whose `api` service entry is
delivered by spec 004 under ADR-014, not by this feature (FR-018) — plus a staging-only override
file for network isolation, restart policy, and the published port. Every deploy migrates the new
image against the old, still-running container before swapping (research.md §2), so a failed migration never presents a broken deploy as ready.
Deploys run either manually (`pnpm staging:deploy` / `pnpm staging:destroy`) or automatically via a
new CI job on merge to `main`; teardown and the data-reset option stay founder-only. No container
registry, no DNS/TLS, no access gate, and no data beyond a committed fixture set are introduced —
each a direct, deliberate consequence of the five `/speckit-clarify` decisions this plan builds on.

## Technical Context

**Language/Version**: TypeScript 5.9.x, Node.js ≥24 <25 (both already pinned at the workspace root)

**Primary Dependencies**: `@pulumi/pulumi`, `@pulumi/docker-build` (local image build, research.md §1), `@pulumi/command` (`remote.CopyToRemote`, `remote.Command`), `zod` (stack config validation, mirroring `apps/api`'s `env.schema.ts` pattern), `@fp/config-typescript` and `@fp/config-eslint` (shared workspace config, per Constitution Principle IX's sibling requirement that every package consume them)

**Storage**: N/A for the `infrastructure/` package itself. The stack it deploys provisions PostgreSQL 16 via the same `postgres:16-alpine` image `docker-compose.yml` already pulls, unchanged.

**Testing**: Pulumi's mock testing harness (`@pulumi/pulumi/testing`), wired into `turbo run test` like every other package; scope is deliberately narrow at this stage (research.md §5).

**Target Platform**: Linux server (the founder's existing VPS, reached over SSH). The program itself runs from a Linux CI runner (`ubuntu-latest`) or the founder's local machine — never on the VPS.

**Project Type**: Infrastructure-as-code program plus a small CI extension, inside the existing pnpm/Turborepo monorepo. Not a standalone application; no new bounded context.

**Performance Goals**: N/A in the request-throughput sense. The closest analogs are spec.md's SC-001 (first deploy reaches a responding URL within 30 minutes) and SC-007 (reboot recovery within a few minutes).

**Constraints**: No container registry (FR-002); no DNS record or TLS certificate (FR-004); staging URL openly reachable, no access gate (FR-014); resource sizing bounded by the VPS's existing spare capacity, shared with the portfolio site (spec.md Assumptions) — no specific CPU/memory numbers fixed here.

**Scale/Scope**: One shared staging environment (not per-branch/PR, per ADR-013's explicit deferral of preview environments), two services (`api`, `postgres`), one Pulumi stack.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Type Safety Is a Contract | PASS. `infrastructure/tsconfig.json` extends `@fp/config-typescript/base.json` with strict mode, matching every other package; no `any` in stack config or resource definitions — `StackConfig` (data-model.md) is a Zod-parsed, fully typed shape. |
| II. Validate at Every Boundary | PASS. Stack configuration is "environment variables and runtime configuration, at process start" in this feature's context — `infrastructure/src/config.ts` parses it with Zod before any resource is constructed, and MUST fail before touching the VPS on an invalid value (data-model.md's `StackConfig` validation rules), mirroring `apps/api/src/config/env.schema.ts` exactly. |
| III. Architecture Boundaries Are Enforced, Not Suggested | PASS / mostly N/A. `infrastructure/` is not a bounded context and does not import `packages/core`, `packages/persistence`'s client, or any application package — its only workspace dependencies are the shared `config-*` packages. This is a stronger constraint than ADR-004's own "depends only on `packages/kernel`" note, since `packages/kernel` does not exist yet in this repository; `infrastructure/` depends on nothing app-specific at all. |
| IV. Persistence Goes Through the Data-Access Layer | N/A for `infrastructure/` itself — it invokes the Prisma CLI remotely via the `migrate` service (spec 004's `migrator` build target, ADR-014), the same one-shot mechanism local dev already uses and the same one `docker-compose.yml` already gates `api` behind via `service_completed_successfully` (FR-008; corrects issue #9 — the `api` runtime image deliberately carries no Prisma CLI per spec 004 FR-008, so a migration cannot run from it). It does not query the database or add a second data-access path. |
| V. Object-Level Authorization | N/A. No resource identifiers, no multi-tenant access — a single operator, a single shared environment. |
| VI. Children and Family Data Are Sensitive by Default (NON-NEGOTIABLE) | PASS by construction. FR-010 forbids any supported path for loading real data; the fixture-only seed mechanism (data-model.md's `FixtureDataSet`) is the only data source. See spec.md's Data Handling and Compliance section, added during this planning pass to close a Principle XI gap (below). |
| VII. AI Proposes, the Domain Decides | N/A. No AI involvement. |
| VIII. Asynchronous Work Goes Through the Event System | N/A. No domain events, no queues. |
| IX. API Contracts Are Versioned, Shared Artefacts | N/A. No product API contract is introduced. This feature's own "contract" (the CLI/config/CI surface) is documented in `contracts/cli-and-config.md` per the plan template's broader sense of "interface," not ADR-006's sense. |
| X. Infrastructure Is Code | PASS, with two points worth stating explicitly rather than leaving implicit: (1) "Production applies MUST run in CI... with a manual approval gate" is scoped to *production* in the constitution's own text, and ADR-013 is explicit that Stage 0 is never production ("production implies real user data and nothing in Stage 0 is authorised to hold it") — so FR-019's unattended CI deploy on merge does not violate this bullet. (2) "Stateful resources MUST have deletion protection" is satisfied procedurally rather than via a `pulumi.protect` resource flag, because this design manages the Postgres volume through `docker compose` shell commands rather than discrete Pulumi resources (research.md §1, §3) — protection here means an ordinary deploy structurally cannot reach the volume at all, only the separately-invoked reset or teardown commands can. Secrets flow exclusively through Pulumi Cloud's encrypted config (research.md §4), satisfying "not committed, logged, or passed as build arguments." |
| XI. Deletion and Export Are Designed, Not Retrofitted | PASS, after this planning pass. spec.md was missing the required "Data Handling and Compliance" five-answer section (present in spec 001, absent from spec 003 as written) — added during this plan's preparation, since all five answers were already fully determined by the spec's own existing constraints (no personal data, by design) and required no new user decision. |

**Additional Engineering Constraints**: "Cost is a design constraint... a component MUST NOT be provisioned before the trigger that justifies it" — directly the reason this plan targets the VPS and explicitly excludes the AWS topology; confirmed with the user during this planning session after the initial plan input described AWS resources that belong to Stage 1, not this feature. "New external dependencies are decisions" — `@pulumi/docker-build` and `@pulumi/command` are Pulumi's own official provider packages, already implied by ADR-004's and ADR-013's tool choice, not a new external service requiring an ADR.

**Development Workflow gate table**: "Infrastructure validation and preview" is satisfied by the new `infra-preview` CI job (`pulumi preview` on every pull request, contracts/cli-and-config.md). "Security scan: dependency vulnerabilities and secret scanning" has no CI job in this repository yet — a pre-existing gap from spec 002 (its own spec explicitly deferred security scanning), not introduced or worsened by this feature, and not this feature's scope to close.

No unjustified violations exist; the Complexity Tracking table below is intentionally empty.

**Post-Phase-1 re-check**: data-model.md, contracts/cli-and-config.md, and quickstart.md introduced
no resource, dependency, or data flow beyond what the table above already assessed — the CLI
surface and stack-config schema in contracts/cli-and-config.md are the same `infrastructure/`
program described under Principle II/III above, and `FixtureDataSet` in data-model.md is the same
mechanism Principle VI's assessment already covers. No re-classification needed; gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/003-vps-staging-deployment/
├── plan.md              # this file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/
│   └── cli-and-config.md # Phase 1 output
└── tasks.md              # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
infrastructure/                          # new: @fp/infrastructure workspace package
├── package.json
├── tsconfig.json                        # extends @fp/config-typescript/base.json
├── eslint.config.js                     # extends @fp/config-eslint
├── Pulumi.yaml                          # program metadata
├── Pulumi.vps-staging.yaml              # non-secret stack config only — secrets live solely in Pulumi Cloud's encrypted state
├── index.ts                             # program entrypoint
├── src/
│   ├── config.ts                        # StackConfig, Zod-parsed (data-model.md)
│   ├── image.ts                         # docker-build.Image: local build (research.md §1)
│   ├── transfer.ts                      # command.remote.CopyToRemote: image tarball + compose files -> VPS
│   ├── deploy.ts                        # command.remote.Command sequence: load, `compose run --rm migrate` (research.md §2), up
│   └── deploy.test.ts                   # Pulumi mock test (research.md §5)
└── docker-compose.staging.yml           # staging-only Compose override (data-model.md's ComposeServiceSet)

apps/api/
└── Dockerfile                           # CONSUMED, not created (FR-018): delivered by spec 004 / ADR-014.
                                         #   This stack builds its `runtime` target; it defines nothing here.

docker-compose.yml                       # CONSUMED, not amended (FR-018): the `api` service entry is spec 004's
                                         #   deliverable. This feature adds only the staging override file below.

packages/persistence/
├── package.json                         # amended: add `prisma.seed` entry
└── prisma/
    └── seed.ts                          # new (FR-010/FR-011): fixture-seeding mechanism

.github/workflows/
└── ci.yml                               # amended (FR-019/FR-020): `infra-preview` + `infra-deploy` jobs

docs/
└── staging-environment.md               # new (FR-015): purpose + synthetic-data-only constraint

pnpm-workspace.yaml                      # amended: add `infrastructure` as a workspace member (ARCHITECTURE.md §8 already reserves this path; the workspace glob does not yet include it)
package.json                             # amended: staging:preview / staging:deploy / staging:deploy:reset / staging:destroy scripts (contracts/cli-and-config.md)
```

**Structure Decision**: A single new workspace package, `infrastructure/`, in the location
ARCHITECTURE.md §8's repository tree already reserves for it and ADR-004 already named. No new
bounded context, no new `apps/*` entry. The only change to an existing feature's deliverables is the
one additive amendment FR-019 requires: a deploy job in spec 002's `ci.yml`. The container image and
its local Compose service entry, which an earlier draft of this plan listed as deliverables here,
belong to spec 004 under ADR-014 and are consumed rather than created — which makes this feature
strictly smaller than first planned.

**Sequencing constraint**: spec 004 must be implemented and merged before this feature. Its runtime
image target is a hard input, not a parallel workstream.

## Complexity Tracking

*No entries.* The Constitution Check above identifies two places where this design satisfies a
principle's intent through a different mechanism than its most literal reading (production-only
approval gates; procedural rather than resource-level deletion protection) and explains why in
place; neither is a violation requiring a simpler-alternative-rejected justification.
