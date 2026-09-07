# ADR-003: PostgreSQL with Prisma, and the query-builder escape hatch

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

The blueprint fixes PostgreSQL and asks for a choice between Prisma and TypeORM, on architectural grounds rather than popularity.

PostgreSQL is not seriously in question and this ADR will not pretend otherwise. The data is highly relational (families, members, guardianships, events, occurrences, tasks, documents, versions, reminders), correctness depends on transactions and foreign keys, and one of the load-bearing security controls in [ARCHITECTURE.md §9](../ARCHITECTURE.md) is row-level security, which is a PostgreSQL feature. It additionally covers full-text search over document metadata, `jsonb` for extraction results, and `pgvector` for future semantic retrieval, all of which delay the need for additional datastores. A short justification is recorded below; the substance of this ADR is the data-access layer.

The framing "Prisma or TypeORM" is also too narrow, and accepting it would skip the two libraries that are most relevant to this system's actual requirements. The real field is four options across two categories: ORMs (Prisma, TypeORM) and typed query builders (Kysely, Drizzle).

The requirements that should decide it:

1. **Migrations must be safe and reviewable.** This system stores documents families cannot replace. A destructive migration is unrecoverable damage to a real person's life admin.
2. **Data minimisation must be easy.** UK GDPR and the child-data sensitivity in the blueprint mean over-fetching PII into memory and logs is a design defect, not an inefficiency.
3. **Row-level security must be usable.** Every request needs a `SET LOCAL app.family_id` bound to the same transaction as the queries it protects.
4. **The domain layer must not know the ORM exists.** `packages/core` has no data-access dependency at all.
5. **Complex aggregate reads are required.** The dashboard endpoint spans four contexts with date-window filtering and ordering.
6. **One developer maintains it.** Tooling that generates correct output without deep expertise is worth real weight.

## Decision

**PostgreSQL 16 with Prisma as the sole data-access library for the MVP, confined entirely to `packages/persistence`.**

**Kysely is a pre-approved escape hatch with a defined trigger:** when the count of `$queryRaw` call sites exceeds ten, or when any single raw query exceeds roughly thirty lines, Kysely is introduced for the read side over the same database and the same schema. This is not adopted now, because two data-access libraries for one developer at MVP is unjustified complexity.

Row-level security is enabled on every family-scoped table regardless of the library, applied by a Prisma client extension that opens a transaction and issues `SET LOCAL app.family_id` before any query in a request executes.

## Alternatives considered

### TypeORM — rejected

TypeORM is the conventional NestJS pairing and it is rejected on three grounds, in order of weight.

**1. Migration generation is not trustworthy for this data.** TypeORM generates migrations by diffing decorated entity classes against the live schema. In practice this produces noisy diffs, spurious changes from decorator ordering or driver-level type inference, and, most seriously, generated `DROP COLUMN` and `DROP TABLE` statements when the diff is misread. Requirement 1 says a bad migration destroys documents families cannot get back. Prisma's `migrate dev` writes a plain SQL file that a human reads and approves in the pull request, and validates it against a shadow database to detect drift. "I can read the exact SQL that will run in production" is not a preference here, it is a safety property.

**2. Its type safety is weaker in exactly the places that matter.** Relations on TypeORM entities are typed as present whether or not they were loaded, so `document.versions.length` compiles and throws at runtime. `find` options are only loosely connected to the returned shape, so a query selecting three columns still yields a fully typed entity, and the type system actively obscures which fields are real. The blueprint's TypeScript philosophy is compile-time safety plus runtime validation; TypeORM's entity model concedes the compile-time half. Prisma's return types are derived from the `select` and `include` clause, so a partial selection produces a type that has only the selected fields, and reading an unloaded relation is a compile error.

**3. Maintenance risk.** TypeORM has had extended periods of thin maintenance and a large backlog. For a foundational dependency intended to last years, that is a legitimate concern independent of technical merit.

TypeORM's genuine advantages, first-class NestJS integration and the data-mapper/active-record flexibility, do not apply here. NestJS integration is irrelevant because the persistence layer is deliberately framework-free ([ARCHITECTURE.md §6](../ARCHITECTURE.md)). Active record is actively unwanted, since it puts persistence on the same objects as domain behaviour, which is the coupling this architecture is built to avoid.

### Drizzle — seriously considered, rejected for now

Drizzle is the strongest challenger and deserves more than a dismissal. It is TypeScript-native with no code generation step and no separate engine, its SQL-like API is fully typed, it has a first-class relational query API, and it handles transactions and RLS cleanly because it does not hide the connection.

It is rejected on two specific points:

- **Migration ergonomics.** `drizzle-kit` has improved substantially but still asks the developer more questions and provides fewer guardrails than `prisma migrate`, particularly around renames and multi-step destructive changes. Given requirement 1, this is the deciding factor.
- **Schema as TypeScript versus schema as a declarative file.** Drizzle's schema is TypeScript, which is flexible and composable. Prisma's schema is a single declarative file that is the best available artefact for an AI coding agent or a new engineer to read in order to understand the data model. Given that the blueprint requires the repository to be self-explanatory to agents with no conversational context, a canonical, greppable, diffable schema file has documentation value that composable TypeScript does not.

Drizzle would be a defensible choice and this decision is close. If Prisma becomes a problem, Drizzle rather than TypeORM is the migration target.

### Kysely — adopted only as an escape hatch

Kysely is a pure typed query builder, not an ORM. Its type inference over joins and aggregates is the best available in TypeScript. It is not the primary choice because it does nothing for migrations, provides no schema artefact, and offers no relation loading, so a solo developer would write substantially more code for the eighty percent of queries that are ordinary CRUD. It is exactly right for the twenty percent Prisma handles badly, which is why it is pre-approved rather than pre-adopted.

### Raw SQL only, no library — rejected

Maximum control, and unacceptable ergonomics for a nine-context application with one maintainer. The mapping and validation code becomes the thing that has bugs.

### PostgreSQL alternatives, briefly

- **MySQL/PlanetScale.** Rejected. No row-level security, weaker `jsonb`, and PlanetScale's historical lack of foreign keys is incompatible with a relational domain that depends on referential integrity.
- **DynamoDB.** Rejected. Access patterns are not known in advance and the dashboard is inherently multi-entity and ad hoc. Single-table design would freeze query patterns before the product has learned what they are.
- **MongoDB.** Rejected. The domain is relational, and the tenant-isolation strategy relies on RLS.
- **Aurora Serverless v2.** Not now. Real appeal in scale-to-low-capacity, but a higher floor cost than a small RDS instance and unnecessary complexity at MVP. It is the natural upgrade at the 100k-user tier.

## How the identified weaknesses are handled

Prisma has genuine deficiencies and pretending otherwise would make this ADR useless later.

**Complex aggregate queries.** Prisma's fluent API cannot express window functions, `DISTINCT ON`, CTEs or lateral joins. The dashboard needs some of this.
*Handling:* `$queryRaw` with `Prisma.sql` tagged templates for parameterisation, and every raw result parsed through a Zod schema at the boundary, because `$queryRaw` returns an unverified assertion rather than a checked type. This is the one place in the codebase where a runtime parse over a database result is mandatory. When these exceed ten call sites, Kysely replaces them.

**Prisma is not a repository layer.** `PrismaClient` is a data-access client that exposes the whole schema to any holder.
*Handling:* `PrismaClient` is instantiated once inside `packages/persistence` and is not exported from it. What is exported is repository classes implementing the port interfaces declared in `packages/core`. `dependency-cruiser` fails the build if `@prisma/client` is imported anywhere outside `packages/persistence`.

**Middleware-based tenant scoping is a footgun.** A Prisma client extension that injects `where: { familyId }` is easy to write and easy to bypass, and it fails open when someone uses `$queryRaw`.
*Handling:* it is used, but it is layer four of five, not the only defence. Scoped repository construction is layer four ([ARCHITECTURE.md §9](../ARCHITECTURE.md)) and PostgreSQL RLS is layer five. RLS is enforced by the database, applies to raw queries, ad-hoc psql sessions and any future ORM, and cannot be bypassed by application code.

**N+1 queries.** Prisma's `include` fans out into multiple queries in some shapes.
*Handling:* query-count assertions in integration tests for the hot paths (dashboard, document list, family load), plus slow-query logging with the originating call site attached.

**Connection pooling.** Long-running Fargate tasks with a fixed pool are the simple, correct case here, which is a direct consequence of rejecting Lambda in [ADR-002](ADR-002-modular-monolith.md). Pool size is set against the RDS `max_connections` limit divided across API tasks, worker tasks and migration jobs.

## Consequences

### Positive

- Migrations are reviewable SQL, checked against a shadow database, applied by a dedicated task before the new version starts.
- Query results are typed by selection, which makes fetching only the columns needed the natural way to write a query, directly supporting data minimisation.
- `schema.prisma` is a single readable artefact describing the entire data model, valuable to both new engineers and AI agents.
- The ORM is confined to one package, so replacing it is a bounded piece of work.
- Row-level security is library-independent, so the strongest isolation guarantee survives any future change here.

### Negative

- **Prisma's abstraction hides SQL**, so performance problems surface later than they would with a query builder. Mitigation: query logging in development, `EXPLAIN` on any query over a threshold in CI for the hot paths.
- **A generated client is a build step**, which must run before typecheck and be cached correctly in Turborepo.
- **Raw queries are an unchecked seam.** Mitigation: mandatory Zod parsing, enforced by a lint rule restricting `$queryRaw` to files under `persistence/queries/`.
- **Two libraries eventually.** When the Kysely trigger fires, there will be two ways to query. Mitigation: a hard rule that Kysely is read-side only and all writes stay in Prisma.

### Revisit this decision when

- Raw query call sites exceed ten, which triggers Kysely for reads without reopening this ADR.
- Prisma's migration engine produces an unsafe diff that review catches, which is a serious signal.
- Multi-region or read-replica routing is needed, since Prisma's support here is weaker than a query builder's.
