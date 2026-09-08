# Family Platform

A UK-first, mobile-first family life management platform. Working placeholder name — see [`CONSTITUTION`](.specify/memory/constitution.md).

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — bounded contexts, module boundaries, layering, repository structure.
- [`adr/`](adr/) — every foundational technology and structural decision, with alternatives and rationale.
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

Every pull request against `main`, and every push to `main`, runs independently-reported checks: `typecheck`, `lint`, `format`, `test`, `verify-env`, `build`, and `image` (which builds the deployable container, asserts its contents, and requires it to start against a real database). See [`specs/002-ci-pipeline/contracts/required-checks.md`](specs/002-ci-pipeline/contracts/required-checks.md) for the exact trigger, permissions, and required-check configuration.
