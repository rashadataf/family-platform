# Research: Family and Membership (spec 008)

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-13

Phase 0 output. Each section states a decision, why it was chosen, and what was rejected. Two
sections carry consequences beyond this feature and are called out in the plan's Constitution
Check: §1 (an ADR gate) and §7 (a recorded deviation).

---

## 1. Row-level security is presently unreachable, whatever the migration says — **ADR REQUIRED (ADR-017)**

**Decision.** Before any family-scoped table is created, the platform gains a dedicated,
non-superuser application database role; every family-scoped table gets `ENABLE` **and** `FORCE
ROW LEVEL SECURITY`; and `apps/api`, `apps/worker` and the migrator connect as different roles.
This requires an ADR merged before the implementation pull request, as ADR-017, amending
[ADR-003](../../adr/ADR-003-database-orm.md)'s row-level-security section.

**Why this is not an implementation detail.** ADR-003 already decided that RLS is layer five of
`ARCHITECTURE.md` §9 and that it is driven by `SET LOCAL app.family_id`. What it did not address
is who the application connects *as*. Today, every process connects as `postgres`:

```
docker-compose.yml:47  DATABASE_URL: postgresql://postgres:...@postgres:5432/family_platform
```

`postgres` is a superuser and is also the owner of every table Prisma creates. PostgreSQL exempts
both from row-level security: a superuser always, and a table owner unless the table is explicitly
put under `FORCE ROW LEVEL SECURITY`. A policy written under those conditions is not a weak
control, it is **no control at all**, and — this is the dangerous part — it looks correct. The
policy exists, `pg_policies` lists it, the CI check that "every family-scoped table has an RLS
policy" passes, and every row is still visible to every query. The first family-scoped table in
the platform is the moment this has to be right, because every later context inherits whatever
this feature establishes.

**The shape.**

| Role | Used by | Grants |
|---|---|---|
| `postgres` (owner) | `migrate` service, `prisma migrate deploy` | DDL. Never used by a running application process |
| `family_platform_app` | `apps/api`, `apps/worker` | `SELECT/INSERT/UPDATE/DELETE` on operational tables, `INSERT` only on `audit_log`, `NOLOGIN`-adjacent hardening: no `BYPASSRLS`, not a member of the owner role |

`FORCE ROW LEVEL SECURITY` is then belt-and-braces for the one legitimate owner-connected path
(migrations and the seed fixture), so that a future ad-hoc script run as the owner is filtered too
unless it deliberately disables it.

**Alternatives rejected.**

- *Leave the connection as `postgres` and rely on layers 1–4.* Rejected outright. Principle V is
  non-negotiable and names row-level security specifically; ARCHITECTURE §9 calls layer 5 "the one
  that catches the mistake anyway". A layer that is silently inert is worse than an absent one,
  because the defence-in-depth argument keeps being made about it.
- *A separate database per family.* Rejected. Correct isolation, wrong cost curve, and
  incompatible with ADR-003's single logical database and with cross-family reporting later.
- *Defer the role split to the AWS move (ADR-013 Stage 1).* Rejected. The tables are created here;
  retrofitting ownership and grants across a populated schema is expand-and-contract work under
  Principle IV, for no benefit over doing it once, now, on an empty schema.

**What the ADR must decide** (its input is this section): the role names and grant sets, whether
the migrator keeps using the owner role or a third migration role, how the role's password reaches
the container at Stage 0 versus Stage 1, and the revisit trigger (a managed Postgres that does not
permit custom roles, which would force the isolation up into the repository layer).

---

## 2. How a family context reaches the database: `withFamilyContext`, not a Prisma client extension

**Decision.** `packages/persistence` exposes a single entry point:

```ts
withFamilyContext<T>(familyId: FamilyId, work: (uow: FamilyUnitOfWork) => Promise<T>): Promise<T>
```

It opens one `$transaction`, issues `SELECT set_config('app.family_id', $1, true)` as the first
statement in it, constructs every family repository against *that* transaction client, and hands
them to `work`. The repositories' method signatures contain no family parameter at all.

This replaces the standing TODO at [`packages/persistence/src/client.ts:8`](../../packages/persistence/src/client.ts),
which anticipated "a client extension that opens a transaction and issues `SET LOCAL
app.family_id` before any query".

**Why not the extension the TODO describes.** A `$extends({ query: { $allOperations } })` hook
wraps one operation. To make `SET LOCAL` cover the query it protects, the two must share a
transaction, so the extension would have to open a transaction per operation — which both defeats
the atomicity the unit of work exists for and silently makes a two-statement command
non-atomic. The extension can only reach the setting per call, and the setting is per
transaction. The explicit helper puts them in the same scope by construction.

**Why `set_config(..., true)` rather than `SET LOCAL`.** `SET LOCAL` takes a literal, not a bind
parameter, so it forces string interpolation of a value into SQL. `set_config(name, value, true)`
is the function form with identical transaction-local semantics and takes the family id as a bound
parameter. The third argument `true` is what makes it local, and losing it would leak the setting
across the pooled connection's next transaction — the single worst failure this mechanism could
have, so it gets an integration test of its own.

**Pooling.** Transaction-local settings are safe under a transaction-mode pooler; session-level
`SET` would not be. This is a reason to prefer this shape ahead of Stage 1, where a pooler is
likely.

**The policy, and why it fails closed.**

```sql
USING (family_id = current_setting('app.family_id', true)::uuid)
```

`current_setting(..., true)` returns `NULL` when the setting is absent rather than raising, and
`family_id = NULL` is `NULL`, which is not `TRUE`, so an unscoped query sees zero rows. Forgetting
the helper produces an empty result, never an unfiltered one. ARCHITECTURE §9 asks for an alert on
exactly that condition ("unexpected empty result = alert, this should be unreachable").

---

## 3. Resolving standing: the one deliberately unscoped read

**Decision.** `FamilyContextPort.resolve(userId, familyId)` is served by a standalone repository
constructed against the base client, outside `withFamilyContext`, exactly as spec 006's
`createSessionRepository()` is.

**Why it has to be.** There is a genuine ordering problem: `app.family_id` may only be set for a
family the caller has been authorized against, and resolving standing *is* the authorization. A
scoped repository cannot answer the question that decides its own scope.

**Why it is not a hole.** The lookup takes both identifiers from the caller and returns only the
row matching both. It cannot enumerate, cannot widen, and cannot return another family's data:
supplying a family id you have no membership in returns `null`, which is precisely the answer the
guard needs. The equivalent argument was made and accepted for the session guard in spec 006 §8.
The repository is exported as a single narrow factory, not as a general unscoped client, so the
blast radius is one function.

Everything downstream of the guard runs inside `withFamilyContext`, so the unscoped read is one
statement at the very front of the request and nothing else.

---

## 4. The capability catalogue is a specification decision, not an ADR

**Decision.** The full role-to-capability mapping is fixed in [data-model.md](data-model.md) and
implemented as a pure function in `packages/core/family/domain`. No ADR.

**Why no ADR, when this is plainly an authorization control.** The constitution requires an ADR for
a decision that "changes a security, privacy or authorization control", and the test it applies
throughout is whether the decision is expensive to reverse. The capability indirection exists
*specifically* to make this cheap: ARCHITECTURE §5.2's stated purpose is that "adding a role must
never require editing authorization logic scattered across contexts". Adding a capability is a new
entry in one table and one map. Adding a role is the same. If fixing the catalogue here were
expensive to reverse, the design would have failed at its stated goal.

What *would* require an ADR is changing the mechanism — checking role strings at a call site,
introducing per-resource ACLs alongside capabilities, or making capabilities dynamic per member
rather than derived from role. None of those is proposed.

**Consequence accepted.** The catalogue names capabilities for contexts that do not exist yet
(`documents:*`, `calendar:*`, `tasks:*`, `billing:manage`). That is deliberate and is what
FR-015 asks for: `FamilyContextPort` returns a complete capability array, and a context added later
consumes strings that are already being issued rather than requiring every existing member's
standing to be recomputed.

---

## 5. `FamilyMember` carries two orthogonal attributes, not one

**Decision.** `kind: 'adult' | 'child'` and `role: 'owner' | 'adult' | 'extended' | 'viewer'` are
separate columns. `kind` decides whether the record is a protected child record; `role` decides the
capability set.

**Why not a fifth `child` role.** ARCHITECTURE §5.2 fixes the role vocabulary at four values and
says those four map to capability sets. Adding `child` to that list would contradict a documented
enumeration (Principle III) and would also be a category error: a role answers "what may this
person do", and a child, by design, has no login path through which to do anything.

**Why not infer "child" from `user_id IS NULL`.** Because it is false. US4 adds an extended family
member with no linked account, and FR-014 requires that path to exist. Absence of an account is
not evidence of childhood, and inferring a privacy control from a nullable foreign key is exactly
the "schema side effect" Principle VI forbids by name.

**The textual warrant.** ARCHITECTURE §9 says "access to a `FamilyMember` **marked as** a child
requires an active guardianship relationship". A mark, not a role.

**Invariants that follow** (all enforced in the domain *and* as database check constraints, since
a check constraint survives a raw query):

| Invariant | Reason |
|---|---|
| `kind = 'child'` ⟹ `user_id IS NULL` | FR-003, Principle VI. No credentials, no login path |
| `kind = 'child'` ⟹ `role = 'viewer'` | The column is total rather than nullable (Principle I prefers no optional-field modelling), and least privilege is the right value to hold if a future `linkUserToMember` ever promotes the record — that command must then set a real role deliberately |
| `role = 'owner'` ⟹ `user_id IS NOT NULL` and `kind = 'adult'` | US4 Scenario 2. Ownership carries `billing:manage` and `family:delete`; an unreachable owner is an unrecoverable family |

A child's `role` is never resolved, because resolution requires a `userId` and a child has none.
The column exists because the table is uniform, not because a child has standing.

---

## 6. Enforcing "exactly one owner" and "never zero guardians"

Two invariants, two different enforcement stories, and the difference is worth stating because
SC-006 and SC-007 both claim "at every point in time".

**Exactly one owner (SC-007, FR-018).** A partial unique index does this in the database:

```sql
CREATE UNIQUE INDEX family_one_owner ON family_member (family_id) WHERE role = 'owner';
```

Ownership transfer demotes and promotes in one transaction. The index makes a concurrent second
promotion fail rather than interleave. This is a true database guarantee.

**At least one guardian per child (SC-006, FR-008).** There is no equivalent index — the assertion
is over the *absence* of rows in another table, which PostgreSQL cannot express as a constraint
without a trigger. Options considered:

- *A statement-level trigger* re-checking every affected child. Rejected for now: it puts a piece
  of domain logic in PL/pgSQL where no test in the repository's chosen stack can reach it, and
  ADR-003's whole argument is that the domain lives in TypeScript.
- *A denormalised `guardian_count` with a check constraint.* Rejected: a counter is a second source
  of truth that can drift, and the drift is silent.
- **Chosen**: the invariant lives in the domain, is asserted inside the same transaction as the
  mutation, and every one of the three routes to violating it (ending a guardianship, removing a
  guardian's membership, changing a guardian's role away from an eligible one) has a dedicated
  integration test against a real database. A scheduled consistency check in `apps/worker` reports
  any child with zero active guardians as an alert, so SC-006 is *measured* even though it is not
  constrained.

Stated plainly so a later reader does not assume otherwise: SC-007 is enforced by PostgreSQL,
SC-006 is enforced by the domain and monitored by a sweep.

---

## 7. The audit trail before the Compliance context exists — **recorded deviation**

FR-009 and Principle VI require every read of a child's record to be logged with actor, subject,
purpose and result, and Principle V requires every denial to be audited. ARCHITECTURE §5.12 assigns
the audit log to Audit and Compliance, which does not exist.

**Decision.** This feature establishes the minimum of that context rather than putting an audit
table under Family: `packages/core/compliance/application/ports/audit-log.port.ts` declares the
port, `packages/persistence` implements it, and the `audit_log` table is owned by Compliance from
its first row. Family's application layer depends on the published port, which §6's layer table
permits ("application/ may import … other contexts' *published ports*").

**Why not put it under `core/family`.** Moving it later would be "changing which context owns a
table", which the constitution lists as requiring an ADR. Creating it in the right place costs one
directory now and avoids that entirely.

**The deviation.** §7.3 says any effect crossing a context boundary that is not a pure read goes
through the outbox. Audit writes here are direct, synchronous inserts. Three reasons:

1. A **denial** has no domain transaction to attach an outbox row to — nothing was written, that
   is the point — so the outbox's atomicity argument does not apply to the case that matters most.
2. The outbox's purpose is to make a cross-context *side effect* recoverable. The audit log is not
   another context's domain state; it is an append-only sink with no reader in the request path and
   no business rule attached, which is why §5.12 describes it as a log rather than an aggregate.
3. Relaying audit rows through SQS would mean the compliance record of a denial arrives after the
   denial, on a queue that at Stage 0 does not exist (see §10).

For a **granted** read, the audit row is written inside the same transaction as the read, so it is
atomic with the thing it records. For a denial, it is a single insert on the failure path. This is
recorded in the plan's Complexity Tracking rather than left implicit. If review disagrees, it rides
with ADR-017.

**Not family-scoped for RLS.** `audit_log` carries `family_id` as a column but is deliberately
outside the RLS set: a denial is frequently recorded when `app.family_id` is unset or belongs to a
different family, which is exactly the row a policy would discard. The application role holds
`INSERT` only — no `SELECT`, no `UPDATE`, no `DELETE` — which is §5.12's "append-only, no update or
delete grants" expressed as a grant rather than as a convention. Like identity's tables in spec 006,
this table must be *declared* outside the family-scoped set so the CI check reads as a decision
rather than an oversight.

---

## 8. Invitations: a hashed token, and acceptance that works before the account exists

**Decision.** An invitation is addressed to a normalised email address and carries an opaque random
token, stored only as a hash, exactly as spec 006 handles email verification. Acceptance requires
an authenticated session whose account's email matches the invitation's, so the flow for someone
without an account is: receive the link → register through the existing spec 006 route → verify →
accept.

**Why acceptance is gated on an authenticated matching account rather than on the token alone.**
FR-011 requires acceptance to work "whether or not that email already corresponds to a registered
account". Both readings satisfy it; only one is safe. A bearer token that creates a linked
membership by itself makes a forwarded email a family-joining credential, and the joiner is then a
`FamilyMember` linked to a `UserId` that no one proved control of. Requiring the session costs the
recipient the registration they would need anyway to use the family at all.

**Case-insensitivity.** Reuse `EmailAddress` from `core/identity/domain` — spec 006 already
normalises at construction (FR-022) and this feature's spec.md asks for the same behaviour on
acceptance. This is a cross-context import of a *domain* value object, which §6 forbids. Rather
than break the boundary, the normalisation rule moves to `@fp/kernel` as a shared value object and
identity re-exports it; that is a small refactor within this feature's scope and is listed as such
in the plan. The alternative — a second normalisation implementation in `core/family` — is a
duplicated invariant, and a divergence between them is a case-sensitivity leak in the invitation
path.

**Expiry.** 14 days. Long enough to survive a holiday, short enough that a forwarded old email is
not a live door. Not derived from spec 006's 24-hour verification window: that token proves
control of an inbox *now*, this one is a standing offer.

**Redundancy (FR-013).** A partial unique index on `(family_id, email) WHERE status = 'pending'`
plus a domain check that the email does not already belong to a linked member of that family. The
index catches the concurrent case the check cannot.

---

## 9. Identifiers: UUIDv7 arrives here

**Decision.** Every table this feature creates uses `@default(uuid(7))`, supported by the Prisma
6.16 already in `packages/persistence`.

ARCHITECTURE §10 requires UUIDv7 primary keys, time-ordered so they index well and do not fragment
B-trees. Spec 006's tables use `@default(uuid())`, which is v4 — pre-existing drift from §10.

**Not fixed here.** Changing a primary key's generator on a populated table is expand-and-contract
work under Principle IV, and identity's tables are not on this feature's path. Recorded so the next
reader knows the inconsistency is known rather than accidental; the fix belongs in its own change
with its own migration.

---

## 10. Event publishing: outbox rows now, the relay still deferred

**Decision.** All six events (`FamilyCreated`, `MemberAdded`, `MemberRoleChanged`, `MemberRemoved`,
`GuardianshipEstablished`, `FamilyDeletionRequested`) are written as `outbox_event` rows in the same
transaction as their state change, through the existing `OutboxPort` in `@fp/kernel`. The SQS relay
remains unbuilt.

This continues, rather than re-decides, spec 006 research §5: ADR-005 Layer 2 in full, Layer 3 when
the first cross-context consumer exists. This feature does not create one — FR-023 says so
explicitly ("regardless of whether any other context currently subscribes"), and FR-025's
invitation voiding is *within* this context, so §7.2 applies and it happens in the same transaction
rather than through a queue.

**Naming.** `family.FamilyCreated.v1` and so on, per §7.3's context-prefixed, versioned convention.
Payloads carry identifiers only: `familyId`, `memberId`, `role`, `correlationId`. No name, no date
of birth, no email — Principle VI and VIII both forbid it, and an invitation event would be the
easy place to get that wrong, which is why `MemberAdded` carries `memberId` and not the address
that led to it.

---

## 11. Erasure, and the two operations that must not be conflated

Principle XI requires every context to implement `ErasurePort.eraseForFamily(familyId)` and
`ErasurePort.eraseForMember(memberId)`, and requires member deletion and family erasure to be
distinct operations.

**Decision.** Family implements both from the start, in `packages/persistence`, alongside the
retention helpers spec 006 established in `repositories/identity/retention.ts`.

- `eraseForMember(memberId)` — removes the member's personal details and their guardianship rows,
  retaining the member row as a tombstone (`removed_at` set, details nulled) so that authorship
  references from contexts that do not exist yet do not dangle. §5.12's "detach member from family;
  family data survives with authorship anonymised".
- `eraseForFamily(familyId)` — removes the family and every member, invitation and guardianship
  under it.

**The seam spec 006 left.** Spec 006's Personal Data answer 3 said Family, once it shipped, would
be responsible for triggering identity's account-deletion path for a member's linked `UserId` as
part of a family erasure. That remains true and remains *not built here*: the trigger belongs to
the Compliance erasure saga (§5.12), which is a separate feature. What this feature owes is its own
two ports, which the saga will call. Stated so the seam is not mistaken for an omission.

**Family deletion is a request, not a delete.** `FamilyDeletionRequested` is published, pending
invitations are voided in the same transaction (FR-025), and access is revoked immediately; erasure
itself follows the saga's grace period. Same shape as account deletion in spec 006.

---

## 12. Performance budget

| Path | Budget | Why |
|---|---|---|
| `FamilyContextPort.resolve` | < 5 ms | Runs on **every** family-scoped request, in the guard, before anything else. One lookup on a unique index over `(family_id, user_id)`; the role-to-capability expansion is a pure map with no I/O |
| `withFamilyContext` overhead | < 2 ms | One `set_config` round trip added to a transaction the command needed anyway |
| Family-scoped read p95 | < 200 ms end to end | The constitution's general constraint; nothing in this context does heavy work |

The one thing worth watching is that `resolve` and the transaction that follows it are two round
trips where an unguarded design would have one. That is the cost of layer 2 being independent of
layer 4, and ARCHITECTURE §9's argument is that the independence is the point.
