# ADR-017: Tenant isolation at the database — the application role and `FORCE ROW LEVEL SECURITY`

- **Status:** Accepted
- **Date:** 2026-09-13
- **Deciders:** Principal Engineer
- **Amends:** [ADR-003](ADR-003-database-orm.md), its row-level-security decision only

## Context

[ARCHITECTURE.md §9](../ARCHITECTURE.md) names five independent layers protecting the stated top
risk for this product — a user reaching another family's data by changing an id. Layer five is
PostgreSQL row-level security, and the argument for it is explicit: it "is the one that catches the
mistake anyway," because it "is ORM-independent, so it survives a raw query, a future ORM migration,
an ad-hoc script, and a developer who bypasses the repository."

[ADR-003](ADR-003-database-orm.md) already decided that layer five exists and how the tenant key
reaches it: "Row-level security is enabled on every family-scoped table regardless of the library,
applied by a Prisma client extension that opens a transaction and issues `SET LOCAL app.family_id`
before any query in a request executes."

Spec 008 creates the first family-scoped tables in the platform, so this is the first moment any of
that becomes executable. Writing it revealed a gap ADR-003 did not address: **who the application
connects to PostgreSQL as.**

Today, every process — the API, the worker, the migrator, the seed fixture — uses one connection
string:

```
docker-compose.yml   DATABASE_URL: postgresql://postgres:...@postgres:5432/family_platform
```

`postgres` is a superuser, and it is also the owner of every table Prisma creates. PostgreSQL
exempts both from row-level security: a superuser unconditionally, and a table's owner unless the
table is explicitly placed under `FORCE ROW LEVEL SECURITY`.

The consequence is not that layer five would be weak. It is that layer five would **not exist**,
while appearing to. The policy would be created by the migration. `pg_policies` would list it.
`rowsecurity` would be `true` in `pg_tables`. A CI check asserting "every family-scoped table has a
row-level security policy" would pass. And every query from the application would still see every
family's rows.

That combination — an inert control that passes every check written to verify it — is worse than an
absent one, because the defence-in-depth argument in §9 would continue to be made about it in
design reviews, in this repository's own documents, and in whatever the privacy policy eventually
says.

The constitution requires an ADR before a change that "changes a security, privacy or authorization
control." Splitting the database roles changes the connection topology of every environment, is
inherited by every bounded context that follows spec 008, and becomes expand-and-contract work
under Principle IV the moment the tables hold data. It is therefore decided here, before the first
family-scoped row exists, rather than discovered later.

## Decision

**The application connects to PostgreSQL as a dedicated, non-superuser, non-owner role, and every
family-scoped table is placed under both `ENABLE` and `FORCE ROW LEVEL SECURITY`.**

Three parts.

### 1. Two roles, with different jobs

| Role | Used by | Holds |
|---|---|---|
| `postgres` (owner) | The `migrate` service, `prisma migrate deploy`, the seed fixture | DDL. Never used by a running application process |
| `family_platform_app` | `apps/api`, `apps/worker` | `SELECT`/`INSERT`/`UPDATE`/`DELETE` on operational tables; `INSERT` **only** on `audit_log`. Created `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, and not a member of the owner role |

A third migration role is **not** introduced. The owner role already exists, migrations already run
as a separate container task with its own lifecycle
([ADR-014](ADR-014-containerized-development.md)), and a third role would add a credential to
manage for no isolation the two do not already provide. The property that matters is that no
long-running application process holds DDL rights or RLS exemption, and two roles achieve it.

The connection strings separate accordingly: `DATABASE_URL` becomes the application role's, and a
new `MIGRATOR_DATABASE_URL` carries the owner's. Both are parsed at process start, and a process
that boots with the wrong one fails at boot rather than at its first query (Principle II).

### 2. `FORCE`, not merely `ENABLE`

Every family-scoped table gets both:

```sql
ALTER TABLE family_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_member FORCE  ROW LEVEL SECURITY;
```

`ENABLE` alone is what the application role needs, since it is not the owner. `FORCE` covers the one
legitimate owner-connected path — migrations, the seed fixture, and any future maintenance script —
so that a query run as the owner is filtered too unless it deliberately steps outside the policy.
This is the layer that survives "a developer who bypasses the repository," and a developer with a
`psql` prompt is usually connected as the owner.

### 3. The tenant key binds per transaction, by function, not by statement

ADR-003's `SET LOCAL app.family_id` becomes `SELECT set_config('app.family_id', $1, true)`, issued
as the first statement of the transaction the queries it protects run in, by a single helper —
`withFamilyContext(familyId, work)` in `packages/persistence` — that constructs every family
repository against that transaction client.

Two changes from ADR-003's wording, both mechanical rather than directional:

- **`set_config(..., true)` rather than `SET LOCAL`.** `SET LOCAL` takes a literal and cannot bind a
  parameter, so it would require interpolating a value into SQL. The function form has identical
  transaction-local semantics and takes the family id as a bound parameter. The third argument is
  what makes it local; losing it would leak one request's scope onto the next transaction on a
  pooled connection, so that specific failure gets a dedicated integration test.
- **An explicit helper rather than a Prisma client extension.** An extension hook wraps one
  operation. For `SET LOCAL` to cover the query it protects, the two must share a transaction, so
  the extension would have to open a transaction *per operation* — which silently makes a
  two-statement command non-atomic and defeats the unit of work. ADR-003 named the extension as the
  mechanism; the outcome it was reaching for is the same, and the helper is the construction that
  actually delivers it.

The policies fail closed:

```sql
USING (family_id = current_setting('app.family_id', true)::uuid)
```

`current_setting(..., true)` returns `NULL` when the setting is absent rather than raising, and
`family_id = NULL` is `NULL`, which is not `TRUE`. Forgetting the helper yields an empty result, not
an unfiltered one. §9 asks for an alert on exactly that condition, and spec 008 adds one.

### What is explicitly outside the policy set

`audit_log` is not family-scoped and gets no policy. A denial is frequently recorded when
`app.family_id` is unset or names a different family — precisely the row a policy would discard, and
precisely the row that matters. Its isolation is a grant instead: the application role holds
`INSERT` and nothing else, which is [ARCHITECTURE.md §5.12](../ARCHITECTURE.md)'s "append-only, no
update or delete grants" expressed as a grant rather than a convention. This exclusion is declared
so the CI check that flags family-scoped tables lacking RLS reads it as a decision.

## Alternatives considered

### Leave the connection as `postgres` and rely on layers 1–4 — rejected

Layers 1–4 are real and are all implemented. But Principle V is non-negotiable and names row-level
security specifically ("Row-level security MUST remain enabled on every family-scoped table"), and
§9's whole argument for five layers is that "the realistic failure is a single forgotten `where`
clause in one of several hundred queries." Four layers that all live in application code share a
failure mode that the fifth does not.

The decisive objection is not the missing layer, it is the false signal. Under this option the
repository would contain policies, a CI check verifying them, and an architecture document
describing them as load-bearing, while none of it was in force.

### A third, dedicated migration role — rejected

More roles, more credentials, no additional isolation. The relevant property is that application
processes hold neither DDL rights nor RLS exemption; separating the migrator from the owner does not
advance it. Revisit if the owner role ever needs to be reachable by something other than the
migration task.

### One database per family — rejected

Genuine isolation, and the wrong cost curve. It is incompatible with ADR-003's single logical
database, makes cross-family operational queries and migrations proportional to customer count, and
spends at Stage 0 what would only pay back at a scale [ADR-013](ADR-013-staged-hosting-model.md)
explicitly defers planning for.

### Schema-per-family with `search_path` — rejected

Cheaper than a database each, and it moves the tenant key into connection state that is easy to get
wrong in a pooled environment — the same class of bug as a forgotten `SET LOCAL`, but failing open
instead of closed, since a stale `search_path` points at a real schema rather than at nothing.

### Defer the role split to the AWS move (Stage 1) — rejected

The tables are created now. Retrofitting ownership and grants across a populated schema is
expand-and-contract work under Principle IV, for no benefit over doing it once against an empty one.
The connection-string split is also the kind of change that is trivial while three services use one
URL and tedious once a dozen do.

### Enforce isolation only in the repository layer — rejected

That is layer four, which spec 008 also builds. It is a good layer: `familyMemberRepository
.findById(memberId)` has no family parameter to forget. But it is application code, it does not
survive a raw query or a `psql` session, and §9's case for layer five is precisely that it holds
when application code does not.

## Consequences

### Positive

- Layer five of ARCHITECTURE §9 becomes real, and demonstrably so: spec 008's quickstart Scenario 7
  and its integration tests assert zero rows with no context set, correct rows inside the helper,
  and — the assertion that catches this ADR's entire subject — zero rows for the **owner** role,
  which is what proves `FORCE` is doing something.
- The blast radius of a forgotten scope drops from "returns another family's data" to "returns
  nothing, and alerts."
- Every bounded context after spec 008 inherits a working mechanism rather than re-deciding it, and
  `withFamilyContext` gives them one obvious way to reach the database.
- Least privilege at the database is now the default rather than a hardening task, which is a
  materially easier story to tell in a privacy review than retrofitting it would be.

### Negative

- **A second credential to provision, rotate and inject** in every environment: Compose, the staging
  stack, CI, and Stage 1 later. Small, but it is real operational surface that did not exist
  yesterday.
- **A new way to break the application in a way that looks like data loss.** A misconfigured role,
  or a query path that misses `withFamilyContext`, produces an empty result rather than an error.
  This is the safe direction to fail, but it is confusing in the moment, which is why the empty
  result is alerted on and why the runbook note is part of spec 008 rather than a follow-up.
- **`FORCE` makes owner-connected maintenance harder on purpose.** An ad-hoc `psql` fix now needs a
  deliberate step to see the rows. That is the point, and it will still be irritating during an
  incident.
- **One more round trip per request**, since `set_config` is a statement in a transaction that would
  otherwise start with the query itself. Budgeted at under 2 ms in spec 008's research.
- **This is not free to reverse.** Once policies exist on every family-scoped table, removing them
  is a security decision requiring its own ADR, not a refactor.
- **It does not protect against a compromised application role.** That role can read any family's
  rows by setting the context. RLS here defends against forgotten predicates and bypassed
  repositories, not against arbitrary code execution inside the API. Nothing in §9 claims otherwise,
  but it is worth writing down so nobody later assumes it does.

### Revisit this decision when

- A managed PostgreSQL is adopted that does not permit custom roles or `FORCE ROW LEVEL SECURITY`.
  Isolation would have to move up into the repository layer, and the §9 argument would need
  restating honestly rather than quietly.
- A connection pooler is introduced in session mode rather than transaction mode, which would
  invalidate the transaction-local assumption this decision rests on.
- A legitimate cross-family operational need appears — analytics, support tooling, a compliance
  export — that cannot be served by a purpose-built role with its own explicit policy. The answer
  is likely another role rather than an exemption, but it is a decision, not an implementation
  detail.
- The count of tables outside the policy set grows beyond `audit_log`. One declared exception is a
  decision; several is a pattern that deserves its own reasoning.
