# Phase 0 Research: Calendar

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-14

Twelve decisions. Two were named as open before planning began — how Calendar learns which
members it may show (§1), and how the recurrence kernel is exposed and kept pure (§2) — and the
rest are the choices that fall out of them.

---

## 1. How Calendar learns which members it may show

**The problem, stated exactly.** [FR-016](spec.md) restricts every event with a child participant
to that child's guardians. Calendar therefore has to answer, on every range query, "which of this
family's members may this reader see?" It cannot answer it from its own data, because *which
members are children* and *who guards them* are both facts owned by the Family context. And
[FR-027](spec.md) forbids Calendar from reading family, member or guardianship data by any means
other than the Family context's published port.

That port, today, is not enough. `resolveFamilyContext` returns exactly
`{ memberId, role, capabilities }` — verified in
[`resolve-family-context.query.ts`](../../packages/core/src/family/application/queries/resolve-family-context.query.ts) —
and carries nothing about guardianship. So FR-016 has no legal data path as things stand, and this
is the first decision the feature has to make.

**Decision: publish a second narrow port from the Family context,
`MemberVisibilityPort`, rather than widening `FamilyContext`.**

```ts
// packages/core/src/family/application/ports/member-visibility.port.ts
export interface MemberVisibilityPort {
  /**
   * The members of one family whose records `viewerMemberId` may reach:
   * every adult member, plus the children they actively guard.
   */
  resolveVisibleMemberIds(
    viewerMemberId: FamilyMemberId,
    familyId: FamilyId,
  ): Promise<readonly FamilyMemberId[]>;
}
```

**Why a second port rather than a field on `FamilyContext`.** Three reasons, in order of weight.

The first is the hot path. `FamilyContextPort.resolve` runs in the membership guard on *every*
family-scoped request, ahead of everything else, and spec 008 budgeted it at under 5 ms as a single
indexed lookup ([spec 008 plan.md](../008-family-membership/plan.md)). Guardianship resolution
would join that budget permanently, on every identity, family, document and task request that will
ever exist, to serve one context's read path. The cost is small per request and it is paid by
everything forever, which is the shape of cost that is hardest to remove later.

The second is that `family-context.port.ts` says of itself that `FamilyContext` is "a plain DTO by
design: no `FamilyMember`, no aggregate, nothing whose shape this context might want to change
without warning everyone downstream." A list of member ids that moves as guardianships are granted
and revoked is a different kind of value from a stable statement of standing, and putting it in the
same object invites a downstream context to cache one while relying on the freshness of the other.

The third is that the house pattern already exists.
[`family-directory.port.ts`](../../packages/core/src/family/application/ports/family-directory.port.ts)
is a second published port, added by spec 008 for exactly this reason — a question the scoped
repository could not answer without making "this repository can only see one family" untrue. Narrow
purpose-specific ports rather than one widening context object is the precedent, and following it
costs nothing.

**Why the port returns what a reader *may* see, not what they may not.** A "restricted ids"
shape — the children this reader does *not* guard — is smaller and would usually be empty, which is
tempting. It fails open: an empty array is both the normal answer for a guardian and the answer a
broken implementation returns, and the two are indistinguishable at the call site, so the failure
mode is *showing a child's appointments to everyone*. The visible-set shape fails closed. An empty
result hides everything, which is loud, wrong in the safe direction, and consistent with how the
rest of the platform fails — `current_setting('app.family_id', true)` returning `NULL` yields no
rows rather than all rows ([ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md)).

**What this buys beyond FR-016: Calendar never learns who is a child.** With a visible-set the
filter is "does this event have a participant outside my visible set", which needs no notion of
member kind, age or guardianship inside Calendar at all. Calendar stores participant member ids and
nothing else about those people, so there is no Family-owned classification denormalised into
Calendar's tables to go stale when a child is one day promoted to a linked account (the deferred
`linkUserToMember` command). Data minimisation here is a by-product of getting the boundary right
rather than a separate discipline.

**Implementation sits on a query that already exists.**
[`GuardianshipRepository.listActiveChildIdsGuardedBy`](../../packages/core/src/family/application/ports/guardianship.repository.ts)
was built by spec 008 for the member roster's `dateOfBirth` omission. The port's adapter in
`packages/persistence` composes that with the member list inside one `withFamilyContext`
transaction. No new query pattern, no new index beyond what spec 008 already created.

**Cost, stated honestly.** One extra family-scoped transaction per calendar read, on top of the one
Calendar opens for its own occurrence query — the port adapter cannot join a transaction it was not
given, and this codebase's ports do not take transactions. Budgeted in §11 at under 2 ms. The
alternative that removes it is to widen `FamilyContext`, and that trades 2 ms on calendar reads for
a smaller amount on every request in the system.

**Alternatives considered**

| Alternative | Rejected because |
|---|---|
| Widen `FamilyContext` with `guardedChildIds` | Taxes the universal hot path for one context's need, and mixes a volatile list into a stable standing DTO. It is the cheapest thing to build and the most expensive thing to have built |
| Calendar denormalises "is a child" onto its participant rows | Copies Family-owned classification into Calendar, where it goes stale the moment a member's kind changes, and creates exactly the data the erasure saga struggles to reach. Also re-derives a privacy control from a cached flag |
| Calendar's unit of work reads the family tables directly, since it is the same database | Straightforwardly against FR-027 and §7.1. The boundary is about which context owns the query, not which physical database answers it; this is the "one convenient import" Principle III's rationale names |
| Family exposes a filter callback Calendar applies | Inverts control for no gain and puts a predicate over Calendar's rows inside the Family context, which then has to know Calendar's shape |

**Does this need an ADR? No — and the reasoning is recorded rather than assumed.** The
constitution requires an ADR before a change that alters a context boundary, moves an aggregate,
changes which context owns data, or changes a security, privacy or authorization control. This
does none of those. Guardianship stays owned by Family; no table moves; the boundary mechanism is
unchanged. §7.1 already prescribes "a published application port" as *the* way a context reads
another's data, and `no-cross-context-internals` in `.dependency-cruiser.cjs` already admits
`packages/core/[^/]+/application/ports/` from any context — so adding a file there uses the
sanctioned mechanism rather than amending it. FR-016 itself is an application of Principle VI to a
new context, which is what every feature spec does; spec 008 made the same call about its
capability catalogue and recorded it the same way.

The change is nonetheless *in the Family context* and belongs in that context's directory, its
tests and its review. It is listed in the plan's structure as an extension to `core/family`, not as
something Calendar owns.

**One weakness in the enforcement, recorded because it is not currently fixable by a rule.**
`no-cross-context-internals` admits everything under another context's `application/ports/`, which
includes `guardianship.repository.ts` and the other repository interfaces. Nothing mechanical stops
Calendar importing a Family *repository* instead of a published port. The rule cannot tell the two
apart while both live in the same directory. Rather than restructure spec 008's directories, this
feature adds an AST discipline test in the shape spec 008 already established with
[`checks-capabilities-not-roles.spec.ts`](../../apps/api/src/family/checks-capabilities-not-roles.spec.ts)
and [`no-family-references.spec.ts`](../../packages/core/src/identity/no-family-references.spec.ts):
`packages/core/src/calendar/reads-family-only-through-published-ports.spec.ts`, asserting that
Calendar's imports from `core/family` name only `family-context.port.js` and
`member-visibility.port.js`.

---

## 2. The recurrence kernel: exposure, purity, and how much of RFC 5545

**Decision: a subpath export, `@fp/kernel/recurrence`, with its own directory, no runtime
dependency, and a declared subset of RFC 5545.**

`packages/kernel/package.json` today exposes a single entry point:

```json
"exports": { ".": "./dist/index.js" }
```

It gains a second:

```json
"exports": {
  ".": "./dist/index.js",
  "./recurrence": "./dist/recurrence/index.js"
}
```

**Why a subpath rather than the existing root export.** The kernel's root is a grab-bag of
cross-cutting primitives — `Result`, branded ids, port interfaces — that nearly everything imports.
Recurrence is a substantial, self-contained body of logic that two contexts will import and
everything else will not. A subpath keeps `import { ok } from '@fp/kernel'` from dragging an RRULE
engine into the identity module's bundle, and it makes the shared-kernel boundary visible in the
import statement, which matters for a component ARCHITECTURE §5.4 calls "the only shared kernel in
the system" and justifies only because it is "small, stable, pure".

**Why a separate package was rejected.** `@fp/kernel-recurrence` would be an eleventh workspace package
carrying its own tsconfig, eslint config, build target and `verify-workspace-packages` entry, to
hold one directory. ADR-001's package count is a deliberate decision and spec 008's plan already
treats adding one as a cost. A subpath gets the same import-level separation for none of it.

**Purity, and how it is enforced rather than asserted.** No I/O, no clock, no randomness — the
expansion takes the window it should expand into as an argument, so "now" never appears inside it.
This is the same construction the rest of the kernel uses: `clock.port.ts` is an *interface*, and
the kernel has never held an implementation. Enforced three ways: the directory has no imports
outside itself and `@fp/kernel`'s own primitives; `packages/kernel` already declares no runtime
dependencies in `package.json`, which under ADR-001's strict linking makes reaching for one a build
failure rather than a review comment; and a unit test asserts the same expansion called twice with
the same arguments returns identical results.

**No external dependency, and the subset that makes that reasonable.** ARCHITECTURE §5.4 requires
the kernel to be dependency-free, and the constitution makes a new runtime dependency a decision
requiring justification. `rrule` is the obvious candidate and is rejected on both counts, plus a
third: it operates on naive or UTC dates and its time-zone handling is the known-hard part, which
is precisely the part this component exists to get right. Writing the whole of RFC 5545 in-house
would be a poor trade in the other direction, so the subset is declared and anything outside it is
rejected at the boundary under Principle II:

| Supported | `FREQ` (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY`), `INTERVAL`, `COUNT`, `UNTIL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `WKST` |
|---|---|
| **Rejected, with a specific error** | `BYSETPOS`, `BYWEEKNO`, `BYYEARDAY`, `BYHOUR`, `BYMINUTE`, `BYSECOND`, `FREQ=HOURLY`/`MINUTELY`/`SECONDLY`, `RDATE` |

The supported set covers every pattern in the spec's user stories and every one a household calendar
realistically produces — weekly activities, fortnightly collections, monthly-by-weekday, annual
birthdays. The rejected set is rejected *explicitly*, so an unsupported rule is a specific 422 at
the boundary rather than a rule that parses and then silently expands wrongly. Sub-daily frequencies
are rejected on their own merits too: they are the pathological-volume case FR-012 guards.

**Holidays are an argument that changes nothing.** Per the spec's third clarification and
[FR-014](spec.md), holiday data is exposed to callers but does not influence expansion. The
component therefore takes an optional `PublicHolidayProvider` — a pure lookup, supplied by the
caller — and threads it nowhere into the expansion algorithm. That sounds like dead weight and is
not: it is the seam Reference and Locale fills later and the reason a working-day rule can be added
without changing this component's shape. §13 records the test that keeps it honest.

---

## 3. Time zone correctness without a dependency

**Decision: `Intl.DateTimeFormat` with an explicit `timeZone`, over Node's bundled full ICU.**

Expansion happens in *local* terms — "every Tuesday at 16:00 in Europe/London" — and converts to an
instant per occurrence. That conversion is the whole problem, and it needs a time-zone database.
Node 24 ships full ICU by default, and `Intl.DateTimeFormat(…, { timeZone })` with
`formatToParts` gives the offset for a given instant in a given zone, which is enough to invert
local-to-instant by the standard two-pass method. No dependency, no bundled `tzdata`, and the zone
data is the platform's, updated with the runtime.

`Temporal` would make this a few lines and is not in Node 24 without a polyfill, which is a
dependency by another name. Revisit when it lands natively — noted in the plan's Complexity
Tracking as the one place where a future runtime upgrade simplifies rather than complicates.

**The two hard days, decided explicitly because FR-011 requires a stated rule.**

| Case | Rule | Example (Europe/London) |
|---|---|---|
| Local time does not exist (spring forward) | Shift forward by the gap | `01:30` on 29 Mar 2026 → `02:30 BST` |
| Local time happens twice (fall back) | Take the first, the pre-transition offset | `01:30` on 25 Oct 2026 → `01:30 BST`, not `01:30 GMT` |

This is the `compatible` disambiguation of the Temporal proposal and the de facto behaviour of every
calendar users have expectations from. It is written down here because the alternative — dropping
non-existent times and duplicating ambiguous ones — is defensible in the abstract and produces a
missing or doubled occurrence in practice, which for this product is a family arriving at the wrong
time or twice.

All-day events sidestep all of it by being date-bounded rather than instant-bounded
([FR-004](spec.md)): a birthday on 3 March is stored as a date and never passed through offset
arithmetic, which is the only way it stays on 3 March for a reader in another zone.

---

## 4. The horizon, the trailing window, and the occurrence cap

**Decision: 400 days forward, 400 days retained behind, 1,000 occurrences per event within the
horizon.**

**400 days forward**, not twelve months, so that an annual event always has its next occurrence
materialised with more than a month of margin regardless of when the sweep last ran. Twelve months
exactly puts a birthday's next occurrence on the horizon boundary for one day a year, and boundary
conditions that occur annually are the ones nobody ever reproduces.

**400 days behind.** Occurrences are derived data and reconstructible from the event and its rule,
so retaining them forever is storage for nothing. Retaining a year-plus keeps "what did we do last
spring" a plain indexed query rather than a rebuild. The events themselves are never pruned while
the family is active ([spec.md, Principle XI answer 5](spec.md)).

**Volume check, because the whole design rests on it.** A weekly event materialises 58 rows across
the forward horizon; a daily one 400. A household with 50 recurring events, mostly weekly, lands
around 3,000 forward rows. At thousands of families this is a table in the low millions with a
single composite index — the range query the design exists to make cheap stays cheap.

**1,000 occurrences per event**, which admits daily (400) with room and rejects anything denser.
Combined with rejecting sub-daily frequencies outright (§2), FR-012's pathological case is closed
twice. The limit is checked during expansion against the horizon, not estimated from the rule, so a
rule that is dense only in one month is caught on the same code path as one dense throughout.

---

## 5. Individually cancelled occurrences, and what a rebuild must preserve

**Decision: an occurrence row carries a `cancelled_at`, and the rebuild is a reconcile, not a
truncate-and-regenerate.**

[FR-022](spec.md) allows cancelling one occurrence and forbids moving one. That asymmetry is what
makes this cheap: a cancellation is a flag on a row the rule already produces, whereas a move would
need a row the rule does *not* produce, plus an identity for it that survives the rule changing
underneath — the RFC 5545 `RECURRENCE-ID` problem, deferred by the spec and not designed here.

So `EventOccurrence` is derived data with exactly one authored attribute. The rebuild in
[FR-020](spec.md) becomes: expand the current rule over the horizon, and for each produced instant,
keep the existing row if one exists at that instant (preserving its `cancelled_at`), insert if not,
delete rows at instants the rule no longer produces. Identity is `(event_id, starts_at)`, which is
stable exactly as long as an occurrence cannot move — the same asymmetry paying out twice.

**The consequence worth stating.** Changing a series' *time* moves every instant, so every
occurrence identity changes and individual cancellations under the old timing are not carried
across. That is correct rather than regrettable: "swimming is cancelled on the 14th" is a statement
about a 16:00 Tuesday slot, and once the family has moved swimming to Thursdays it is no longer a
statement about anything. Quickstart Scenario 6 asserts it deliberately so the behaviour is a tested
decision rather than an emergent one.

---

## 6. `OccurrenceMaterialised` is published per window, not per occurrence

**Decision: one event per (event, materialisation window), carrying the event id, the window
bounds and the count — never one per occurrence row.**

The naive reading of [FR-030](spec.md) publishes an integration event per materialised occurrence.
The sweep materialising a year of a daily event would then write 400 outbox rows in one transaction,
and a family's first horizon extension would write thousands. The outbox is the platform's
most important operational surface — the constitution names the oldest unpublished row as *the*
metric to alert on — and filling it with derived-data notifications would drown the signal it
exists to carry.

Per-window also matches the only consumer anyone can name. Reminders schedules against occurrences
in a horizon; "event X now has occurrences through date Y" is the fact it needs, and it can read the
rows. §7.3's rule is that cross-context side effects go through the outbox, not that every row
insert is an integration event.

The other three events are per state change and unremarkable: `EventCreated`, `EventUpdated`,
`EventCancelled`, written as outbox rows in the state change's own transaction, exactly as spec 008
writes its six.

---

## 7. The range query, and where the visibility filter goes

**Decision: one indexed range scan over `event_occurrence`, with the visible-member filter applied
as a `NOT EXISTS` over `event_participant` in the same statement.**

```
WHERE starts_at < :to AND ends_at > :from        -- overlap, not containment
  AND NOT EXISTS (
        SELECT 1 FROM event_participant p
         WHERE p.event_id = o.event_id
           AND p.member_id <> ALL (:visibleMemberIds)
      )
```

Two things this gets right that the obvious version does not. **Overlap rather than containment**,
so a long event spanning the whole requested window is returned rather than missed — the failure
mode of a naive `BETWEEN` on the start. And **filtering in the query rather than after it**, because
filtering in application code makes the page size wrong and, more seriously, makes an event's
existence observable through result counts, which FR-016 forbids ("or infer its existence").

The visible set arrives from §1's port before the statement runs. The empty-set case is the
fail-closed one and is correct without special handling: every event with any participant is
excluded, which is what "this reader may see nobody" should mean.

Row-level security remains underneath all of it (ADR-017), so the family scope is not this query's
job — it is the transaction's, and the query could not see another family's rows if it tried.

---

## 8. The materialisation sweep

**Decision: a worker sweep in the shape spec 008 already established, claiming work by horizon
staleness.**

`apps/worker/src/sweeps/` already holds five sweeps with an integration test each, and
[ADR-005](../../adr/ADR-005-event-system.md) settled the mechanism: a database sweep on a fixed
cadence, replayable after an outage, inspectable before it fires, testable by moving a clock. The
materialisation sweep selects events whose `materialised_through` is closer than the horizon,
extends them inside a family-scoped transaction, and advances the marker in the same transaction.

**Idempotence comes from the reconcile in §5**, not from a separate mechanism. Re-running the sweep
over an already-materialised event produces the same instants, finds the same rows, and inserts
nothing — which is why `(event_id, starts_at)` is a unique index rather than only a lookup index.
FR-025 is then a property of the design instead of a discipline.

**The concurrent-edit case** — a rule changing while the sweep is materialising that same event —
is closed by the sweep taking the same row lock the edit path takes, so the losing side reconciles
against whichever rule committed. The edge case in the spec asks for exactly this and quickstart
Scenario 8 asserts it.

**Observability is the point of the marker.** `materialised_through` per event makes
[FR-026](spec.md) a `min()` rather than a computation, which is what lets the horizon-lag gauge and
its alert exist at all. A horizon falling behind is the silent failure this whole story exists to
prevent, and it is the one failure a user would notice before an operator does.

---

## 9. The outbox relay stays deferred, for the third time

Spec 006 deferred ADR-005's Layer 3 (SQS relay, queues, dead-letter queues); spec 008 continued it
and named the trigger: "the first cross-context consumer, which is Calendar or Documents."

Calendar is that context, and the trigger still has not fired. Calendar *publishes* four event types
and *consumes* none — Reminders is the consumer and does not exist. Building a relay now would
provision infrastructure ahead of the need the constitution's cost principle forbids provisioning
ahead of, and would require AWS, which ADR-013 defers to Stage 1.

Layer 2 is built in full, as before: all four event types written as outbox rows inside the state
change's own transaction. The trigger is restated more precisely than spec 008 could state it: **the
first context that subscribes**, which is Reminders. Recorded in the plan's Complexity Tracking.

---

## 10. Erasure, retention, and what member deletion cannot reach

**Decision: `ErasurePort` implemented for both operations from the start, in the shape spec 008
established.**

`eraseForFamily` removes every event, occurrence, participant row and attachment reference scoped to
the family — trivially complete, because [FR-029](spec.md) scopes every Calendar row to exactly one
family and RLS enforces it, so there is no row the saga cannot reach.

`eraseForMember` removes that member's participant rows and reduces authorship to the tombstone
reference spec 008 already keeps. The spec states the limitation honestly rather than implying
completeness: an event *title* is free text a household authored and may contain a name, and nothing
machine-scrubs it. This is worth restating here because the alternative designs are worse — deleting
every event a departing member was on destroys the family's own history, and running a name-matcher
over authored text is a heuristic that fails in both directions on a compliance path.

Retention needs no scheduled job beyond the sweep: occurrences fall out of the trailing window as
part of the same pass that extends the forward one, which keeps the pruning where the extension is
and gives it the same test.

---

## 11. Performance budgets

Inherited from spec 008's shape, with the additions this feature introduces.

| Path | Budget | Note |
|---|---|---|
| `FamilyContextPort.resolve` | under 5 ms | **Unchanged** — §1's decision exists to keep it so |
| `MemberVisibilityPort.resolveVisibleMemberIds` | under 2 ms | One indexed read plus the roster, inside one transaction |
| 14-day range query | p95 under 200 ms | SC-002's "no perceptible delay" at five years of history |
| Occurrence expansion, 400-day horizon | under 20 ms, pure CPU | No I/O in the kernel, so it is measurable in a unit test |
| Sweep, per event | under 50 ms | Dominated by the reconcile write, not the expansion |

---

## 12. What this feature does *not* decide

Recorded so a later reader does not mistake silence for an answer.

- **Per-occurrence moves** (`RECURRENCE-ID` semantics). Deferred by the spec; §5 explains why the
  cancel-only asymmetry is what keeps occurrence identity stable, and a later feature adding moves
  has to revisit that identity first.
- **Working-day and holiday-aware rules.** The provider seam exists (§2); the semantics do not.
- **Time-zone changes to an existing series.** A family that moves house changes an event's zone
  like any other edit, and the rebuild in §5 applies. Whether past occurrences should keep their
  original zone is a question nobody has asked yet.
- **The dashboard aggregate.** §7's range query is the piece it will consume.
- **External calendar sync**, which the spec places out of scope and which would need an ADR and a
  privacy review before any design work.
