# Implementation Plan: Containerized Development Environment

**Branch**: `004-containerized-development-environment` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-containerized-development-environment/spec.md`

## Summary

Introduce `apps/api/Dockerfile` with **three** build targets — `development`, `runtime` and `migrator` — and extend `docker-compose.yml` so that `docker compose up`, on a machine with only Docker installed, brings up PostgreSQL, applies every committed migration through a one-shot service, and starts a hot-reloading API that is not reported ready until both have succeeded. The existing `pnpm dev` host flow is preserved unchanged and re-documented as an optimisation.

Three findings from [research.md](research.md) change the design as ADR-014 imagined it, and each is a correctness matter rather than a preference:

1. **A third target is required.** The Prisma CLI is a *devDependency*, and FR-008 forbids dev dependencies in the runtime image, so migrations cannot run from it. A dedicated `migrator` target carries the CLI, schema and migrations and nothing else (research §3). This also invalidates an assumption already written into spec 003's plan.
2. **Six `node_modules` volumes, not one.** pnpm's symlink farm escapes each package directory, so a single root volume leaves dangling links under a bind mount (research §4). The one-volume alternative requires flattening pnpm's strict linking, which ARCHITECTURE §8.2 names as the strongest boundary-enforcement layer this repository has.
3. **Graceful shutdown needs two fixes in existing code plus an init process.** `main.ts` registers no `SIGTERM` handler and `client.ts` never disconnects Prisma; a process as PID 1 ignores unhandled signals entirely (research §6). FR-009 is not satisfiable by Dockerfile changes alone.

## Technical Context

**Language/Version**: TypeScript 5.9.x, Node.js 24 (pinned in `.nvmrc`, duplicated into the Dockerfile with an enforcing check per FR-014)

**Primary Dependencies**: No new runtime dependencies. Build-time only: `node:24-bookworm-slim` base, `openssl` and `ca-certificates` via apt, pnpm via corepack. CI adds `docker/build-push-action` and `docker/setup-buildx-action`.

**Storage**: PostgreSQL 16 via the existing `postgres:16-alpine` image, unchanged. This feature adds no schema and no data.

**Testing**: Vitest, already installed and wired into `turbo run test`. This feature's own verification is behavioural rather than unit-level — FR-016's "start the runtime image and reach `/health/ready`" is the real test, and it lives in CI. New unit coverage is limited to the Node-version drift check.

**Target Platform**: Linux containers. Development on the contributor's native architecture (arm64 on Apple Silicon); the `runtime` target built for `linux/amd64` in CI (research §8).

**Project Type**: Build and local-environment infrastructure inside the existing pnpm/Turborepo monorepo. No new workspace package, no new bounded context, no application feature.

**Performance Goals**: SC-003 (source edit reflected within seconds) and SC-004 (warm start under five minutes, cold under fifteen).

**Constraints**: One installed tool for a backend contributor (SC-002); no billed service (FR-019/SC-009); no secret in the build context or image metadata (FR-011/FR-012); spec 001's host flow must keep working unchanged (FR-017/FR-018).

**Scale/Scope**: One deployable (`apps/api`), three build targets, three Compose services, six named volumes, one new CI job plus one step added to an existing one.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Type Safety Is a Contract | PASS. The only new TypeScript is `scripts/verify-node-version.ts`, under the root `//#typecheck:workspace-root` and `//#lint:workspace-root` tasks that PR #5 introduced — the first feature to benefit from `scripts/**` being checked at all. No `any`, no assertions. |
| II. Validate at Every Boundary | PASS. No new external input reaches application code. The Dockerfile's `ARG NODE_VERSION` is build configuration, and FR-014's check is precisely a boundary assertion over it. `loadEnv` continues to parse configuration at process start, now inside a container — its behaviour is unchanged and already covered by tests. |
| III. Architecture Boundaries Are Enforced, Not Suggested | PASS, and actively protected. research §4 rejects the single-volume simplification specifically because it requires `node-linker=hoisted`, which would delete the pnpm strict-linking layer ARCHITECTURE §8.2 calls "not a rule that can be disabled with a comment". Six volumes is the price of keeping that layer. |
| IV. Persistence Goes Through the Data-Access Layer | PASS. `packages/persistence` gains a lifecycle hook (`$disconnect` on module destroy) and no new query path. The `migrator` target invokes the same `prisma migrate deploy` mechanism ADR-003 owns and spec 001 already uses; it does not introduce a second migration route. |
| V. Object-Level Authorization | N/A. No resource identifiers, no request handling changed. |
| VI. Children and Family Data Are Sensitive by Default (NON-NEGOTIABLE) | PASS by construction. No personal data exists. One requirement is load-bearing here for a *security* rather than privacy reason: FR-011/FR-012 keep secrets out of image layers, because ADR-013 ships the runtime image whole to a VPS that also hosts an unrelated public site. |
| VII. AI Proposes, the Domain Decides | N/A. |
| VIII. Asynchronous Work Goes Through the Event System | N/A. No events, no queues. The one-shot `migrate` service is deploy-time sequencing, not background work. |
| IX. API Contracts Are Versioned, Shared Artefacts | N/A for the product API. This feature's own contract — the commands, Compose services and configuration surface — is documented in [contracts/cli-and-compose.md](contracts/cli-and-compose.md) in the plan template's broader sense of "interface", not ADR-006's. |
| X. Infrastructure Is Code | PASS. Every environment definition is a committed file; nothing is configured by hand on a machine. "Secrets MUST NOT be committed, logged, or passed as build arguments" is FR-011 verbatim, and the hardened `.dockerignore` from PR #5 is what enforces it. |
| XI. Deletion and Export Are Designed, Not Retrofitted | PASS. spec.md's Data Handling section answers all five questions: no personal data, all not-applicable, with the reasoning stated rather than asserted. |

**Additional Engineering Constraints.** *"Cost is a design constraint"* — FR-019/SC-009 make "introduces no billed service" an acceptance criterion, which a plausible implementation could violate via a hosted build cache or a paid registry tier; GitHub Actions cache on a private repo's free tier is used instead. *"New external dependencies are decisions"* — no new runtime dependency is added; the two new CI actions are Docker's own official ones, already implied by ADR-014's choice of Docker.

**Development Workflow gate table.** This feature *adds* to the gate set (`image`, plus the drift check inside `verify-env`) rather than relying on gaps in it. Two pre-existing gaps remain open and are explicitly not this feature's scope: "Security scan: dependency vulnerabilities and secret scanning" (still the constitution's own `TODO(SECURITY_SCAN_TOOLING)`) and "Boundary and cycle validation" (no `dependency-cruiser` yet). Neither is introduced or worsened here.

**Post-Phase-1 re-check**: data-model.md, contracts/cli-and-compose.md and quickstart.md introduced no dependency, data flow or capability beyond what the table above assessed. The third build target (research §3) is the one material change from ADR-014's two-target shape; it *narrows* what the runtime image can do rather than widening it, so it strengthens the Principle IV and VI assessments rather than requiring re-classification. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/004-containerized-development-environment/
├── plan.md                    # this file
├── research.md                # Phase 0 output
├── data-model.md              # Phase 1 output
├── quickstart.md              # Phase 1 output
├── checklists/
│   └── requirements.md        # written with the spec
├── contracts/
│   └── cli-and-compose.md     # Phase 1 output
└── tasks.md                   # Phase 2 output (/speckit-tasks — not created by this command)
```

### Source Code (repository root)

```text
apps/api/
├── Dockerfile                      # new: base → deps → build → {development, runtime, migrator}
└── src/
    └── main.ts                     # amended: enableShutdownHooks(), explicit host bind

packages/persistence/
└── src/
    ├── client.ts                   # amended: disconnect hook (FR-009, research §6)
    └── lifecycle.ts                # new: OnModuleDestroy provider calling prisma.$disconnect()

docker-compose.yml                  # amended: `migrate` one-shot + `api` service, six named
                                    #   volumes, init: true, healthcheck, dependency conditions

scripts/
├── verify-node-version.ts          # new (FR-014): .nvmrc vs Dockerfile major, fails on drift
└── verify-node-version.spec.ts     # new: unit coverage for the comparison

.github/workflows/ci.yml            # amended: new `image` job (FR-015/016); drift check added
                                    #   as a STEP inside the existing `verify-env` job — the job
                                    #   must not be renamed, see below

docs/local-development.md           # rewritten (FR-005): Docker-first, host toolchain optional,
                                    #   explicit statement of what "just Docker" does not cover

package.json                        # amended: verify:node-version script, added to `verify`
.dockerignore                       # already hardened in PR #5; no change needed
```

**Structure Decision**: No new workspace package. This feature adds one Dockerfile, extends one Compose file, amends two existing source files for shutdown correctness, and adds one root script. It deliberately does not create an `infrastructure/`-style home for container definitions: the Dockerfile belongs beside the application it builds, and there is exactly one application.

**CI naming constraint (carried from research §9).** `main`'s branch protection names required checks by job name — currently `typecheck, lint, test, build`, with `format` and `verify-env` pending addition. Renaming a job silently blocks every future merge on a check that no longer reports. The drift check is therefore a **step inside `verify-env`**, not a new job, and the new `image` job must be added to the required list only once it has reported green at least once.

## Complexity Tracking

*No entries.* The design adds one build target beyond ADR-014's stated two, and research §3 explains why the two-target shape is not achievable given that the Prisma CLI is a devDependency. That is a correction to an assumption, not an unjustified complexity: the alternative (promoting a schema-altering CLI into every running API container) is simpler in file count and materially worse in standing capability.
