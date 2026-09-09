# Data Model: Merge Gate Enforcement

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

No product data. The entities here are the artifacts spec.md names — rule sets, gates, suppressions, the test harness and the update policy — with the rules that make each valid.

---

## 1. Boundary Rule Set (`.dependency-cruiser.cjs`)

The single artifact an architectural change edits (FR-008).

### Structure

| Section | Purpose |
|---|---|
| `allowed` | **The default-deny core.** Any dependency matching no entry is reported. This is what makes FR-006 real. |
| `allowedSeverity` | `error`, so an unmatched dependency fails the build rather than warning. |
| `forbidden` | Named rules whose violation messages explain *which architectural rule* was broken — better diagnostics than "not in allowed set". |
| `options` | TypeScript resolution, workspace awareness, `node_modules` and `dist` exclusions. |

### Rules encoding ARCHITECTURE §6/§7 (FR-005)

| Rule | Meaning | Governs |
|---|---|---|
| `no-circular` | No dependency cycle of any length | everything |
| `domain-is-pure` | `core/*/domain/**` may not import a framework, ORM, cloud SDK, HTTP client, clock or RNG | future |
| `no-cross-context-internals` | A context may not import another context's `domain/` or repositories; only published `application/ports/**` | future |
| `contracts-are-standalone` | `packages/contracts` may not import domain or application code | future |
| `persistence-client-is-private` | The Prisma client is not importable outside `packages/persistence` | **today** |
| `nothing-depends-on-ai` | No package outside `packages/ai` may depend on it | future |
| `no-orphan-packages` | A workspace package with no `allowed` entry is a violation | **today** |

Most govern packages that do not exist yet. They are written now because FR-006 makes an unmentioned package fail, so the rules must be in place *before* the package arrives rather than after.

### Validation rules

| Rule | Why |
|---|---|
| A dependency matching no `allowed` entry fails | FR-006, fail closed |
| A violation names rule, source file and import target | FR-003 |
| No per-line suppression mechanism is available | FR-007 — a rule that can be silenced by a comment is the layer the constitution ranks lowest |
| Adding a context is one edit to this file | FR-008 |

---

## 2. Gate

A CI check that runs on every proposed change and can block a merge. **Its name is part of its identity**, because branch protection refers to it by that name (FR-028).

| Job | Status | Blocks on |
|---|---|---|
| `typecheck` `lint` `format` `test` `verify-env` `build` `image` | existing — **names frozen** | unchanged |
| `boundaries` | **new** | allowed-edge violation, or any cycle |
| `security` | **new** | leaked secret in the diff; HIGH/CRITICAL advisory in the lockfile |
| `test-integration` | **new** | a failing test against a real database |
| *(step inside `image`)* | **new step** | HIGH/CRITICAL OS or library CVE in the runtime image |

### Lifecycle rule (FR-029)

```
job added ──► reports green at least once ──► added to required-check list
                        │
                        └── added to the list before this point:
                            every merge blocks forever on a check that never arrives
```

### Reconciliation invariant (SC-010)

Two lists must match exactly: *checks that report and can block* and *checks named as required*. Today they do not — `format`, `verify-env` and `image` report green and are not required, so they block nothing.

---

## 3. Suppression

A recorded, **time-bound** acceptance of one finding. Cannot be permanent (FR-013).

| Field | Required | Notes |
|---|---|---|
| identifier | yes | advisory ID or finding location |
| reason | yes | why accepted — typically "no fix published" |
| expiry | **yes** | after this date the finding fails again |

Lives in `osv-scanner.toml` (`ignore` entries with `until`) and `.gitleaks.toml` (path allowlist).

| Rule | Why |
|---|---|
| An entry without an expiry is invalid | Mirrors the constitution's own governance rule: an exception without an expiry MUST NOT be granted |
| Expiry passing re-fails the build | Otherwise the file becomes a graveyard nobody re-reads |
| `.env.example` is allowlisted by path | FR-014 — its values are deliberately fake, and a scanner that cries wolf on the repository's own fixtures gets switched off |

**Distinction worth preserving:** the `.env.example` entry is a *permanent* statement about a file whose purpose is to contain fake values. A vulnerability entry is a *temporary* acceptance of real risk. Only the second needs an expiry, and conflating them would either make the fixture allowlist expire pointlessly or let real risk sit unbounded.

---

## 4. Integration Test Harness (`packages/testing`)

| Element | Responsibility |
|---|---|
| `database.ts` | Ensure `family_platform_test` exists and carries every committed migration. Once per run. |
| `transaction.ts` | Open a transaction per test, roll back after. Clean state at negligible cost. |
| `index.ts` | The exported surface a test uses. |

### Test tiers (`vitest.config.ts` `projects`)

| Tier | Database | Speed target | CI job |
|---|---|---|---|
| `unit` | **none** | under 30s (SC-007) | `test` (existing name) |
| `integration` | real Postgres | no target | `test-integration` (new) |

### Validation rules

| Rule | Why |
|---|---|
| A separate database from development | FR-018 — a suite that truncates the database you were just using teaches people not to run it |
| Migrated from committed migrations only | Same mechanism as everywhere else (ADR-003) |
| Each test starts clean | FR-018 |
| Same command on both local paths and CI | FR-020 — this requirement is what rejected Testcontainers |
| Unit tier runs with no database present | FR-021 |
| A failing integration test fails the pipeline | FR-023 — a harness whose failures do not propagate is worse than none |

---

## 5. Dependency Update Policy (`.github/dependabot.yml`)

| Ecosystem | Purpose |
|---|---|
| `npm` (pnpm workspace) | Application and tooling dependencies |
| `github-actions` | **Keeps SHA pins current** — without this, pinning decays into staleness |

| Rule | Why |
|---|---|
| Updates grouped | FR-027 — ungrouped updates bury real work |
| Actions ecosystem included | FR-026 — the half that makes pinning safe rather than stale |
| Every third-party action pinned by commit SHA with a version comment | FR-025 — a tag is mutable and is a supply-chain path into a pipeline with write access; the comment exists because a bare hash is unreviewable |
