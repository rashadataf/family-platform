# Phase 0 Research: Monorepo Scaffolding & Local Development Environment

No `[NEEDS CLARIFICATION]` markers remained after the spec's clarification session; the research below resolves implementation-level design questions raised while translating that spec into a concrete plan.

## 1. Dev-command orchestration mechanism

**Decision**: `pnpm dev` runs a small TypeScript orchestrator script (`scripts/dev.ts`, executed via `tsx`), not a pure Turborepo task graph. Turborepo remains fully responsible for `build`, `lint`, `typecheck`, and `format:check`.

**Rationale**: The dev command has three sequential phases with fundamentally different characteristics than a build graph: (1) start a stateful external container and poll it until healthy — Turborepo has no primitive for "wait for a container to become ready"; (2) run a one-shot database migration that must hard-stop the whole sequence on failure; (3) start a persistent, auto-restarting process. None of these are cacheable, content-hashed build-graph operations, which is specifically what Turborepo is for per ADR-001 ("how builds, tests and lints run, and what gets cached"). The spec's edge cases additionally require curated, phase-specific failure messages — naming a conflicting port, distinguishing a stale container from one that never became healthy, distinguishing a failed migration from a successful one — which a generic per-task exit-code report cannot express without contorting `turbo.json` far past its intended shape.

**Alternatives considered**:
- *Pure Turborepo task graph* (`db:up` → `db:migrate` → `dev`, with `dev` marked `persistent: true`). Rejected: technically expressible via `dependsOn`, but readiness polling and curated error messages would still need to live in an imperative script invoked by each task, so this buys no simplification — it only adds a layer of indirection.
- *Shell script instead of TypeScript*. Rejected: this is a TypeScript-first repository (ADR-001), and a `.ts` script sharing types with `apps/api`'s env schema (for the drift check) is more maintainable than a shell script re-parsing `.env` by hand.

**Concrete sequencing**:
1. **Preflight** — confirm `.env` exists (else: point the developer at `cp .env.example .env`); confirm Docker is reachable (else: name the missing prerequisite); run the env-drift check as a warning only.
2. **Start Postgres** — `docker compose up -d postgres`; detect port-conflict stderr and name the offending port; on a stale/exited container state, attempt exactly one bounded recovery cycle (`down` then `up -d`); poll `pg_isready` with a bounded timeout, dumping container logs on timeout.
3. **Migrate** — `prisma migrate deploy` (apply-only, non-interactive); a non-zero exit stops the sequence immediately — the API process is never started on a failed migration, so "the environment is running" can never mean "partially migrated."
4. **Start API** — spawn the API's own `dev` script (`tsx watch`), stay in the foreground, forward `SIGINT`/`SIGTERM`. Ctrl+C stops the API only; the Postgres container is left running (a separate `pnpm dev:down` stops it without touching its data volume).

## 2. Environment variable validation

**Decision**: A hand-rolled Zod schema (`apps/api/src/config/env.schema.ts`) parsed eagerly in `main.ts`, before `NestFactory.create` is called — not `@nestjs/config`.

**Rationale**: Constitution Principle II requires the process to fail to boot on invalid configuration, not fail later on first use. A parse that runs as the literal first statement of `main.ts` is a genuine pre-flight gate; `@nestjs/config`'s `validate` hook runs inside Nest's own module-initialization lifecycle, which is a weaker guarantee for the same requirement and would be an additional dependency for something a five-line function already does with a library (Zod) already used elsewhere in this codebase's architecture (ADR-006). Each Zod issue carries its own field path, which directly produces the "names the specific variable at fault" behavior FR-008 and SC-003 require.

**Alternatives considered**: `@nestjs/config` with a Joi/Zod validator — rejected per above. Manual `if (!process.env.X) throw` checks — rejected as unstructured and not type-inferring; a schema gives both validation and the TypeScript type in one definition.

## 3. Baseline migration content

**Decision**: One synthetic table, `ScaffoldProbe` (mapped to `_scaffold_probe`), rather than a no-op or extension-only migration.

**Rationale**: FR-005 requires the baseline migration to prove the migration mechanism works end-to-end while explicitly not encoding product domain schema. A real `CREATE TABLE` is materially stronger proof of "builds schema from nothing" than a statement with no persisted structural effect. The name (leading underscore, plus a comment in `schema.prisma` marking it for deletion once real domain schema lands) makes its scaffolding nature unmistakable to a future reader. It also gives the readiness endpoint something concrete to query, which has a useful side effect for the edge cases: if migrations never ran, querying `_scaffold_probe` fails with a distinct "relation does not exist" error, making "database reachable but unmigrated" visibly different from "database unreachable" — exactly the distinction the spec's edge cases require ("must not silently present itself as ready with a partially migrated schema").

**Alternatives considered**: A no-op migration enabling a Postgres extension (e.g., `pgcrypto`). Rejected: proves less (no schema is actually built), and gives the readiness check nothing to query.

## 4. Reset vs. stop/restart semantics

**Decision**: The distinction between FR-010 (stop/restart, no data loss) and FR-011 (explicit reset) is implemented entirely via whether the Postgres Docker volume is removed. `docker-compose.yml` declares a named volume (`fp_postgres_data`); ordinary stop/restart (`pnpm dev:down` then `pnpm dev`) never passes `-v`, so the volume — and therefore local data — persists across any number of cycles. `pnpm db:reset` explicitly runs `docker compose down -v`, then reprovisions the container and reapplies every committed migration from nothing, reusing the same readiness-polling helper the dev script uses.

**Rationale**: This is the simplest mechanism that satisfies both requirements without any custom bookkeeping — Docker's own volume lifecycle already draws exactly the line the spec needs.

**Alternatives considered**: A bind-mounted host directory for Postgres data, manually deleted on reset. Rejected: a named volume is the more idiomatic Docker Compose primitive and avoids host-path permission issues across different developer machines.

**Note**: Authoring a *new* migration (`prisma migrate dev`, interactive — diffs the schema, prompts for a name, writes and applies the SQL) is a distinct, third workflow from both of the above and must not be confused with the dev script's internal use of `prisma migrate deploy` (apply-only, never generates new SQL). This distinction is called out explicitly in `docs/local-development.md`.

## 5. Package boundary for Prisma

**Decision**: `packages/persistence` is the only package permitted to depend on `@prisma/client`. This is enforced today purely by omission: `apps/api/package.json` never lists `@prisma/client` or `prisma` in any dependency field. Under pnpm's strict, non-hoisted `node_modules` (ADR-001), an attempted import from `apps/api` fails at module resolution — a build/runtime error, not a lint warning that could be silenced with a comment.

**Rationale**: Constitution Principle IV requires the data-access client to never be imported outside the persistence package. Full enforcement via `dependency-cruiser` is a real ADR-001 capability, but is explicitly out of scope for this feature; the guarantee needed today doesn't require that tooling, because pnpm's linking model already makes the violation impossible to introduce accidentally.

`apps/api`'s readiness check reaches the database only through `packages/persistence`'s single exported function, `checkDatabaseHealth(): Promise<void>`, which internally uses a module-private `PrismaClient` singleton (`src/client.ts`) to query `_scaffold_probe`. Nothing from `@prisma/client`'s types crosses the package boundary, even at the type-signature level.

**Deferred by design**: The ADR-003 row-level-security client extension (`SET LOCAL app.family_id`) is not built in this feature — there is no family-scoped table yet to scope, so it would be dead code with no legitimate input. `src/client.ts` carries a `TODO(ADR-003-rls)` comment marking exactly where it attaches once the first family-scoped table exists, so the seam is documented rather than rediscovered later.

## 6. Dev-mode process execution

**Decision**: `tsx watch --clear-screen=false src/main.ts` for the API's own `dev` script, rather than the Nest CLI's `start:dev` (webpack-based HMR).

**Rationale**: `tsx` gives file-watch auto-restart (FR-002, SC-007) with fewer moving parts and no webpack configuration, which is appropriate for an application this small (two endpoints). This trades away Nest CLI's incremental-compile performance advantage, which only matters at a scale this feature doesn't yet have — worth reconsidering once real modules exist under `apps/api`.
