# Family Platform

A UK-first, mobile-first family life management platform. Working placeholder name — see [`CONSTITUTION`](.specify/memory/constitution.md).

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — bounded contexts, module boundaries, layering, repository structure.
- [`adr/`](adr/) — every foundational technology and structural decision, with alternatives and rationale.
- This repository is public, deliberately — see [`ADR-015`](adr/ADR-015-repository-visibility.md).
- [`docs/local-development.md`](docs/local-development.md) — how to get a local environment running.

## Running the platform

**Docker is the only prerequisite.** No Node.js, no pnpm, no PostgreSQL.

```sh
cp .env.example .env
docker compose up
```

That starts PostgreSQL, applies every committed migration, and runs the API with hot reload on <http://localhost:3000>. `curl http://localhost:3000/health/ready` confirms it.

See [`docs/local-development.md`](docs/local-development.md) for the full guide, including the optional faster host-based flow for contributors who already have Node.js and pnpm, and [`ADR-014`](adr/ADR-014-containerized-development.md) for why it works this way.

> This guarantee covers backend work. It will not extend to the Expo mobile app, which needs host-native simulators.

## Continuous Integration

Every pull request against `main`, and every push to `main`, runs ten independently-reported checks:

| Check | What it blocks on |
|---|---|
| `typecheck` | A type error, in strict mode, anywhere including `scripts/` |
| `lint` | Any lint warning — the threshold is zero |
| `format` | A file Prettier would reformat |
| `test` | A failing unit test. No database; the tier stays fast on purpose |
| `test-integration` | A failing test against a real, migrated PostgreSQL |
| `boundaries` | A forbidden import or a dependency cycle. **Fails closed** — an import matching no rule is an error |
| `security` | A secret in the diff, or a HIGH/CRITICAL advisory in the lockfile |
| `verify-env` | `.env.example` drifting from the API's schema, Node version drift, an unpinned action, an undeclared workspace package |
| `build` | A build failure in any package |
| `image` | A deployable image that will not build, carries a package manager or source, runs as root, will not reach `/health/ready` against a real database, ignores SIGTERM, or has a fixable HIGH/CRITICAL CVE |

Every third-party GitHub Action is pinned to a commit SHA, and Dependabot keeps the pins current. See [`specs/002-ci-pipeline/contracts/required-checks.md`](specs/002-ci-pipeline/contracts/required-checks.md) for the trigger and permissions, and [`specs/005-merge-gate-enforcement/contracts/gates-and-config.md`](specs/005-merge-gate-enforcement/contracts/gates-and-config.md) for what each gate owns.
