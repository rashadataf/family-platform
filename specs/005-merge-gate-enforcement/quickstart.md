# Quickstart: Validating Merge Gate Enforcement

**Feature**: [spec.md](spec.md) | **Contract**: [contracts/gates-and-config.md](contracts/gates-and-config.md)

Every scenario below proves a gate by **making it fail on purpose**. A gate verified only by watching it pass is a gate you have not tested — you have confirmed it runs, not that it catches anything.

---

## Prerequisites

Docker (per [ADR-014](../../adr/ADR-014-containerized-development.md)). The host toolchain is optional. Scenarios 2 and 3 need a branch you can push.

---

## Scenario 1 — A boundary violation fails (FR-001, FR-003, SC-001)

```sh
pnpm boundaries          # passes
```

Now break it deliberately — import the Prisma client from somewhere it is forbidden:

```sh
echo "import { PrismaClient } from '@prisma/client';" >> apps/api/src/main.ts
pnpm boundaries          # MUST fail
```

**Expected:** failure naming the rule (`persistence-client-is-private`), the file (`apps/api/src/main.ts`) and the import target. A failure that says only "boundary violation" does not satisfy FR-003.

```sh
git checkout apps/api/src/main.ts
```

---

## Scenario 2 — Fail-closed: a new package with no rule fails (FR-006, SC-002)

**The single most important scenario here.** Most boundary rules govern packages that do not exist yet, so if an unmentioned package passes, the rule set is decorative.

Conveniently, this feature creates one. Add `packages/testing` **before** writing its `allowed` entry:

```sh
pnpm boundaries          # MUST fail — packages/testing is not in the allowed set
```

Then add the entry and re-run:

```sh
pnpm boundaries          # passes
```

**If the first run passes, the configuration is fail-open and FR-006 is not met.** Do not proceed on the assumption it will work later.

---

## Scenario 3 — A cycle is caught, whole (FR-002)

Create a two-file cycle inside one package, then run `pnpm boundaries`.

**Expected:** failure printing the **complete cycle**, not one edge. Then delete both files. A cycle spanning several packages is the case a per-file linter structurally cannot see — this is why `dependency-cruiser` is the authority and ESLint is only editor feedback.

---

## Scenario 4 — A planted secret is blocked (FR-009, FR-010, SC-003)

> Use an obviously fake but credential-shaped value. Never a real credential — **this repository is public** (research §0).

```sh
git checkout -b throwaway/secret-probe
printf 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n' > /tmp/probe.env
git add -f /tmp/probe.env && git commit -m "probe: do not merge"
git push origin throwaway/secret-probe
```

**Two things must happen, and they are different controls:**

1. **Push protection** (already enabled) may reject the push outright — the stronger outcome, since the secret never enters history.
2. If the push succeeds, the **`security` job must fail** on the pull request.

**Also check:** the failure output identifies the file and location but **does not reproduce the secret value** (FR-010). A scanner that prints what it found into a public build log has moved the secret somewhere more accessible than where it started.

```sh
git push origin --delete throwaway/secret-probe
git checkout main && git branch -D throwaway/secret-probe
```

---

## Scenario 5 — No false positive on `.env.example` (FR-014, SC-005)

```sh
pnpm exec gitleaks detect --no-git --config .gitleaks.toml
```

**Expected: clean.** `.env.example` holds deliberately fake values and is allowlisted by path. A security gate that fails on its own repository's fixtures gets switched off within a week, and then it protects nothing.

---

## Scenario 6 — A vulnerable dependency is blocked (FR-011, FR-012, SC-004)

On a throwaway branch, add a dependency with a known HIGH advisory, install, and push.

**Expected:** the `security` job fails, naming the package, the advisory ID and the fixed version if one exists.

**Then test the suppression, which is the part that usually rots.** Add an `osv-scanner.toml` entry with an expiry **in the past**:

```sh
pnpm exec osv-scanner --lockfile pnpm-lock.yaml    # MUST still fail — expiry has passed
```

An expiry that does not re-fail is a permanent silence with extra steps (FR-013).

---

## Scenario 7 — Integration tests run identically everywhere (FR-017 – FR-021, SC-006, SC-007)

```sh
# containerized path
docker compose run --rm api pnpm test:integration

# host path
pnpm test:integration
```

**Expected:** both connect to a real PostgreSQL, see every committed migration, and pass — same command, no path-specific flags.

Then prove the tiers are actually separate:

```sh
docker compose down          # no database anywhere
pnpm test                    # MUST still pass, in under 30 seconds
```

**If `pnpm test` needs a database, the tiers have leaked** and SC-007 is not met.

---

## Scenario 8 — A failing integration test fails the build (FR-023)

Change an assertion in the integration test so it must fail. Run the suite and confirm a **non-zero exit**, then confirm the `test-integration` job fails on a pull request. Revert.

A harness whose failures do not propagate is worse than no harness: it produces a green check that means nothing, which is the vacuous-gate problem this project already fixed once.

---

## Scenario 9 — The runtime image is scanned (FR-016)

Confirm the `image` job runs `trivy` against the built runtime image and fails on HIGH/CRITICAL. `osv-scanner` reads the lockfile and sees **application dependencies only** — it cannot see the Debian packages in the base layer, which are on a completely different update cadence and are what ADR-013 ships to a VPS.

---

## Scenario 10 — Dependabot is alive and pins do not rot (FR-024 – FR-027)

```sh
grep -rn "uses:" .github/workflows/ .github/actions/ | grep -v "@[0-9a-f]\{40\}"
```

**Expected: no output.** Any line printed is an action still pinned to a mutable tag (FR-025).

Then confirm `.github/dependabot.yml` includes the `github-actions` ecosystem — without it, SHA pins are never updated and pinning becomes staleness (FR-026) — and that updates are grouped (FR-027).

---

## Scenario 11 — The two lists match (SC-009, SC-010)

```sh
gh api repos/rashadataf/family-platform/branches/main/protection/required_status_checks --jq '.contexts'
gh pr checks <any-open-pr> | awk '{print $1}'
```

**Expected:** every reporting blocking check appears in the required list, and every required check reports. Neither list contains an entry the other does not.

Then read the required list against the constitution's merge-gate table, row by row. **Every row must map to a check.** That is this feature's entire purpose, and it is verified by reading the two lists side by side — not by trusting that it happened.

> Today: seven checks report, four are required. `format`, `verify-env` and `image` block nothing.
