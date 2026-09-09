# Implementation Plan: Merge Gate Enforcement

**Branch**: `005-merge-gate-enforcement` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-merge-gate-enforcement/spec.md`

## Summary

Close the three merge-gate rows that have no check, using only tooling that adds no external service: `dependency-cruiser` (configured **fail-closed** via its `allowed` rule set) plus `eslint-plugin-boundaries` for boundary validation; GitHub's already-enabled push protection plus `gitleaks`, `osv-scanner` and `trivy` for security; and a dedicated test database on the PostgreSQL that already exists in all three environments for integration testing. Dependabot handles version updates and keeps SHA-pinned actions current.

Three findings from [research.md](research.md) shape the work:

1. **The repository is public**, and GitHub secret scanning with push protection is already enabled on it. That is a stronger control than the CI gate FR-009 asked for — it rejects the push rather than reporting after publication — so half of that requirement is already met. It also raises a decision the founder has not consciously taken; recorded in research §0 as a recommended follow-up ADR, deliberately outside this feature's scope.
2. **Renovate is rejected on constitutional grounds, not on features.** It is the better tool; its hosted form is a third-party service with write access to this repository, which the constitution requires an ADR and a privacy review for. Dependabot adds no vendor.
3. **Testcontainers is rejected on FR-020.** Using it from spec 004's containerized development path requires mounting the host Docker socket into the dev container — effectively host root — or accepting that the integration suite does not run on the path this project just made the supported one.

## Technical Context

**Language/Version**: TypeScript 5.9.x, Node.js 24 — unchanged.

**Primary Dependencies**: `dependency-cruiser`, `eslint-plugin-boundaries` (dev, workspace root). CI-only, not workspace dependencies: `gitleaks`, `osv-scanner`, `trivy`, all invoked as pinned GitHub Actions. `vitest` is already installed at 5.0.0 and supports the `projects` configuration the test tiers need.

**Storage**: A `family_platform_test` database on the existing PostgreSQL 16 instance. No new infrastructure — Compose provides it on both local paths and CI already runs it as a service container.

**Testing**: Two tiers via Vitest `projects` — `unit` (no database, must stay under 30s per SC-007) and `integration` (real database, transaction-rollback isolation). At least one real integration test against the committed scaffolding table proves the harness (FR-022).

**Target Platform**: GitHub Actions `ubuntu-latest`, plus both local development paths.

**Project Type**: Repository tooling and CI. No product code, no bounded context, no new workspace package.

**Performance Goals**: SC-007 (unit tier under 30s without a database) and SC-008 (total pipeline under 10 minutes). The three new jobs run in parallel with the existing seven, so wall-clock is bounded by the slowest job, which remains `image`.

**Constraints**: No paid service (FR-032). No existing job renamed (FR-028). Both development paths keep working (FR-031). Boundary rules must fail closed (FR-006) and must not be suppressible per-line (FR-007).

**Scale/Scope**: 5 workspace packages today; rules written for the ~15-package, 9-context structure ARCHITECTURE §8 describes. Three new CI jobs, one new step in an existing job, two new config files, one test harness.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| I. Type Safety Is a Contract | PASS. New TypeScript is the test harness and one integration test, under the existing strict config and the `//#typecheck:workspace-root` / `//#lint:workspace-root` tasks. `dependency-cruiser`'s config is JavaScript with a JSDoc type annotation, matching the existing `// @ts-check` convention in `eslint.config.js`. |
| II. Validate at Every Boundary | PASS / limited applicability. No new external input reaches application code. The harness reads `DATABASE_URL` through the same parsed configuration the API already uses rather than reading `process.env` directly. |
| III. Architecture Boundaries Are Enforced, Not Suggested | **This feature is the implementation of this principle's "Enforced by" clause.** The principle names `dependency-cruiser` and `eslint-plugin-boundaries` explicitly and neither has existed until now; enforcement has been review alone, which the constitution itself calls "assumed to fail". FR-006's fail-closed rule and FR-007's removal of per-line suppression are what make the resulting guarantee real rather than nominal. |
| IV. Persistence Goes Through the Data-Access Layer | PASS. The harness does not add a data-access path. It creates and migrates a database using the same Prisma migration mechanism ADR-003 owns, and its transaction-rollback isolation uses the client already inside `packages/persistence`. No second client, no raw SQL outside the designated directory. |
| V. Object-Level Authorization | N/A today, and this feature is a prerequisite for testing it properly later. The principle's "Enforced by" clause requires an API test suite asserting cross-family access returns not-found — which needs a real database with row-level security, which needs this harness. |
| VI. Children and Family Data Are Sensitive by Default (NON-NEGOTIABLE) | PASS. No personal data exists. Two relevant points: scanner output must not reproduce a secret value into logs more readable than the repository (FR-010), and the ephemeral test database holds only what a test writes, which today is the scaffolding table. |
| VII. AI Proposes, the Domain Decides | N/A. |
| VIII. Asynchronous Work Goes Through the Event System | N/A. No events, no queues. |
| IX. API Contracts Are Versioned, Shared Artefacts | N/A. No product API. |
| X. Infrastructure Is Code | PASS. Every gate is a committed configuration file. One item is deliberately **not** code and must be stated rather than hidden: branch protection's required-check list is GitHub repository configuration, changed through the API and not from a file in this repository. SC-010 requires it to be reconciled; there is no mechanism here to make it self-enforcing, and pretending otherwise would be worse than naming it. |
| XI. Deletion and Export Are Designed, Not Retrofitted | PASS. spec.md answers all five questions; no personal data, ephemeral test databases destroyed per run. |

**Additional Engineering Constraints.** *"New external dependencies are decisions"* — this is the constraint that decided §5 of the research: Renovate's hosted form is an external **service** receiving repository data, which requires an ADR and a privacy review; Dependabot is native and requires neither. The two workspace dev dependencies (`dependency-cruiser`, `eslint-plugin-boundaries`) are named by the constitution itself. *"Cost is a design constraint"* — FR-032 and SC-011 make zero recurring cost an acceptance criterion; every tool selected is free, and the repository being public makes Actions minutes free too.

**Development Workflow gate table.** This feature exists to close it. On completion every row maps to a named check (SC-009), and the required-check list matches the set of reporting blocking checks (SC-010) — the latter closing a gap that exists today, where three green blocking-quality checks cannot block anything.

**Post-Phase-1 re-check**: data-model.md, contracts/gates-and-config.md and quickstart.md introduced no dependency, data flow or capability beyond the table above. The one item worth re-stating is Principle X's honest exception: required-check configuration lives in GitHub, not in this repository, and is therefore verified by a documented command rather than by a file. Gate remains PASS.

## Project Structure

### Documentation (this feature)

```text
specs/005-merge-gate-enforcement/
├── plan.md                      # this file
├── research.md                  # Phase 0 output
├── data-model.md                # Phase 1 output
├── quickstart.md                # Phase 1 output
├── checklists/requirements.md   # written with the spec
├── contracts/
│   └── gates-and-config.md      # Phase 1 output
└── tasks.md                     # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
.dependency-cruiser.cjs             # new: allowed-edge graph, fail-closed. THE rule set.
osv-scanner.toml                    # new: vulnerability suppressions, each with an expiry
.gitleaks.toml                      # new: allowlist for .env.example's deliberately fake values
.github/dependabot.yml              # new: pnpm + github-actions ecosystems, grouped

packages/config-eslint/
└── boundaries.js                   # new: eslint-plugin-boundaries zones (editor feedback)

packages/testing/                   # new workspace package: the integration harness
├── package.json
├── tsconfig.json
├── eslint.config.js
└── src/
    ├── index.ts                    # exported harness surface
    ├── database.ts                 # create/migrate the test database once per run
    └── transaction.ts              # per-test rollback isolation

packages/persistence/
└── src/
    └── scaffold-probe.integration.spec.ts   # new (FR-022): proves the harness end to end

vitest.config.ts                    # new at root: `projects` split into unit and integration

.github/workflows/ci.yml            # amended: + boundaries, security, test-integration jobs;
                                    #   trivy as a STEP in the existing image job.
                                    #   NO existing job renamed (FR-028).

docs/local-development.md           # amended: how to run each tier on both paths
package.json                        # amended: boundaries / test:integration scripts
turbo.json                          # amended: //#boundaries task
```

**Structure Decision**: One new workspace package, `packages/testing`, in the location [ARCHITECTURE §8](../../ARCHITECTURE.md) already reserves for it ("factories, fixtures, testcontainers harness"). Everything else is configuration at the root, because the rules govern the whole repository and a rule set split across packages is the thing FR-008 exists to prevent.

Note that `packages/testing` is itself the first test of FR-006: a new package appearing with no rule covering it must fail the boundary check. If adding it does not turn the gate red before its rule is written, the fail-closed configuration is wrong.

## Complexity Tracking

*No entries.* The feature adds four configuration files, one small workspace package and three CI jobs — all of them the direct, minimal expression of gate rows the constitution already requires. The one place a simpler option was available and rejected (`forbidden`-only boundary rules instead of `allowed`) is not a complexity trade but a correctness one: the simpler configuration fails open, which FR-006 forbids and which would make the rule set decorative until `packages/core` exists.
