# Family Platform

A UK-first, mobile-first family life management platform. Working placeholder name — see [`CONSTITUTION`](.specify/memory/constitution.md).

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — bounded contexts, module boundaries, layering, repository structure.
- [`adr/`](adr/) — every foundational technology and structural decision, with alternatives and rationale.
- [`docs/local-development.md`](docs/local-development.md) — how to get a local environment running.

## Continuous Integration

Every pull request against `main`, and every push to `main`, runs four independently-reported checks: `typecheck`, `lint`, `test`, and `build`. All four must pass before a pull request can merge. See [`specs/002-ci-pipeline/contracts/required-checks.md`](specs/002-ci-pipeline/contracts/required-checks.md) for the exact trigger, permissions, and required-check configuration.
