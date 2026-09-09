# Contract: Gates, Commands and Configuration

**Feature**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md)

No product API. This feature's interface is the set of CI checks, the commands a contributor runs, and the configuration files that govern them. Everything here is depended on by a human, by branch protection, or by both — changing it is a breaking change.

---

## 1. CI jobs

### Frozen — names must not change (FR-028)

| Job | Runs | Change in this feature |
|---|---|---|
| `typecheck` | `turbo run typecheck typecheck:workspace-root` | none |
| `lint` | `turbo run lint lint:workspace-root` | none |
| `format` | `prettier --check .` | none |
| `test` | `pnpm test` → `vitest run --project unit` | **unit tier only** — database-free, 0.72s measured |
| `verify-env` | `verify:env`, `verify:node-version`, `verify:action-pins`, `verify:workspace` | **+2 steps** (job name unchanged) |
| `build` | `turbo run build` | none |
| `image` | builds/asserts/smoke-tests the runtime image | **+ one step**: `trivy` scan |

> Branch protection names required checks by **job name**. Renaming any row above blocks every subsequent merge on a check that no longer reports. This is not a style preference; spec 004 established it the hard way.

### New

| Job | Blocks on | Notes |
|---|---|---|
| `boundaries` | Any dependency not in the `allowed` set; any cycle | Fail-closed by construction |
| `security` | A secret in the diff; a HIGH/CRITICAL advisory in the lockfile | `gitleaks` + `osv-scanner` |
| `test-integration` | A failing test against a real database | Separate from `test` so the unit tier stays fast |

### Required-check list

**Current (4 of 10 reporting):** `typecheck`, `lint`, `test`, `build`
**Target (10):** the seven above plus `boundaries`, `security`, `test-integration`

Each new job joins the list **only after reporting green at least once** (FR-029). Reconciling this is part of the feature (SC-010), and it is repository configuration rather than a file in this repository — see §4.

---

## 2. Contributor commands

| Command | Does | Requires a database |
|---|---|---|
| `pnpm boundaries` | Validate the allowed-edge graph and detect cycles | no |
| `pnpm test` | Unit tier only — fast | no |
| `pnpm test:integration` | Integration tier against a real database | **yes** |
| `pnpm verify` | Everything above plus existing checks | yes |

Both development paths, identical commands (FR-020):

```sh
# containerized path (spec 004)
docker compose run --rm api pnpm test:integration

# host path (spec 001)
pnpm test:integration
```

`pnpm test` must remain runnable with **no database at all** (FR-021). If it starts needing one, the tiers have leaked into each other.

---

## 3. Configuration files

| File | Owns | Notes |
|---|---|---|
| `.dependency-cruiser.cjs` | The allowed-edge graph | `allowed` + `allowedSeverity: error` = default deny. **No per-line suppression** (FR-007) |
| `packages/config-eslint/boundaries.js` | Editor-time import zones | Latency, not coverage — `dependency-cruiser` remains authoritative |
| `osv-scanner.toml` | Vulnerability suppressions | Every entry carries an **expiry** (`ignoreUntil`), enforced by `verify:suppressions` — osv-scanner treats it as optional |
| `.gitleaks.toml` | Secret-scan rules and allowlist | Adds `database-connection-string-password`, which the default rule set lacks. Placeholders allowlisted **by value**, not by file |
| `.github/dependabot.yml` | Update policy | `npm`, `github-actions` and `docker` ecosystems, grouped. Does **not** cover the scanner image digests in `run:` steps |
| `vitest.config.ts` | Test tier split | `projects`: `unit`, `integration`. Integration uses `globalSetup`, not `setupFiles` — the Prisma client is built at import time |

**Changing an architectural boundary is an edit to `.dependency-cruiser.cjs`** — a reviewable diff in one file, never a comment silencing one line.

---

## 4. What is not code, and is not pretended to be

Branch protection's required-check list lives in GitHub, not in this repository. There is no file here that makes it self-enforcing, and Principle X's "infrastructure is code" cannot be fully honoured for it.

Naming that is better than hiding it. The reconciliation command:

```sh
gh api -X PATCH repos/rashadataf/family-platform/branches/main/protection/required_status_checks \
  --input - <<'JSON'
{"strict": false,
 "contexts": ["typecheck","lint","format","test","test-integration",
              "verify-env","boundaries","security","build","image"]}
JSON
```

Verify with:

```sh
gh api repos/rashadataf/family-platform/branches/main/protection/required_status_checks --jq '.contexts'
```

**The invariant (SC-010):** every reporting blocking check is required, and every required check reports. A required check that never reports blocks all merges forever; a blocking check that is not required blocks nothing — which is the state three checks are in today.

---

## 4a. Reconciliation against the constitution's gate table (SC-009)

Read row by row, not assumed. Seven of nine rows now map to a named check.

| Constitution gate row | Check | Before this feature |
|---|---|---|
| Typecheck, strict mode, zero errors | `typecheck` | existed |
| Lint, zero warnings | `lint` | existed |
| Boundary and cycle validation | `boundaries` | **nothing** |
| Unit tests | `test` | existed |
| Integration tests against a real database | `test-integration` | **nothing** |
| Contract and API tests, incl. cross-family authorization | **none** | nothing |
| Security scan: dependency vulnerabilities and secret scanning | `security`, plus `trivy` in `image` | **nothing** |
| Infrastructure validation and preview | **none** | nothing |
| Build of all applications | `build` | existed |

**Two rows still have no check, and this is stated rather than ticked.**

- *Contract and API tests, including cross-family authorization assertions.* There is no product API, no `packages/contracts` and no authorization to assert against. A check here would be an empty suite reporting green, which is worse than an acknowledged gap: it would make the table look complete. This row closes with the first bounded context, and Principle V's assertions are the reason the harness this feature just built exists.
- *Infrastructure validation and preview.* No infrastructure-as-code exists yet. Spec 003 (VPS staging) is parked, and ADR-004 was amended by ADR-013. This row closes when spec 003 resumes.

So SC-009 is met for every row whose subject exists, and the two that remain are blocked on features rather than on this one. That is the honest reading; claiming nine of nine would require two vacuous checks.

## 4b. SC-010 is not yet met

Four checks are required; ten report. `format`, `verify-env`, `image`, `boundaries`, `security` and `test-integration` can all block and none of them does.

This closes with the §4 command, **after** the six new and newly-reporting checks have each reported green at least once. Adding a check to the required list before it has ever reported blocks every merge forever on a check that never arrives — which is the ordering constraint, not caution for its own sake.

## 5. Out of scope

- **Product code.** No bounded context, no domain, no repository implementation. This feature writes the rules that will govern them.
- **The public-repository decision.** Research §0 recommends an ADR recording it deliberately; that is a follow-up.
- **Spec 003.** Unchanged and still parked.
- **`enforce_admins`.** Currently `false`, so an admin can merge past a red check. Out of scope, but worth knowing it is the case.
