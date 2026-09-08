# Contract: Required Checks and Trigger Configuration

This feature's real "interface" is not an API — it is the set of stable names and trigger settings that GitHub branch protection, and any future feature building on this pipeline, depend on. Changing any of these after branch protection is configured against them requires updating branch protection's required-checks list in the same change; they should not be renamed casually.

## Workflow triggers

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
```

- `pull_request` (not `pull_request_target`) — safe for fork-submitted code per FR-012 / research.md decision 5.
- Both trigger types run the identical set of jobs below (FR-001, FR-002).

## Permissions

```yaml
permissions:
  contents: read
```

Declared once at the workflow level. No job needs broader access — this pipeline uses no secrets and performs no writes (no deployment, no comment-posting, no artifact publishing to an external system).

## Concurrency

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

Ensures a superseded run for the same PR/ref is cancelled rather than left to misrepresent current status (FR-011).

## Required check names

Exactly these four job names are the contract branch protection's required-status-checks list must reference:

| Check name | Command it runs | Gates |
|---|---|---|
| `typecheck` | `turbo run typecheck` | FR-001, part of the constitution's "Typecheck, strict mode, zero errors" gate |
| `lint` | `turbo run lint` | FR-001, part of the constitution's "Lint, zero warnings" gate |
| `test` | `turbo run test` | FR-001, FR-005; part of the constitution's "Unit tests" gate |
| `build` | `turbo run build` | FR-001; part of the constitution's "Build of all applications" gate |

No `install` check exists as a separate name — it is the first step inside each of the four jobs above (see research.md decision 1).

## Branch protection (applied outside the workflow file)

Branch protection is a repository setting, not workflow YAML. The command below is documented here as the exact contract; running it against the live repository is a separate, explicitly-confirmed action during implementation, not authorized by this document alone:

```sh
gh api repos/rashadataf/family-platform/branches/main/protection \
  --method PUT \
  --field required_status_checks[strict]=false \
  --field 'required_status_checks[contexts][]=typecheck' \
  --field 'required_status_checks[contexts][]=lint' \
  --field 'required_status_checks[contexts][]=test' \
  --field 'required_status_checks[contexts][]=build' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='null' \
  --field restrictions='null'
```

`required_status_checks[strict]=false` (not requiring the branch to be up to date with `main` before merge) and no required-reviewer count are deliberate: per spec.md's Assumptions, "required reviewer counts or approval rules are not specified by this feature and are left at the repository owner's discretion," and the project is currently single-maintainer.

## Consumers of this contract

- GitHub branch protection (required-status-checks list).
- Any future feature adding a fifth verification step (e.g., integration tests) extends this table and updates branch protection in the same change — it does not silently rename or remove the four names above.
