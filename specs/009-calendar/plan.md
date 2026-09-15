# Implementation Plan: Calendar

**Branch**: `009-calendar` | **Date**: 2026-09-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-calendar/spec.md`

## Summary

The first context built *on top of* the tenant root rather than beside it. Family (spec 008) proved
the isolation machinery works; Calendar is the first consumer of it, and most of what makes this
feature interesting is that consumption rather than the calendar itself.

`CalendarEvent` and `EventOccurrence` (ARCHITECTURE.md §5.3), the shared recurrence kernel §5.4
names, and a range query over materialised occurrences that the dashboard will later read.

Three things carry more weight than the five user stories suggest.

**FR-016 has no data path until the Family context grows one.** Restricting events with a child
participant to that child's guardians requires facts Calendar is forbidden to read — who is a child,
and who guards them. The answer is a second published port from Family,
`MemberVisibilityPort`, returning the members a reader may see rather than the ones they may not, so
that the failure mode is hiding too much rather than showing a child's appointments to the
household. Calendar then never learns who is a child at all. [research.md §1](research.md) works
through why this is not a widening of `FamilyContext` and why it needs no ADR.

**The recurrence kernel is the one piece of this feature another context inherits.** Tasks will
import the identical logic, and ARCHITECTURE §5.4 permits the shared kernel only because it is
"small, stable, pure". That means a subpath export with no runtime dependency, a declared subset of
RFC 5545 with everything outside it rejected at the boundary, and a stated rule for the two
mornings a year when a local time either does not exist or happens twice. Getting that wrong sends
a family to swimming an hour late in late October, and getting it wrong in a shared kernel sends
two contexts.

**Materialised occurrences are a cache with an authored attribute in them.** The architecture
chooses materialisation so the dashboard is an indexed range query; the cost is a background sweep
and a horizon, which the spec requires to be observable. The subtlety is FR-022's individually
cancelled occurrence: it makes the rebuild a reconcile rather than a regenerate, and it is only
cheap because FR-022 forbids *moving* an occurrence, which keeps `(event_id, starts_at)` a stable
identity. [research.md §5](research.md).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Node 24

**Primary Dependencies**: NestJS 11 + `@ts-rest/nest` (`apps/api`); ts-rest + Zod 3
(`packages/contracts`); Prisma 6.16 (`packages/persistence`). **No new external dependency** — the
recurrence engine is written in-house against Node's bundled ICU rather than taking `rrule` or a
date library, for the reasons in [research.md §2–§3](research.md)

**Storage**: PostgreSQL 16 via Prisma ([ADR-003](../../adr/ADR-003-database-orm.md)). Three new
tables: `calendar_event`, `event_occurrence`, `event_participant` — all family-scoped, all under
`ENABLE` **and** `FORCE ROW LEVEL SECURITY` per
[ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md). No new database role; spec 008's
`family_platform_app` and `family_platform_owner` are inherited unchanged

**Testing**: Vitest. The unit tier carries unusual weight here because the recurrence kernel is pure
by construction — RRULE parsing, expansion, the DST disambiguation rule and the occurrence cap are
all testable with no database and no clock. Integration tier against real PostgreSQL for RLS, the
`(event_id, starts_at)` uniqueness the sweep's idempotence rests on, and the guardian-visibility
filter; the parameterised cross-family sweep spec 008 built is extended to Calendar's routes

**Target Platform**: Linux container ([ADR-014](../../adr/ADR-014-containerized-development.md)),
Stage 0 VPS ([ADR-013](../../adr/ADR-013-staged-hosting-model.md))

**Project Type**: Modular monolith — one NestJS HTTP host plus a worker over shared workspace
packages ([ADR-002](../../adr/ADR-002-modular-monolith.md))

**Performance Goals**: `FamilyContextPort.resolve` stays under 5 ms — §1's port decision exists
specifically to keep the universal hot path untouched; `MemberVisibilityPort` under 2 ms; the 14-day
range query p95 under 200 ms at five years of history; a 400-day expansion under 20 ms of pure CPU.
[research.md §11](research.md)

**Constraints**: Calendar may import exactly two files from `core/family` and is asserted to by an
AST test; no repository method takes a family identifier (Principle IV); `packages/core` and
`packages/kernel` remain free of NestJS, Prisma and cloud SDKs in their `package.json`; the
recurrence subpath has no I/O, clock or randomness; no personal data in logs, metric labels, spans
or outbox payloads — which for this feature specifically means no event title, description or
location anywhere in an outbox row

**Scale/Scope**: Stage 0, single VPS, synthetic data. Designed for thousands of families; a
household with 50 recurring events materialises roughly 3,000 forward occurrence rows
([research.md §4](research.md))

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: PASS, with no gating item.** Re-checked after Phase 1: unchanged, with three deviations
recorded in Complexity Tracking.

### No ADR is required, and that is a decision rather than an omission

Spec 008 gated on [ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md) because it
changed the database connection topology. This feature has one candidate and it does not meet the
bar. Publishing `MemberVisibilityPort` from the Family context alters no context boundary, moves no
aggregate, changes which context owns no data, and adds no external dependency. §7.1 already names
"a published application port" as the mechanism for a cross-context read, and
`no-cross-context-internals` already admits `packages/core/[^/]+/application/ports/` from any
context — so this uses the sanctioned mechanism rather than amending it. FR-016 is an application of
Principle VI to a new context, which is what a feature spec is for; spec 008 made the same call
about its capability catalogue and recorded it the same way. Reasoning in full at
[research.md §1](research.md).

The change belongs to the **Family** context regardless, and is listed under `core/family` in the
structure below rather than smuggled in as something Calendar owns.

### Principle-by-principle

| Principle | Status | Note |
|---|---|---|
| I. Type safety is a contract | Pass | `CalendarEventId`, `EventOccurrenceId` branded in `@fp/kernel`. `RecurrenceRule` is a parsed value object, never a string passed around. All-day and timed events are a discriminated union rather than a nullable-time-plus-flag, so "all-day event with a start time" is unrepresentable. No `any` |
| II. Validate at every boundary | Pass | Inbound parsed by the contract's Zod schemas. The RRULE string is parsed into the declared subset and rejected with a specific error outside it ([research.md §2](research.md)) — a rule that parses loosely and expands wrongly is the failure this closes. IANA zone identifiers validated against the runtime's own zone set, not a regex |
| III. Boundaries enforced, not suggested | Pass | ARCHITECTURE §5.3 defines the context; no drift to reconcile. New allowed edges: `apps/api → core/calendar`, `core/calendar/application → core/family/application/ports` (the two published ports only), `persistence → core/calendar`. `WORKSPACE_GRAPH` needs no new key. The one enforcement weakness — the rule cannot distinguish a published port from a repository interface in the same directory — is closed by an AST test rather than left implicit ([research.md §1](research.md)) |
| IV. Persistence through the data-access layer | Pass | A `withFamilyContext` unit of work constructs every Calendar repository against one scoped transaction; no method takes a family parameter. The range query's visible-member filter is a bound array parameter, not interpolated SQL |
| V. Object-level authorization | Pass | Layers 2–5 inherited intact from spec 008: membership guard, capability check, scoped repositories, RLS. Calendar adds a sixth consideration *within* the family — the guardian filter of FR-016 — applied in the query rather than after it, so an excluded event is not observable through result counts. Cross-family access returns 404 via the extended parameterised sweep. Capabilities checked, never roles |
| VI. Children and family data sensitive by default | Pass — **and it is the feature's hardest requirement** | Events with a child participant reach only that child's guardians, evaluated at read time so a revoked guardianship takes effect immediately. Every permitted read of a child's participation is audited, and so is every denial. Calendar stores no age, no kind, no guardianship — only member ids — so there is no cached classification to go stale or to leak. Event titles are free text and are treated as personal data throughout, including being kept out of every outbox payload, log and metric label |
| VII. AI proposes, the domain decides | Not applicable | No AI surface. Worth noting that this context is a future AI *read* target, which is why the range query is a port rather than only a controller concern |
| VIII. Async work through the event system | Pass, **with the deferral spec 006 and 008 both made** | All four event types written as outbox rows in the state change's own transaction (ADR-005 Layer 2, in full). `OccurrenceMaterialised` is published per window rather than per occurrence, so a horizon extension writes one row rather than hundreds ([research.md §6](research.md)). Relay still deferred — Calendar consumes nothing; recorded in Complexity Tracking |
| IX. API contracts are versioned, shared artefacts | Pass | `packages/contracts/src/v1/calendar.contract.ts`, additive within `/v1`. Idempotency keys on every creating route. Rate limits per route, strictest on the range query, which is the feature's cheapest-to-abuse read |
| X. Infrastructure is code | Pass | No new infrastructure. The sweep is a worker entry point in an existing process; no queue, no bucket, no role, no credential |
| XI. Deletion and export designed, not retrofitted | Pass | `ErasurePort.eraseForFamily` and `eraseForMember` implemented from the start. Family erasure is trivially complete because every row is family-scoped and RLS enforces it. Member deletion's one honest limitation — free-text titles are not machine-scrubbed — is stated in spec.md rather than implied away ([research.md §10](research.md)) |

### Additional engineering constraints

| Constraint | Status |
|---|---|
| UK-first without being UK-welded | Pass — time zones are IANA identifiers; the recurrence kernel takes holidays through a provider interface and, per FR-014, does not consult them at all, so there is no jurisdiction fixed into it. The two UK clock changes are the *test* bar, not a code path. Timestamps UTC with time zone |
| Observability is part of the feature | Pass — `materialised_through` per event makes the horizon-lag gauge a `min()` rather than a computation, with an alert on it; correlation id joins request, outbox row and audit entry. No event title, description or location in any signal |
| Testing weight follows risk | Pass — the recurrence kernel is pure and carries the heaviest unit suite in the repository, including both clock-change weekends as fixtures; RLS, occurrence uniqueness and the guardian filter are integration-only and are; authorization tested per route plus the cross-family sweep |
| New external dependencies are decisions | Pass — **none added**. `rrule` and a date library were both considered and rejected with reasons ([research.md §2–§3](research.md)) |
| Cost is a design constraint | Pass — no new paid infrastructure. The per-window `OccurrenceMaterialised` decision is this principle applied to the outbox: the naive version would write hundreds of rows to buy nothing |

## Project Structure

### Documentation (this feature)

```text
specs/009-calendar/
├── spec.md                 # Feature specification (/speckit-specify, clarified)
├── plan.md                 # This file (/speckit-plan output)
├── research.md             # Phase 0 output — 12 decisions, no ADR gate
├── data-model.md           # Phase 1 output — tables, invariants, events, retention
├── quickstart.md           # Phase 1 output — 9 runnable scenarios
├── contracts/              # Phase 1 output
│   └── calendar-api.md     #   Routes, the guardian boundary, error types, authorization matrix
├── checklists/
│   └── requirements.md     # Spec quality checklist (passing)
└── tasks.md                # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Directories marked **new** do not exist yet.

```text
packages/
├── kernel/                                    # EXTENDED
│   ├── package.json                           #   + "./recurrence" subpath export
│   └── src/
│       ├── branded-id.ts                      #   + CalendarEventId, EventOccurrenceId
│       ├── errors.ts                          #   + the calendar error kinds
│       └── recurrence/                        # NEW — THE shared kernel (ARCHITECTURE §5.4)
│           ├── index.ts                       #     the subpath's public surface
│           ├── rrule.vo.ts                    #     parse + serialise the declared subset
│           ├── expand.ts                      #     local-terms expansion over a window
│           ├── zoned-time.ts                  #     Intl-based local↔instant, DST rules
│           ├── public-holiday.port.ts         #     the seam Reference and Locale fills
│           └── *.spec.ts                      #     pure, exhaustive, both clock weekends
│
├── core/
│   ├── family/                                # EXTENDED — the change FR-016 requires
│   │   └── application/ports/
│   │       └── member-visibility.port.ts      #   NEW published port (research.md §1)
│   ├── calendar/                              # NEW — ARCHITECTURE §5.3
│   │   ├── domain/
│   │   │   ├── calendar-event.aggregate.ts    #     timed | all-day as a discriminated union
│   │   │   ├── event-occurrence.ts            #     derived, with one authored attribute
│   │   │   ├── event-participant.ts           #     member ids only; no kind, no age
│   │   │   ├── materialisation.ts             #     the reconcile rule (research.md §5). Pure
│   │   │   └── events.ts                      #     the four, versioned
│   │   ├── application/
│   │   │   ├── ports/
│   │   │   │   ├── calendar-unit-of-work.port.ts
│   │   │   │   ├── calendar-event.repository.ts
│   │   │   │   ├── event-occurrence.repository.ts
│   │   │   │   ├── calendar-read.port.ts      #     the range query, published for the
│   │   │   │   │                              #     dashboard and the AI read path later
│   │   │   │   └── erasure.port.ts            #     Principle XI, from the start
│   │   │   ├── commands/                      #     create-event, update-event, cancel-event,
│   │   │   │   └── …                          #     cancel-occurrence, materialise-horizon
│   │   │   └── queries/                       #     list-occurrences (guardian-filtered),
│   │   │                                      #     get-event
│   │   └── reads-family-only-through-published-ports.spec.ts   # AST discipline test
│   └── compliance/                            # EXTENDED — child-read audit reasons
│
├── contracts/                                 # EXTENDED
│   └── src/v1/calendar.contract.ts
│
├── persistence/                               # EXTENDED
│   ├── prisma/schema.prisma                   #   calendar_event, event_occurrence,
│   │                                          #   event_participant
│   ├── prisma/migrations/…                    #   + ENABLE and FORCE RLS, policies, and the
│   │                                          #     (event_id, starts_at) unique index
│   └── src/repositories/
│       ├── calendar/                          #   scoped by construction
│       └── family/member-visibility.ts        #   the new port's adapter, over the existing
│                                              #   listActiveChildIdsGuardedBy
│
└── testing/                                   # EXTENDED — calendar factories, a fixed-clock
                                               #   helper, and both clock-change fixtures

apps/
├── api/                                       # EXTENDED
│   └── src/calendar/
│       ├── calendar.controller.ts
│       ├── calendar.module.ts
│       └── *.integration.spec.ts              #   incl. the guardian-visibility suite and the
│                                              #   extended cross-family sweep
└── worker/                                    # EXTENDED
    └── src/sweeps/
        └── materialise-occurrences.sweep.ts   #   extends the horizon, prunes the trailing
                                               #   window, advances materialised_through
```

**Structure Decision**: the four-layer hexagonal shape spec 006 established and spec 008 extended,
with two placements that are specific to this feature.

`packages/kernel/src/recurrence/` is a **subpath, not a package**. ADR-001 makes the workspace
package count a deliberate decision and an eleventh package would carry its own tsconfig, eslint
config, build target and `verify-workspace-packages` entry to hold one directory. The subpath gets
the import-level separation that matters — `@fp/kernel/recurrence` keeps an RRULE engine out of
every module that imports `Result` — for none of the overhead ([research.md §2](research.md)).

`member-visibility.port.ts` is placed under **`core/family`**, not `core/calendar`, because the
Family context owns guardianship and publishing this port is that context's decision to make. It is
listed here so a reviewer sees that this feature edits another context deliberately and in one named
file, rather than discovering it in a diff.

## Complexity Tracking

> Three deviations. The first continues a decision made twice already; the other two are new.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| ADR-005 Layer 3 (SQS relay, queues, DLQs) still not built, though Principle VIII mandates the event system | Layer 2's outbox — the part that prevents silent loss — is built in full and transactionally for all four event types. Spec 008 named the trigger as "the first cross-context consumer, which is Calendar or Documents"; Calendar turns out to *publish* and consume nothing, so the trigger has not fired. Restated precisely: the trigger is **the first context that subscribes**, which is Reminders | Building the relay now provisions a component before the trigger that justifies it, which the cost principle forbids by name, and requires AWS, which ADR-013 defers to Stage 1. Three specs have now deferred it on the same reasoning, which is itself a signal worth watching: if Reminders is not next, this deferral should be re-argued rather than repeated a fourth time |
| `OccurrenceMaterialised` is published once per (event, window) rather than once per occurrence, though FR-030 reads as one event per state change | A horizon extension for a daily event produces 400 rows in one transaction, and a family's first materialisation thousands. The outbox's oldest unpublished row is the constitution's single most important operational metric, and filling it with derived-data notifications would drown the signal it exists to carry. Per-window also matches the only nameable consumer: Reminders needs "event X now has occurrences through Y", then reads the rows ([research.md §6](research.md)) | Per-occurrence events would make the outbox a materialisation log. §7.3 requires cross-context side effects to go through the outbox, not that every row insert is an integration event — and the occurrences themselves are derived data reconstructible from the event and its rule |
| The recurrence engine is written in-house rather than taking a maintained library, against the general preference for not reimplementing solved problems | ARCHITECTURE §5.4 requires the shared kernel to be dependency-free, and the constitution makes a runtime dependency a justified decision. `rrule` operates on naive or UTC dates and its time-zone handling is the known-weak part — which is precisely the part this component exists to get right. The scope is bounded by declaring the supported subset and rejecting everything else at the boundary with a specific error ([research.md §2](research.md)) | Taking `rrule` plus a date library would add two runtime dependencies to the one package the architecture requires to have none, and would leave the DST correctness this feature is measured on (SC-003) inside a dependency rather than under our own exhaustive tests. Revisit if `Temporal` ships natively in Node, which would shrink `zoned-time.ts` to almost nothing |
