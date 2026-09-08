# Contract: Health Endpoints

`apps/api` exposes exactly two HTTP interfaces in this feature. Both exist to support the spec's acceptance scenarios (confirming "the API responds to a request") and the reset/restart validation scenarios — they are not product functionality, and per the spec's Assumptions, the API "may expose no more than a minimal health or readiness signal."

These are documented here as a contract, ahead of `packages/contracts` (the future ts-rest + Zod wire-contract package per ADR-006) existing, because this is a real interface other tooling (and future features) may come to depend on.

## `GET /health`

**Purpose**: Liveness. Answers "is the process up," nothing more.

**Behavior**: No dependency checks (no database call). Always returns `200 OK` if the Nest application is running and this handler is reachable.

**Response body** (200):
```json
{ "status": "ok" }
```

## `GET /health/ready`

**Purpose**: Readiness. Answers "is the process up *and* able to serve requests that need the database."

**Behavior**: Calls `checkDatabaseHealth()` from `@fp/persistence`. That function queries the `_scaffold_probe` table (see [data-model.md](../data-model.md)) and resolves or throws.

**Response body** (200, `checkDatabaseHealth()` resolved):
```json
{ "status": "ok" }
```

**Response body** (503, `checkDatabaseHealth()` threw):
```json
{ "status": "error", "message": "<reason>" }
```

**Failure modes this distinguishes** (per the spec's edge cases):
- Database unreachable (connection refused/timeout) → 503, connection-level error message.
- Database reachable but not yet migrated (`_scaffold_probe` does not exist) → 503, "relation does not exist"-style error message — visibly distinct from a connection failure, so "up but unmigrated" is never mistaken for "ready."

## Versioning

Not versioned (no `/v1` prefix). This is deliberately inconsistent with ADR-006's path-versioning rule for product API routes, because these are operational endpoints, not product API surface, and ADR-006 governs the latter. If these endpoints later move into `packages/contracts` as part of a real health/ops contract, they should be reconciled with ADR-006's versioning scheme at that time.
