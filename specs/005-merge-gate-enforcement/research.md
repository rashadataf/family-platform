# Research: Merge Gate Enforcement

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-08

Three findings changed the shape of this feature before any code was written. They are recorded first because two of them reduce its scope and one of them is a decision the founder has not yet consciously taken.

---

## 0. The repository is public — and that has already been paying for two of these gates

**Finding.** `gh repo view` reports `visibility=PUBLIC`. Consequently:

| Capability | Status | Cost |
|---|---|---|
| GitHub secret scanning | **already enabled** | free on public repositories |
| Secret scanning **push protection** | **already enabled** | free |
| Dependabot alerts | **disabled** | free — should be turned on |
| Actions minutes | unlimited | free |

Push protection is materially stronger than the CI gate this specification asked for. It rejects the push, so a detected credential never enters history at all — whereas a CI check fires *after* the secret is already published, at which point rotation is the only remedy. Half of FR-009 is therefore already satisfied, by a mechanism better than the one the spec envisaged.

**This is worth the founder's explicit attention, and it is not a scope item.** A public repository is a legitimate choice, but nothing in this repository records it as a decision. Three consequences follow that a project holding children's data should have decided on purpose rather than inherited:

1. Anything ever committed is permanently public. Rewriting history does not un-publish it.
2. `ARCHITECTURE.md`, the constitution and every ADR are public today — including, eventually, the exact shape of the family-isolation and authorization controls in Principle V.
3. Automated scrapers harvest public commits for credentials within seconds of a push.

None of these makes public wrong. Plenty of security-conscious products are open source, and the discipline of assuming your source is readable is a good one. But it deserves an ADR, or at minimum a line in the README, so that a future contributor knows it was chosen. **Recommended as a follow-up, not part of this feature.**

---

## 1. Boundary validation: `dependency-cruiser` with `allowed`, plus `eslint-plugin-boundaries`

**Decision.** `dependency-cruiser` as the authoritative gate, configured with an **`allowed`** rule set rather than only `forbidden` rules, plus `eslint-plugin-boundaries` for in-editor feedback.

**Rationale.** FR-006 requires fail-closed: a package with no rule covering it is a violation. A `forbidden`-only configuration cannot express that — it enumerates what is banned, so anything unmentioned passes. `dependency-cruiser`'s `allowed` section inverts this: a dependency matching no `allowed` rule is reported, which is precisely default-deny. That single configuration choice is what separates a rule set that will still mean something when `packages/core` arrives from one that quietly permits every new context.

Cycle detection (FR-002) is the same tool's `no-circular` rule, and it sees what a per-file linter structurally cannot: a cycle spanning four files across three packages. ARCHITECTURE §8.2 already names both tools; this feature is implementing a decision, not taking one.

`eslint-plugin-boundaries` is retained alongside it for FR-004 rather than as a duplicate gate. Its value is latency, not coverage — it marks the violating import in the editor as it is typed, where `dependency-cruiser` reports after a push.

**Alternatives considered.**

- *`forbidden` rules only* — simpler, and the common configuration. Rejected on FR-006 alone: it fails open, and since most rules here govern packages that do not exist yet, a fail-open rule set would be almost entirely decorative until the first bounded context lands.
- *ESLint `no-restricted-imports` zones only* — no new dependency, and the constitution mentions it. Rejected as the gate because ESLint's per-file view cannot detect a cycle spanning packages, which FR-002 requires.
- *Enforcing purely through `package.json` dependency absence* (ARCHITECTURE §8.2's strongest layer) — genuinely the strongest mechanism, and already in force. It is not a substitute: it cannot express intra-package rules such as "`core/family/domain` may not import `core/calendar/domain`", which is exactly what a nine-context `packages/core` needs.

---

## 2. Secret scanning: GitHub push protection as primary, `gitleaks` as the second layer

**Decision.** Keep GitHub's push protection as the primary control. Add `gitleaks` as a CI job scanning the pull request's changes.

**Rationale.** They fail differently, which is the entire argument for having both. GitHub's scanner matches *partner patterns* — provider-issued token formats it has been taught, with very low false positives. It will not flag `DATABASE_URL=postgresql://postgres:aRealPassword@host/db`, which is not a partner pattern but is exactly the shape of credential this repository handles (ADR-013 puts VPS and database credentials in play). `gitleaks` matches generic high-entropy and assignment patterns and catches that class.

Push protection is also bypassable by the pusher with a documented reason; a CI gate is not.

FR-014 — no false positives on the committed `.env.example` — is handled by an allowlist entry for that path, which is honest: the file's entire purpose is to hold fake values, and a scanner that fails on it gets switched off within a week.

FR-015's split falls out naturally: `gitleaks` scans the PR diff as a **gate**, and a separate scheduled full-history scan produces an **audit** result. Blocking every merge on a secret already published in a public repository would be theatre — it is already harvested; rotation is the remedy.

**Alternatives considered.**

- *`gitleaks` only* — one tool, one mental model. Rejected because push protection already exists, is already on, costs nothing, and stops secrets *before* they are published rather than after.
- *`trufflehog`* — verifies candidate secrets by calling the provider, which sharply reduces false positives. Rejected for now: it makes network calls with candidate credentials, which is a larger behaviour to reason about than this feature needs, and `gitleaks` is sufficient as a second layer behind push protection.

---

## 3. Dependency vulnerabilities: `osv-scanner` as the gate, Dependabot alerts as the safety net

**Decision.** `osv-scanner` (Google, free, OSS) as the blocking CI gate reading `pnpm-lock.yaml`. Enable Dependabot alerts, which are currently **off**, as the out-of-band notifier.

**Rationale.** These answer different questions. A CI gate answers "does *this change* introduce a known-vulnerable dependency" and blocks the merge. Dependabot alerts answer "has anything we already shipped become vulnerable since" — which no pull-request gate can ever catch, because nothing changed on our side. Having only the gate means a vulnerability disclosed tomorrow against a dependency merged today goes unnoticed until someone happens to open a PR.

`osv-scanner` is preferred over `pnpm audit` because it reads the lockfile directly against the OSV database, understands pnpm workspaces, and produces machine-readable output with a documented ignore format that carries an expiry date — which FR-013 requires and `pnpm audit` cannot express.

FR-013's expiry is the load-bearing detail: `osv-scanner`'s `osv-scanner.toml` supports `ignore` entries with `until` dates, so a suppression genuinely expires rather than accumulating in a file nobody re-reads. That mirrors the constitution's own governance rule that an exception without an expiry must not be granted.

**Alternatives considered.**

- *`pnpm audit --audit-level=high`* — zero new tooling, already available. Rejected on FR-013: it has no expiring-suppression mechanism, so accepted risks would either block forever or be silenced permanently. Retained as a cheap secondary if desired, but not as the gate.
- *Dependabot alerts alone* — free and native. Rejected as the gate because alerts notify; they do not block a merge, and the constitution's table requires a blocking gate.

---

## 4. Container image scanning: `trivy`

**Decision.** `trivy` scanning the `runtime` image built by spec 004's existing `image` job, failing on HIGH and CRITICAL operating-system and library findings.

**Rationale.** FR-016 exists because the image, not the source tree, is what ADR-013 transfers to a VPS. `osv-scanner` reads the lockfile and therefore sees application dependencies only; it cannot see the Debian packages in the base layer, which are a real source of CVEs and are updated on a completely different cadence. The `image` job already builds the artifact, so scanning it there costs one step rather than a new build.

**Alternative considered.** *`grype`* — comparable coverage and quality. `trivy` chosen for scanning image, filesystem and config in one tool, leaving room to fold in Dockerfile misconfiguration checks later without adding another dependency.

---

## 5. Dependency updates: Dependabot, not Renovate — and the reason is constitutional

**Decision.** Dependabot version updates via `.github/dependabot.yml`, covering the pnpm workspace and the GitHub Actions ecosystem, with grouping.

**Rationale.** Renovate is the better tool on the merits: richer grouping, better monorepo handling, more precise scheduling. It is rejected anyway, and not on features.

Renovate's practical form is the Mend-hosted GitHub App. Installing it grants a third-party service read and write access to this repository. The constitution is unambiguous: *"Adding an external **service**, meaning anything that receives our data, requires an ADR and a privacy review before use."* Dependabot is GitHub's own, operating inside a platform that already holds the source; it adds no vendor.

Choosing the second-best tool to avoid a new external service and an ADR-and-privacy-review cycle for *dependency update pull requests* is the correct trade. Self-hosted Renovate would avoid the vendor question but adds a scheduled workflow and its own configuration surface to maintain — more moving parts than the problem justifies at this size.

Dependabot's `groups:` configuration satisfies FR-027, and its `github-actions` ecosystem support satisfies FR-026.

**Alternatives considered.**

- *Mend-hosted Renovate* — rejected above. Recorded rather than dismissed: if Dependabot's grouping proves inadequate, self-hosted Renovate is reconsiderable, and only the hosted form triggers the external-service rule.
- *Manual updates* — rejected. FR-025 pins actions immutably, and a pin nobody updates is a component that silently stops receiving security patches. Pinning without automation is worse than not pinning.

---

## 6. Action pinning: commit SHAs, kept current by Dependabot

**Decision.** Every third-party action referenced by full commit SHA with the human-readable version in a trailing comment; Dependabot's `github-actions` ecosystem proposes the bumps.

**Rationale.** A tag is mutable: `actions/checkout@v4` can be repointed by whoever controls that repository, which is a supply-chain path into a pipeline that has repository write access. A SHA cannot. The trailing comment exists because a bare 40-character hash is unreviewable, and Dependabot maintains both parts.

This closes the loop FR-026 describes: pinning creates staleness risk, and the automation is what removes it. Neither half is worth shipping alone.

---

## 7. Integration test harness: a dedicated database on the existing Postgres, not Testcontainers

**Decision.** A separate `family_platform_test` database on the PostgreSQL instance that already exists in all three environments, migrated at suite start, with per-test isolation by transaction rollback. Test tiers separated using Vitest's `projects` configuration (Vitest 5.0.0 is already installed).

**Rationale.** The requirement that decides this is FR-020: the same command must work in the container path, on the host path, and in CI. Postgres is already present in all three — Compose provides it locally on both paths, and CI already runs it as a service container in spec 004's `image` job. Adding a second mechanism to obtain a database that already exists is unnecessary work.

A *separate database* rather than the development one satisfies FR-018 without touching a developer's working data — a suite that truncates the database you were just using teaches people not to run it.

Transaction-rollback isolation gives each test clean state at negligible cost and makes the parallelism edge case moot: tests share an instance but never observe each other's uncommitted work. Where a test genuinely must commit, it opts into truncation explicitly.

**Alternatives considered.**

- *Testcontainers* — the usual answer, and genuinely good: a disposable, correctly-versioned database per run with no shared state. Rejected on FR-020. The containerized development path from spec 004 would have to run Docker *inside* a container to use it, which means either mounting the host Docker socket into the dev container — a meaningful privilege escalation, since socket access is effectively host root — or accepting that the integration suite does not run on the path this project just made the supported one. Neither is acceptable for a benefit already available.
- *A fresh database per test file* — stronger isolation than transactions. Rejected as premature: it costs a create-and-migrate cycle per file, and transaction rollback is sufficient until a test genuinely needs committed state across connections.
- *SQLite for speed* — rejected outright. The constitution requires a real database precisely because row-level security and Postgres constraints are the thing being verified, and neither exists in SQLite.

---

## 8. CI structure: two new jobs, no renames, and reconciling required checks

**Decision.** Two new jobs, `boundaries` and `security`; integration tests as a new `test-integration` job; `trivy` as a step inside the existing `image` job. No existing job is renamed.

**Rationale.** FR-028 exists because branch protection names required checks by job name — spec 004 established this the hard way. Adding `trivy` as a *step* inside `image` rather than as its own job follows the same reasoning that put the Node drift check inside `verify-env`: the job already builds the artifact being scanned, and fewer required-check names is fewer things to keep synchronised.

`test-integration` is separate from `test` because the constitution's own gate table lists unit and integration tests as separate rows, and because FR-021 requires the unit tier to stay fast and database-free. One job would make the fast tier as slow as the slow one.

FR-029 and SC-010 are the operational half. The repository currently runs seven checks and requires four: `format`, `verify-env` and `image` all pass and none can block anything. Each new job must report green once before being added to the required list, and the final state must be that the two lists match exactly — every reporting blocking check required, and no required check that does not report.

**Final required set on completion**: `typecheck`, `lint`, `format`, `test`, `test-integration`, `verify-env`, `boundaries`, `security`, `build`, `image` — ten checks against the constitution's nine gate rows, the extra being formatting, which the table does not list but `pnpm verify` has always run locally.
