# Implementation Plan: Family and Membership

**Branch**: `008-family-membership` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-family-membership/spec.md`

## Summary

The tenant root. Everything the platform will ever hold is scoped to a `Family`, and this feature
is where that scope comes into existence: the `Family`, `FamilyMember`, `Invitation` and
`GuardianshipRelationship` aggregates, the four-role capability model, and the `FamilyContextPort`
open host service that every later context consumes instead of reading these tables
(ARCHITECTURE.md §5.2).

Two things make this larger than its five user stories suggest, and both are one-time costs the
platform pays here rather than later.

**The first family-scoped table is where `ARCHITECTURE.md` §9 stops being a diagram.** Layers 4 and
5 — repositories scoped by construction, and PostgreSQL row-level security — have nothing to attach
to until now. Building them turns out to require a change nobody has written down yet: the
application connects to PostgreSQL as `postgres`, a superuser and the owner of every table, and
PostgreSQL exempts both from row-level security. A policy written under those conditions passes
every check we have and filters nothing. That is the one gating item below.

**The privacy design is the feature, not a constraint on it.** `FamilyMember` is not a `User`;
children are member records with no credentials and no login path; access to a child's record
requires an explicit guardianship relationship rather than family membership, and every read of one
is audited. Constitution Principle VI is non-negotiable and this is the context it was written
about, so the audit sink has to exist here — which means establishing the minimum of Audit and
Compliance ([research.md §7](research.md)) rather than putting a compliance table under Family and
paying for the move later.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24

**Primary Dependencies**: NestJS 11 + `@ts-rest/nest` (`apps/api`); ts-rest + Zod 3
(`packages/contracts`); Prisma 6.16 (`packages/persistence`). **No new external dependency** — see
Constitution Check

**Storage**: PostgreSQL 16 via Prisma, per [ADR-003](../../adr/ADR-003-database-orm.md). New tables:
`family`, `family_member`, `invitation`, `guardianship` (all family-scoped, all under RLS), plus
`audit_log` (owned by Audit and Compliance, deliberately not family-scoped). New database role:
`family_platform_app` — [research.md §1](research.md)

**Testing**: Vitest. Unit tier over pure domain logic (the capability map, guardianship eligibility,
ownership transfer, and the last-guardian rule are all pure functions over value objects);
integration tier against real PostgreSQL, which is the only place RLS and the partial unique indexes
can be verified; a parameterised cross-family authorization test over every route accepting a
`:familyId`

**Target Platform**: Linux container ([ADR-014](../../adr/ADR-014-containerized-development.md)),
deployed to the Stage 0 VPS ([ADR-013](../../adr/ADR-013-staged-hosting-model.md))

**Project Type**: Modular monolith — one NestJS HTTP host over shared workspace packages
([ADR-002](../../adr/ADR-002-modular-monolith.md))

**Performance Goals**: `FamilyContextPort.resolve` under 5 ms as a single indexed lookup — it runs
in the guard on **every** family-scoped request, ahead of everything else; `withFamilyContext`
adding under 2 ms to a transaction the command needed anyway; family-scoped reads p95 under 200 ms.
See [research.md §12](research.md)

**Constraints**: RLS must be genuinely in force before the first family-scoped row exists, which
requires a non-owner application role ([research.md §1](research.md)); repositories may not accept a
family identifier as a parameter (Principle IV); `packages/core` must remain free of NestJS, Prisma
and cloud SDK dependencies in its `package.json`; no personal data in logs, metric labels, spans or
outbox payloads

**Scale/Scope**: Stage 0, single VPS, synthetic data, no real users. Designed for thousands of
families with a handful of members each. No cap on family size is imposed (spec.md Assumptions)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS, conditional on one ADR merging before the implementation pull request.**
Re-checked after Phase 1: unchanged, with three deviations moved into Complexity Tracking.

### Gating item — must merge first

| # | Item | Why it gates |
|---|---|---|
| 1 | **ADR-017: Tenant isolation at the database — the application role and `FORCE ROW LEVEL SECURITY`** | The constitution requires an ADR before implementation for anything that "changes a security, privacy or authorization control". [ADR-003](../../adr/ADR-003-database-orm.md) decided *that* RLS is layer five and *how* the family id is bound (`SET LOCAL app.family_id`); it did not decide who the application connects as, and the answer today makes RLS inert. Splitting the owner and application roles changes the connection topology of every environment, is expand-and-contract work if done after the tables are populated, and is inherited by every context that follows. [research.md §1](research.md) is its input; it amends ADR-003's row-level-security section rather than superseding it |

**Resolved during planning, not gating.** spec.md was missing the Personal Data, Deletion and
Export section that Principle XI makes mandatory ("a specification missing any of these five is
incomplete and MUST NOT proceed to implementation"). Rather than fail the gate, the five answers
were written into spec.md as part of this planning pass, sourced from
[data-model.md](data-model.md)'s retention and export tables.

**Not gating, deliberately.** No ADR is required for the capability catalogue, even though it is
plainly an authorization control, because the whole purpose of the role-to-capability indirection is
that changing it is cheap — the reasoning is in [research.md §4](research.md), and if it were wrong
the design would have failed at ARCHITECTURE §5.2's stated goal.

### Principle-by-principle

| Principle | Status | Note |
|---|---|---|
| I. Type safety is a contract | Pass | `FamilyId`, `FamilyMemberId`, `InvitationId`, `GuardianshipId` branded in `@fp/kernel`. `kind` and `role` are discriminated unions, not optional-field modelling. `AddMemberRequest` omits `'adult'` and `CreateInvitationRequest` omits `'owner'` from their unions, so two whole error classes are unrepresentable rather than validated. No `any` |
| II. Validate at every boundary | Pass | Inbound parsed by the contract's Zod schemas before a handler observes them. `composition` is `jsonb` and is parsed on read, not trusted (Principle II applies to raw database results too) |
| III. Boundaries enforced, not suggested | Pass | ARCHITECTURE §8 already lists `core/family/{domain,application}` and §5.2 defines the context in full — no drift to reconcile, unlike spec 006. New allowed edges: `apps/api → core/family`, `core/family/application → core/compliance/application/ports`, `persistence → core/family`, `persistence → core/compliance`. `.dependency-cruiser.cjs`'s `WORKSPACE_GRAPH` needs no new key: `packages/core` and `packages/persistence` are already admitted; the fine-grained work is in the per-directory rules |
| IV. Persistence through the data-access layer | Pass | `withFamilyContext` constructs every repository against one transaction that already carries `app.family_id`; no repository method takes a family parameter ([research.md §2](research.md)). Two reads sit outside it by necessity — standing resolution and invitation acceptance — each exported as one narrow function with the argument written down ([research.md §3](research.md), [data-model.md](data-model.md)) |
| V. Object-level authorization | Pass — **this feature is where it becomes real** | Layer 2 is `FamilyMembershipGuard`, layer 3 the capability check, layer 4 `withFamilyContext`, layer 5 the RLS policies (gating item 1). Cross-family access returns 404 unconditionally, asserted by one parameterised test over the whole route table. Every denial is audited. Code checks capabilities; the string `'owner'` appears in no authorization decision |
| VI. Children and family data sensitive by default | Pass | Children carry no `user_id` and no `role` above `viewer`, enforced by check constraints as well as by the domain. Guardianship is explicit and required for a child's personal details regardless of role. Every read of those details is audited with actor, subject, purpose and result. Two personal fields on a member (`displayName`, `dateOfBirth`), each justified in [data-model.md](data-model.md). No personal data in events, logs or metrics |
| VII. AI proposes, the domain decides | Not applicable | No AI surface |
| VIII. Async work through the event system | Pass, **with the same staging spec 006 chose** | All six events written as outbox rows in the state change's own transaction (ADR-005 Layer 2, in full). Relay still deferred — this feature creates no consumer, and FR-023 says so explicitly. Recorded in Complexity Tracking; reasoning in [research.md §10](research.md) |
| IX. API contracts are versioned, shared artefacts | Pass | `packages/contracts/src/v1/family.contract.ts`, additive within `/v1`. Idempotency keys on every creating route. Rate limits per route, strictest on invitation sending, which is the feature's outbound-abuse surface |
| X. Infrastructure is code | Pass | The new database role, its grants and its credential are created by migration and by the Pulumi stack, never by hand. The credential is resolved at runtime from the secret store, not committed and not a build argument |
| XI. Deletion and export designed, not retrofitted | Pass — **after this pass added the section to spec.md** | `ErasurePort.eraseForFamily` and `eraseForMember` implemented from the start. Member removal and family erasure are separate operations with different outcomes ([research.md §11](research.md)). Family deletion is a request that publishes an event and voids invitations, never a `DELETE` |

### Additional engineering constraints

| Constraint | Status |
|---|---|
| UK-first without being UK-welded | Pass — `local_authority_code` is an identifier, never a council name; `postcode` is stored as supplied and validated by nobody here, because address validation belongs to Reference and Locale. Timestamps UTC with time zone |
| Observability is part of the feature | Pass — correlation id joining request, outbox row and audit entry; the five signals in [contracts/family-api.md](contracts/family-api.md), including an alert on any RLS-empty result and on any child with zero guardians |
| Testing weight follows risk | Pass — the capability map, eligibility rules and ownership transfer are pure and unit-tested; RLS, the partial unique indexes and the audit obligations can only be tested against a real database and are; authorization is tested per route, plus one parameterised cross-family sweep |
| New external dependencies are decisions | Pass — **none added**. Prisma, ts-rest and Zod are already owned by ADR-003 and ADR-006 |
| Cost is a design constraint | Pass — no new paid infrastructure. The deferred relay is this principle applied directly; a second database role costs nothing |

## Project Structure

### Documentation (this feature)

```text
specs/008-family-membership/
├── spec.md                 # Feature specification (/speckit-specify, clarified)
├── plan.md                 # This file (/speckit-plan output)
├── research.md             # Phase 0 output — 12 decisions, one of them an ADR gate
├── data-model.md           # Phase 1 output — tables, invariants, capability map, events
├── quickstart.md           # Phase 1 output — 8 runnable scenarios
├── contracts/              # Phase 1 output
│   └── family-api.md       #   Routes, the child boundary, error types, authorization matrix
├── checklists/
│   └── requirements.md     # Spec quality checklist (passing)
└── tasks.md                # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Directories marked **new** do not exist yet.

```text
packages/
├── kernel/                                   # EXTENDED
│   └── src/
│       ├── branded-id.ts                     #   + FamilyId, FamilyMemberId,
│       │                                     #     InvitationId, GuardianshipId
│       ├── email-address.vo.ts               #   MOVED here from core/identity/domain, so
│       │                                     #     invitation acceptance and account lookup
│       │                                     #     normalise identically (research.md §8)
│       └── errors.ts                         #   + the family error kinds
│
├── core/
│   ├── identity/                             # EXTENDED — re-exports EmailAddress from the
│   │                                         #   kernel; no other change (FR-022 unaffected)
│   ├── family/                               # NEW — the tenant root
│   │   ├── domain/
│   │   │   ├── family.aggregate.ts
│   │   │   ├── family-member.aggregate.ts    #     kind × role, and the invariants between them
│   │   │   ├── invitation.aggregate.ts
│   │   │   ├── guardianship.ts
│   │   │   ├── capabilities.ts               #     the role → capability map. Pure
│   │   │   ├── household-profile.vo.ts
│   │   │   └── events.ts                     #     the six, versioned
│   │   └── application/
│   │       ├── ports/
│   │       │   ├── family-context.port.ts    #     THE open host service (FR-019, FR-020)
│   │       │   ├── family-unit-of-work.port.ts
│   │       │   ├── family.repository.ts
│   │       │   ├── family-member.repository.ts
│   │       │   ├── invitation.repository.ts
│   │       │   ├── guardianship.repository.ts
│   │       │   └── erasure.port.ts           #     Principle XI, from the start
│   │       ├── commands/                     #     create-family, add-member, invite,
│   │       │   └── …                         #     accept, revoke, change-role, remove,
│   │       │                                 #     transfer-ownership, grant/end-guardianship,
│   │       │                                 #     request-family-deletion
│   │       └── queries/                      #     resolve-family-context, list-families,
│   │                                         #     list-members, read-member (guardian-gated)
│   └── compliance/                           # NEW — the minimum of §5.12, no more
│       ├── domain/audit-entry.ts
│       └── application/ports/audit-log.port.ts
│
├── contracts/                                # EXTENDED
│   └── src/v1/family.contract.ts
│
├── persistence/                              # EXTENDED
│   ├── prisma/schema.prisma                  #   family, family_member, invitation,
│   │                                         #   guardianship, audit_log
│   ├── prisma/migrations/…                   #   + the app role, its grants, ENABLE and
│   │                                         #     FORCE RLS, and the policies (ADR-017)
│   └── src/
│       ├── family-context.ts                 #   withFamilyContext — the scoped unit of work
│       │                                     #   (replaces the TODO in client.ts)
│       └── repositories/
│           ├── family/                       #   scoped by construction; no family parameter
│           └── compliance/audit-log.repository.ts
│
└── testing/                                  # EXTENDED — family factories, and a helper that
                                              #   asserts a route returns 404 across families

apps/
├── api/                                      # EXTENDED
│   └── src/family/
│       ├── family.controller.ts
│       ├── family-membership.guard.ts        #   layer 2: resolve or 404, always audited
│       ├── capability.guard.ts               #   layer 3: capabilities, never role strings
│       ├── family.module.ts
│       └── *.integration.spec.ts             #   incl. the parameterised cross-family sweep
│                                             #   and the RLS-is-actually-on test
└── worker/                                   # EXTENDED
    └── src/sweeps/
        ├── expire-invitations.sweep.ts       #   FR-012
        └── guardian-coverage.sweep.ts        #   SC-006's gauge (research.md §6)

docker-compose.yml                            # EXTENDED — the app role's connection string
infrastructure/                               # EXTENDED — the role and its secret in the stack
```

**Structure Decision**: the same four-layer hexagonal shape spec 006 established, with one addition
that is specific to being the tenant root. `core/family/application/ports/family-context.port.ts` is
this context's **published language** — a plain DTO of `memberId`, `role` and `capabilities[]`, with
no domain type in its signature — because §7.1 permits another context to depend on that interface
and forbids it depending on anything else here. Every later context will import that one file and
nothing else from `core/family`, and the `.dependency-cruiser.cjs` rule that enforces it is written
in this feature, before there is a consumer to catch.

The second decision worth naming is that `withFamilyContext` lives in `packages/persistence` and is
the *only* way family repositories are constructed. Layer 4 of ARCHITECTURE §9 is not a convention
here: `familyMemberRepository.findById(memberId)` has no family parameter to forget, because the
repository was built from a transaction that already carries the scope.

## Complexity Tracking

> Four deviations, each recorded so a future reader finds it stated rather than inferred. The first
> continues a decision spec 006 already made; the rest are new to this feature.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| ADR-005 Layer 3 (SQS relay, queues, DLQs) still not built, though Principle VIII mandates the event system | Layer 2's outbox — the part that prevents silent loss — is built in full and transactionally for all six events. This feature creates no consumer, and FR-023 requires the events to be published regardless. Continues spec 006 research §5 rather than re-deciding it | Building the relay now provisions a component before the trigger that justifies it, which the constitution's cost principle forbids by name, and requires AWS, which ADR-013 defers to Stage 1. Trigger to build: the first cross-context consumer, which is Calendar or Documents |
| Audit writes are direct synchronous inserts, not outbox rows, though §7.3 says any non-read effect crossing a context boundary goes through the outbox | A **denial** has no domain transaction to attach an outbox row to — nothing was written, that is the point — and denials are the case Principle V cares most about. The audit log is an append-only sink with no reader in the request path and no business rule attached, not another context's domain state ([research.md §7](research.md)) | Relaying audit rows through a queue would mean the compliance record of a denial arrives after the denial, over infrastructure that does not exist at Stage 0, in exchange for durability the same-transaction insert already provides on the granted path |
| `audit_log` is deliberately outside the family-scoped RLS set, though Principle V requires RLS on every family-scoped table | A denial is frequently recorded when `app.family_id` is unset or names a different family — exactly the row a policy would discard, and exactly the row that matters. Isolation is provided instead by grants: the application role holds `INSERT` only, no `SELECT`, which is §5.12's "append-only, no update or delete grants" as a grant rather than a convention | There is no simpler alternative; the rule genuinely does not apply to a cross-tenant compliance sink. It is recorded because the CI check flags family-scoped tables lacking RLS, and this table must read as a decision rather than an oversight — the same treatment spec 006 gave identity's tables |
| SC-006 ("zero child records with fewer than one active guardian, at every point in time") is enforced by the domain and monitored by a sweep, not by a database constraint, while its sibling SC-007 is enforced by a partial unique index | The assertion is over the *absence* of rows in another table, which PostgreSQL cannot express as a constraint without a trigger ([research.md §6](research.md)). All three routes to violating it are closed in the domain inside the mutating transaction, each with its own integration test, and `family_children_without_guardian` alerts on any value above zero | A PL/pgSQL trigger would put a load-bearing domain rule where none of the repository's tests can reach it, against ADR-003's central argument. A denormalised `guardian_count` column would be a second source of truth that drifts silently — the failure mode being guarded against here is precisely a child record quietly becoming unreachable |
