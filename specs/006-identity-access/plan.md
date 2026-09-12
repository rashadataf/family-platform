# Implementation Plan: Identity and Access

**Branch**: `006-identity-access` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-identity-access/spec.md`

## Summary

The platform's first real bounded context, and the one every other context transitively depends on
through `UserId`. Delivers account registration with email verification, credential-based
authentication, session issuance with rotation and individually-revocable sessions, and account
deletion — publishing `UserRegistered`, `UserAuthenticated` and `UserDeletionRequested` through the
transactional outbox.

Credential storage and session handling are **self-hosted behind application ports**, not delegated
to a managed identity provider. That decision is forced by FR-023 rather than by cost: free managed
tiers are generous, but the most generous of them revokes on a 60-second JWT expiry, and spec.md
requires a revoked credential to fail on its very next use. Full reasoning, including what this
costs us, is in [research.md §1](research.md).

Because this is the first context, the feature also has to establish the package skeleton every
later context will occupy — `kernel`, `core`, `contracts` and `platform` do not exist yet. That is
the bulk of the work, and it is why this feature is larger than its four user stories suggest.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24

**Primary Dependencies**: NestJS 11 + `@ts-rest/nest` (`apps/api`); ts-rest + Zod 3 (`packages/contracts`); Prisma 6 (`packages/persistence`); `@node-rs/argon2` (`packages/platform`); Mailpit (Compose service, Stage 0 mail sink)

**Storage**: PostgreSQL 16 via Prisma, per [ADR-003](../../adr/ADR-003-database-orm.md). New tables: `user`, `session`, `device`, `email_verification`, `outbox_event`

**Testing**: Vitest. Unit tier over pure domain logic with no I/O; integration tier against a real PostgreSQL through the existing `packages/testing` harness; contract and per-route authorization tests against the ts-rest binding

**Target Platform**: Linux container ([ADR-014](../../adr/ADR-014-containerized-development.md)), deployed to the Stage 0 VPS ([ADR-013](../../adr/ADR-013-staged-hosting-model.md))

**Project Type**: Modular monolith — one NestJS HTTP host over shared workspace packages ([ADR-002](../../adr/ADR-002-modular-monolith.md))

**Performance Goals**: authentication endpoint p95 under 300 ms end to end, of which argon2id verification is budgeted ~100 ms; session validation (the FR-023 check, which runs on *every* authenticated request) under 5 ms as a single indexed lookup. See [research.md §8](research.md)

**Constraints**: FR-023 requires revocation state checked on every authenticated request, which rules out self-contained session tokens; `packages/core` must carry no NestJS, Prisma or cloud SDK dependency in its `package.json` (ARCHITECTURE.md §8.2's strongest enforcement layer); Stage 0 holds synthetic data only

**Scale/Scope**: Stage 0, single VPS, synthetic data, no real users. Designed for thousands of accounts, not millions — [ADR-013](../../adr/ADR-013-staged-hosting-model.md)'s Stage 1 trigger, not this feature, is what moves that

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS, conditional on two documents merging before the implementation pull request opens.**

### Gating items — must merge first

| # | Item | Why it gates |
|---|---|---|
| 1 | **ADR-007: Authentication — managed identity provider versus self-hosted** | The constitution requires an ADR before implementation for anything that "changes a security, privacy or authorization control" and for "a new external dependency that receives our data." `adr/README.md` already reserves slot 007 for exactly this decision. [research.md §1](research.md) is its input; it is not yet written |
| 2 | **`ARCHITECTURE.md` §8 correction** | §8's `packages/core/` tree does not list `identity`, though §5.1 defines it as a bounded context. Principle III forbids an implementation PR arriving before the document that establishes the boundary. Rides with ADR-007 — see [research.md §7](research.md) |

### Principle-by-principle

| Principle | Status | Note |
|---|---|---|
| I. Type safety is a contract | Pass | Strict mode already repo-wide. `UserId`, `SessionId`, `DeviceId` are branded types in `@fp/kernel`. No `any` |
| II. Validate at every boundary | Pass | Inbound requests parsed by the contract's Zod schemas before a handler observes them; environment parsed at boot by the existing loader |
| III. Boundaries enforced, not suggested | Pass **after gating item 2** | New allowed edges: `apps/api → core/identity/application`, `core/identity/application → core/identity/domain`, `persistence → core`, `platform → kernel`. `dependency-cruiser` and `eslint-plugin-boundaries` rules extended in the same PR |
| IV. Persistence through the data-access layer | Pass, **with a declared exception** | Repositories are normally constructed scoped to a resolved family context. Identity's tables are **not family-scoped by construction** (FR-018), so that rule cannot apply. Recorded in Complexity Tracking rather than left silent, because the CI check looks for family-scoped tables without row-level security and these tables must be explicitly declared out of that set |
| V. Object-level authorization | Pass, in its Identity-appropriate form | There is no family to authorize against here. The equivalent obligation is enforced and tested per route: a user may revoke only their own sessions (FR-012) and delete only their own account (FR-014). Cross-family assertions are not applicable — see [research.md §9](research.md) |
| VI. Children and family data sensitive by default | Pass | This context stores no child data, no family data and no profile beyond an email address. `UserId` only in event payloads and logs; spec.md's Personal Data section enumerates every field and its purpose |
| VII. AI proposes, the domain decides | Not applicable | No AI surface in this feature |
| VIII. Async work through the event system | Pass, **with a staged implementation** | Outbox rows written transactionally (ADR-005 Layer 2, honoured in full). SQS relay and `apps/worker` deferred — no consumer exists and Stage 0 has no AWS. Recorded in Complexity Tracking; rationale and trigger in [research.md §5](research.md) |
| IX. API contracts are versioned, shared artefacts | Pass | `packages/contracts` established here: Zod schemas bound with ts-rest at `/v1`, consumed by the server. Mutating endpoints accept an idempotency key. Rate limiting per route, stricter on the authentication routes |
| X. Infrastructure is code | Pass | Mailpit is added to the Compose service set and to the Stage 0 Pulumi stack, not created by hand. No new secret is committed |
| XI. Deletion and export designed, not retrofitted | Pass | spec.md answers all five questions in its Personal Data, Deletion and Export section. Erasure ports are implemented by this context from the start |

### Additional engineering constraints

| Constraint | Status |
|---|---|
| UK-first without being UK-welded | Pass — no UK-shaped primitive stored. Timestamps UTC with time zone |
| Observability is part of the feature | Pass — structured logs with correlation ids on every auth outcome; metrics on authentication success/failure rate, throttle activations and outbox lag |
| Testing weight follows risk | Pass — majority unit tests over pure domain logic; integration against real PostgreSQL; per-route authorization tests |
| New external dependencies are decisions | Pass — `@node-rs/argon2` justified in [research.md §2](research.md); ts-rest and Prisma already owned by ADR-006 and ADR-003. No new external *service* is adopted, which is the point of [research.md §1](research.md) and §4 |
| Cost is a design constraint | Pass — zero new paid infrastructure. The deferred relay in [research.md §5](research.md) is this principle applied directly |

## Project Structure

### Documentation (this feature)

```text
specs/006-identity-access/
├── spec.md              # Feature specification (/speckit-specify, clarified)
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── identity-api.md  # Route contracts, error types, authorization matrix
├── checklists/
│   └── requirements.md  # Spec quality checklist (passing)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Packages marked **new** do not exist yet and are established by this feature.

```text
packages/
├── kernel/                              # NEW — pure, dependency-free
│   └── src/
│       ├── result.ts                    #   Result<T, E>
│       ├── branded-id.ts                #   UserId, SessionId, DeviceId
│       ├── errors.ts                    #   domain error taxonomy
│       └── clock.port.ts                #   Clock port (no implementation)
│
├── core/                                # NEW — all bounded contexts, no framework/ORM/IO
│   └── identity/
│       ├── domain/
│       │   ├── user.aggregate.ts        #   User: email, credential, verification state
│       │   ├── session.aggregate.ts     #   Session: stable id, rotation, revocation
│       │   ├── device.ts
│       │   ├── email-address.vo.ts      #   normalises case (FR-022)
│       │   └── events.ts                #   UserRegistered, UserAuthenticated, …
│       └── application/
│           ├── ports/
│           │   ├── user.repository.ts
│           │   ├── session.repository.ts
│           │   ├── password-hasher.port.ts
│           │   ├── token-generator.port.ts
│           │   ├── mailer.port.ts
│           │   └── outbox.port.ts
│           ├── commands/                #   register, verify, authenticate,
│           │   └── …                    #   renew, revoke, request-deletion
│           └── queries/
│
├── contracts/                           # NEW — the API boundary (ADR-006)
│   └── src/v1/identity.contract.ts
│
├── platform/                            # NEW — infrastructure adapters
│   └── src/
│       ├── argon2-password-hasher.ts
│       ├── random-token-generator.ts
│       ├── smtp-mailer.ts               #   → Mailpit at Stage 0
│       └── system-clock.ts
│
├── persistence/                         # EXTENDED
│   ├── prisma/schema.prisma             #   user, session, device,
│   │                                    #   email_verification, outbox_event
│   └── src/repositories/identity/
│
└── testing/                             # EXTENDED — identity factories and fixtures

apps/
├── api/                                 # EXTENDED
│   └── src/identity/
│       ├── identity.controller.ts       #   @ts-rest/nest binding
│       ├── session.guard.ts             #   FR-023 check on every request
│       └── identity.module.ts           #   DI wiring
│
└── worker/                              # NEW — minimal: scheduled sweeps only
    └── src/sweeps/
        ├── erase-unverified.sweep.ts    #   FR-020, 30 days
        ├── erase-deleted-accounts.sweep.ts  # FR-019, 30 days
        └── erase-stale-sessions.sweep.ts    # 90 days

docker-compose.yml                       # EXTENDED — mailpit service
infrastructure/                          # EXTENDED — mailpit in the vps-staging stack
```

**Structure Decision**: The four-layer hexagonal shape from
[`ARCHITECTURE.md` §6](../../ARCHITECTURE.md), applied for the first time. `core/identity` holds
the aggregates and the ports; nothing in it imports NestJS, Prisma or any SDK, and that is enforced
by dependency *absence* in its `package.json` under pnpm's strict linking, not by lint rules alone
(§8.2's strongest layer). `apps/api` is the composition root and stays thin. The adapter split is
what makes [research.md §1](research.md)'s "replaceable identity" claim real: swapping to a managed
provider later replaces `platform` adapters and the guard, leaving the domain untouched.

## Complexity Tracking

> Two deliberate deviations, both recorded so a future reader finds them stated rather than
> inferred. Neither is a departure from an ADR's decision; both are stagings of one.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| ADR-005 Layer 3 (SQS queues, DLQs, outbox relay loop) not built, though Principle VIII mandates the event system | Layer 2's outbox — the part that prevents silent loss — *is* built in full and transactionally. Layer 3 would relay to zero consumers, and requires AWS, which [ADR-013](../../adr/ADR-013-staged-hosting-model.md) defers to Stage 1. `apps/worker` is still created, for the FR-019/FR-020 retention sweeps ADR-002 assigns to it | Building the relay now provisions a component before the trigger that justifies it, which the constitution's cost principle forbids by name. Trigger to build: the first consumer in another context ([research.md §5](research.md)) |
| Identity's tables are not family-scoped, so Principle IV's family-scoped repository construction and Principle V's row-level security do not apply to them | FR-018 forbids any family-scoped concept in this context by construction — a `User` answers who someone is, never what they may touch | There is no simpler alternative; the rule genuinely does not apply. It is recorded because the CI check flags family-scoped tables lacking row-level security, and these tables must be explicitly declared outside that set rather than appearing to have been overlooked |
