# Phase 0 Research: GitHub Actions CI Pipeline

No `[NEEDS CLARIFICATION]` markers remained after the spec's clarification session; the research below resolves implementation-level design questions raised while translating that spec into a concrete plan. Two of these decisions were validated against the live repository state and cross-checked with a design-review pass before being finalized.

## 1. Job structure for per-step PR check visibility

**Decision**: Four separate GitHub Actions jobs — `typecheck`, `lint`, `test`, `build` — each running independently, rather than one job executing five sequential steps. `install` is folded into each job as its own first step (checkout → Node/pnpm setup → `pnpm install --frozen-lockfile`), not a fifth standalone job.

**Rationale**: GitHub's pull request "Checks" list renders one row per Actions job (or per external status check), not per step within a job. A single job running install→typecheck→lint→test→build as five steps would appear as exactly one entry in that list; a contributor would have to open that job's log to find which of the five steps failed. FR-003 and FR-009 require the failing step to be individually visible "without opening a combined log," and SC-005 requires identifying the failing step "by looking at the pull request's list of checks alone" — both are only satisfiable with separate jobs. `install` is not given its own job because it isn't an independently meaningful merge gate on its own (it's a prerequisite every other job needs anyway), and repeating a cache-hit `pnpm install` four times is cheap; if install itself fails, it fails inside whichever job hit it first, which is still individually attributable.

**Accepted trade-off**: `typecheck` and `lint` both declare `dependsOn: ["^build", "db:generate"]` in `turbo.json`. Since each job is an isolated, independent runner, three of the four jobs (`typecheck`, `lint`, and `build` itself) will each independently trigger Turborepo to build upstream packages on a cold cache — this work is not shared live between parallel jobs. This is not a correctness problem (Turborepo's own per-task caching still applies within each job), and is substantially mitigated run-to-run by decision 2 below.

**Alternatives considered**:
- *Single job, five sequential steps.* Rejected: fails FR-003/FR-009/SC-005 as described above.
- *Single job with an aggregator/"aggregate CI" required check plus informational per-step annotations.* Rejected: that pattern exists to let branch protection tolerate conditionally-skipped matrix jobs, which doesn't apply here — every job runs unconditionally on every trigger, so an aggregator would only reduce visibility, working against the spec rather than for it.

## 2. Caching strategy without a remote cache service

**Decision**: Two independent caching layers, both scoped to the CI provider's own storage per the spec's Assumptions (no remote cache service is stood up):
- **Dependency install** (FR-006): `actions/setup-node`'s built-in `cache: 'pnpm'`, keyed on `pnpm-lock.yaml`.
- **Turborepo task results** (FR-007, SC-006): `actions/cache` on the `.turbo` cache directory, keyed **per job** as `turbo-<job-name>-${{ runner.os }}-${{ github.sha }}` with restore-keys `turbo-<job-name>-${{ runner.os }}-`.

**Rationale**: Parallel jobs run on isolated, freshly-provisioned VMs with no shared live filesystem, so they cannot share a `.turbo` cache with each other mid-run — a cache is only persisted via `actions/cache/save` once a job finishes. Using an identical cache key across all four jobs would create a save race: `actions/cache` refuses to overwrite an existing key within a run, so whichever job finishes first "wins" that key and the other three jobs' cache contributions are silently dropped, defeating the purpose for three of the four jobs. Namespacing the key per job avoids the collision and gives each job's own task-result history continuity from run to run, which is what FR-007 ("reuse a prior task result, per package and per task") and SC-006 (a warm re-run visibly faster than the first cold run) actually require — the reuse is across pushes, not within a single run's parallel jobs.

**FR-008 (cold-run correctness)**: Holds regardless of cache state. Turborepo's cache is strictly an execution-skip optimization; on any miss — including a cold `actions/cache` restore-key miss producing an empty `.turbo` directory — Turborepo falls through to real execution of the underlying command. There is no failure mode where a cache miss produces an error instead of a real run.

**Alternatives considered**:
- *A single shared `.turbo` cache key across all four jobs.* Rejected: the save-race problem above.
- *A hosted remote cache (Vercel Remote Cache, or a self-hosted equivalent).* Rejected: explicitly out of scope per the spec's Assumptions ("not standing up a separate remote-caching service").

## 3. Wiring a `test` step where no test framework exists yet

**Decision**: Add a `test` task to `turbo.json` (same shape as the existing `build`/`typecheck`/`lint` tasks) and a trivial stub script — `"test": "echo \"no tests yet\" && exit 0"` — to `apps/api/package.json` only, plus a root `test`/`turbo test` script. `packages/persistence` and the three config packages do not get a `test` script.

**Rationale**: FR-005 requires the unit test step to pass when zero tests exist and fail only on an actual failing test; FR-010 requires it to run "the same...commands already established for local development" (which this feature is itself establishing, per the spec's own Assumptions: "wired to run whatever test command the workspace defines"). Turborepo does have a documented behavior where `turbo run <task>` completes successfully with zero tasks executed if literally no package in the workspace defines that task — but relying on that alone is fragile: it depends on an under-documented, version-sensitive edge case (distinct from the well-established "skip this package for this task" behavior when *some* packages define a task and others don't), and it doesn't match the spec's own framing of a real command that could report a genuine failure. A guaranteed-exit-0 stub script gives the step something concrete to execute today, satisfies FR-005 without depending on the riskier all-packages-skip behavior, and fails correctly the moment a real test command replaces the stub and that command reports a failure. It deliberately does not choose a test framework (Jest, Vitest, or otherwise) — that choice has real, longer-lived implications (conventions, mocking, coverage tooling) and belongs to a future feature that actually adds test coverage, consistent with the spec's Assumptions explicitly scoping that out.

**Alternatives considered**:
- *Rely solely on Turborepo's zero-packages-define-this-task no-op.* Rejected: less reliable, and no package actually has a `test` command to point FR-010 at.
- *Install a real test framework (Jest or Vitest) now, even with no real tests.* Rejected: this is a framework-selection decision with consequences well beyond CI plumbing, and the spec's Assumptions explicitly place "adding actual test coverage" out of scope for this feature.

## 4. Preventing a superseded run from misrepresenting PR status

**Decision**: `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` at the workflow level.

**Rationale**: FR-011 requires that a run superseded by a newer commit on the same PR must not continue to block or misrepresent the PR's current status. GitHub Actions' `concurrency` key is the standard mechanism for this: pushing a new commit to the same ref cancels any still-running workflow run for that ref and starts a fresh one. This does not create a branch-protection hazard — required-status-checks evaluation only considers check runs associated with the PR's *current* head SHA, and a cancelled run belongs to the previous, now-irrelevant SHA, so it cannot linger and block merge. Because all four verification jobs live in the same workflow run, they are cancelled and superseded together as a unit — there is no risk of a partially-stale mix of old and new job results for the same PR.

**Alternatives considered**: Leaving concurrent runs to complete independently and relying on "most recent run wins" at the branch-protection level. Rejected: this still lets a slow, stale run's checks remain visible (if not authoritative) on the PR for longer than necessary, and wastes CI minutes on work whose result no longer matters.

## 5. Fork pull request safety (FR-012)

**Decision**: The workflow uses the standard `pull_request` trigger (not `pull_request_target`), and declares an explicit top-level `permissions: contents: read` block.

**Rationale**: The repository is public, so pull requests from forks are a realistic scenario. `pull_request_target` runs with the base repository's context and token even for fork-submitted code, which is the well-documented GitHub Actions privilege-escalation pattern — unnecessary here since this pipeline needs no secrets. The explicit `permissions` block is not merely defensive: GitHub's automatic read-only token restriction for fork contributions applies *only* to `pull_request`-triggered runs that actually originate from a fork. It does not reduce the token's scope for same-repository pull requests or for this same workflow's FR-002 push-to-`main` runs, both of which would otherwise fall back to the repository's default `GITHUB_TOKEN` permission setting (commonly broader than read-only). Declaring `permissions: contents: read` at the workflow level closes that gap for every trigger this workflow handles, not just fork PRs.

**Alternatives considered**: `pull_request_target` with manual guarding against checking out fork code in privileged steps. Rejected: adds real risk and complexity for a pipeline that has no legitimate use for elevated access in the first place.

## 6. Branch protection configuration

**Decision**: Branch protection (FR-004) is a live GitHub repository setting, not something expressible inside the workflow YAML itself. The exact required-check names this feature produces (`typecheck`, `lint`, `test`, `build`) are documented as the contract branch protection must reference (see `contracts/required-checks.md`), along with the exact `gh api` command to apply it. Applying that command against the real, live repository is treated as a distinct, explicitly-confirmed action during `/speckit-implement` — not something this planning phase authorizes in advance.

**Rationale**: Branch protection changes how every future pull request on the repository behaves; it is a shared, hard-to-reverse setting affecting collaborators beyond this feature's own scope, which warrants explicit confirmation at the point it's actually applied rather than a blanket authorization decided during planning.

**Alternatives considered**: Managing branch protection as code (e.g., via a settings-as-code tool or future Pulumi/GitHub provider resource). Rejected for this feature: introducing infrastructure-as-code for repository settings is a larger decision than this CI-pipeline spec's scope, and ADR-004 (Pulumi) is scoped to cloud infrastructure, not GitHub repository administration.
