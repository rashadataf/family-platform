# Contract: Deploy CLI, Stack Config, and CI Trigger Surface

This feature exposes no HTTP API. Its interface is a small set of commands, a typed stack
configuration schema, and the conditions under which CI invokes them. This document is the
contract other tooling (CI, the founder's shell) and future features may depend on.

## Commands (root `package.json` scripts)

| Script | Underlying Pulumi invocation | Who runs it | FR |
|---|---|---|---|
| `pnpm staging:preview` | `pulumi preview --cwd infrastructure --stack vps-staging` | CI, on every pull request | supports "Infrastructure validation and preview" merge gate |
| `pnpm staging:deploy` | `pulumi up --cwd infrastructure --stack vps-staging --yes` | Founder (ad hoc), CI (on push to `main`) | FR-007, FR-019 |
| `pnpm staging:deploy:reset` | `pulumi up --cwd infrastructure --stack vps-staging --yes --config resetData=true` | Founder only (never CI) | FR-012 |
| `pnpm staging:destroy` | `pulumi state unprotect --cwd infrastructure --stack vps-staging --all --yes && pulumi destroy --cwd infrastructure --stack vps-staging --yes` | Founder only (never CI) | FR-007, FR-013, FR-020 |

**Exit codes**: every script exits non-zero on any failure (a failed migration, an unreachable
VPS, an SSH auth failure) and MUST NOT exit zero while leaving the staging URL unready — this is
what makes the CI job's success/failure signal trustworthy (FR-009, edge case: "an automatic
CI-triggered deploy fails after merge").

## Stack configuration schema

See [data-model.md](../data-model.md)'s `StackConfig` for the full field list, types, and
validation rules. Contract-relevant points:

- Every field is read once, at program start, through a single Zod schema — `infrastructure/src/config.ts` — mirroring `apps/api/src/config/env.schema.ts`'s pattern. A caller (human or CI) that provides an invalid or missing required value gets a specific, named error before any resource is touched, not a partial deploy.
- Secret fields (`vpsSshPrivateKey`, `postgresPassword`) are set once via `pulumi config set --secret <key> <value>` against the `vps-staging` stack and are never passed as CLI arguments to the scripts above — only `resetData` is ever passed inline, and it is not a secret.

## CI trigger contract

Extends `.github/workflows/ci.yml` (spec 002) with two new jobs:

| Job | Trigger | Depends on | Secrets required |
|---|---|---|---|
| `infra-preview` | `pull_request` → `main` (existing trigger) | none | `PULUMI_ACCESS_TOKEN` |
| `infra-deploy` | `push` → `main` (existing trigger) | `typecheck`, `lint`, `test`, `build` (existing jobs) | `PULUMI_ACCESS_TOKEN` |

`infra-preview` runs `pnpm staging:preview` and never mutates the staging environment — safe to
run against the one shared stack from any pull request branch. `infra-deploy` runs
`pnpm staging:deploy` only after every existing quality gate has already passed on the merged
commit, satisfying FR-019 without weakening spec 002's existing gates. Neither job ever runs
`pnpm staging:destroy` or `pnpm staging:deploy:reset` — those remain founder-invoked only
(FR-020).

`PULUMI_ACCESS_TOKEN` is the only secret CI needs; every other secret this feature uses (VPS SSH
key, Postgres password) is resolved by Pulumi Cloud at apply time from the stack's own encrypted
config, per research.md §4.
