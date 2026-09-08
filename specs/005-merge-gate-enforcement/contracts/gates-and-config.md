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
| `test` | `turbo run test test:workspace-root` | **unit tier only** — must stay database-free and under 30s |
| `verify-env` | `verify:env`, `verify:node-version` | none |
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

**Current (4 of 7 reporting):** `typecheck`, `lint`, `test`, `build`
**Target on completion (10):** the seven above plus `boundaries`, `security`, `test-integration`

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
| `osv-scanner.toml` | Vulnerability suppressions | Every entry carries an **expiry** |
| `.gitleaks.toml` | Secret-scan allowlist | Path allowlist for `.env.example`, whose values are deliberately fake |
| `.github/dependabot.yml` | Update policy | `npm` + `github-actions` ecosystems, grouped |
| `vitest.config.ts` | Test tier split | `projects`: `unit`, `integration` |

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

## 5. Out of scope

- **Product code.** No bounded context, no domain, no repository implementation. This feature writes the rules that will govern them.
- **The public-repository decision.** Research §0 recommends an ADR recording it deliberately; that is a follow-up.
- **Spec 003.** Unchanged and still parked.
- **`enforce_admins`.** Currently `false`, so an admin can merge past a red check. Out of scope, but worth knowing it is the case.
