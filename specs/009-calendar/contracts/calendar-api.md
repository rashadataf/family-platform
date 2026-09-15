# Contract: Calendar API v1 (spec 009)

**Spec**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Data model**: [data-model.md](../data-model.md)

Additive within `/v1` ([ADR-006](../../../adr/ADR-006-api-style-and-type-safety.md)). Defined in
`packages/contracts/src/v1/calendar.contract.ts`; consumed by `apps/api` and the mobile app from the
same file, per Principle IX.

Every route here is family-scoped. There is no Calendar route that is not, which is a simpler
position than spec 008 could take — a calendar has no equivalent of "the families I belong to".

## Routes

Every row returns **404** to a caller with no standing in `:familyId`, before the capability in the
third column is consulted. The guard chain is spec 008's, unchanged.

| Method | Path | Capability required |
|---|---|---|
| `GET` | `/v1/families/:familyId/occurrences?from=&to=` | `calendar:read` |
| `POST` | `/v1/families/:familyId/events` | `calendar:write` |
| `GET` | `/v1/families/:familyId/events/:eventId` | `calendar:read` |
| `PATCH` | `/v1/families/:familyId/events/:eventId` | `calendar:write` |
| `POST` | `/v1/families/:familyId/events/:eventId/cancel` | `calendar:write` |
| `POST` | `/v1/families/:familyId/events/:eventId/occurrences/:occurrenceId/cancel` | `calendar:write` |
| `PATCH` | `/v1/families/:familyId/events/:eventId/occurrences/:occurrenceId` | `calendar:write` — always `422 calendar/occurrence_not_movable` once existence and visibility pass (FR-022) |

**`calendar:read` and `calendar:write` already exist.** Spec 008 issued them into the
role-to-capability map for a context that did not yet exist, which was the stated point of the
indirection. This feature consumes the strings and changes nothing: owner, adult and extended
members can write; viewers can read ([FR-032](../spec.md)). No change to `capabilities.ts`, and
therefore no ADR.

**Why the range query is `/occurrences` and not `/calendar`.** It returns occurrences, which are a
resource with identifiers the cancel route addresses. Naming it after the screen it feeds would be
the first step toward the screen-shaped endpoints ARCHITECTURE §11 warns about; the dashboard will
later consume this same query internally rather than getting one of its own.

**Cancellation is `POST …/cancel`, not `DELETE`.** [FR-021](../spec.md) makes cancelling a state
change that leaves the event readable and in its slot. `DELETE` would be a lie about what happens,
and the distinction between an event that was called off and one that never existed is the whole
of User Story 4's value.

---

## Where the guardian boundary sits, exactly

The most consequential line in this contract, and it deliberately sits somewhere different from
spec 008's child boundary.

| Context | Non-guardian sees | Why the difference |
|---|---|---|
| **Spec 008**, `GET …/members/:memberId` on a child | `403 family/guardianship_required` | The roster already told the caller the child exists. A 404 would be a lie that buys nothing |
| **Spec 009**, any event with a child participant | **Nothing at all** — omitted from ranges, `404 calendar/not_found` on direct read | Nothing disclosed the event's existence. [FR-016](../spec.md) says a non-guardian must not "infer its existence", and here that is achievable |

These are the same principle applied to different starting information, not two policies. Spec 008
discloses a child's existence to the household on purpose — a family knows its own people — and
protects the child's *details*. Calendar was never going to disclose that an event exists, so it
does not start.

**The filter is applied in the query, not after it** ([research.md §7](../research.md)). Filtering
in application code after a page is fetched makes the page size wrong and, worse, makes a hidden
event observable through result counts — which is the inference FR-016 forbids.

**An event is hidden if *any* participant is outside the caller's visible set.** An event with a
guarded child and an unguarded one is hidden, because showing it would disclose the second child's
commitment. Events with no participants at all are visible to every `calendar:read` holder, which is
the common case for household-wide entries like a bin collection.

**Every permitted read of a child's participation is audited, and so is every denial**
([FR-017](../spec.md), Principle VI). The audit is written at the event-read granularity — one entry
per event returned that carries a child participant — not per occurrence, which would write a row
per fortnightly swimming lesson per screen render and drown the signal the audit log exists to
carry. This is the same reasoning spec 008 used to audit the member detail route and not the roster.

---

## Request and response shapes

Defined in the contract package; the notes here are the ones a schema cannot express.

| Shape | Note |
|---|---|
| `CreateEventRequest` | A **discriminated union on `kind`**: `'timed'` carries `startsAt`/`endsAt`, `'all_day'` carries `startDate`/`endDate`. The two sets are not both present in either arm, so "all-day event with a start time" is unrepresentable on the wire rather than rejected at runtime (Principle I) |
| `timeZone` | Required on both arms. Validated against the runtime's own IANA zone set, not a regex — [FR-002](../spec.md) rejects an unrecognised zone rather than defaulting |
| `recurrenceRule` | Optional RRULE string, parsed into the declared subset ([research.md §2](../research.md)). Anything outside it is `calendar/recurrence_unsupported`, which **names the offending part**, because "invalid rule" on a rule the user did not hand-write is unactionable |
| `participants` | `memberId[]`. No names, no kinds, no ages — Calendar does not accept, store or return anything else about a person ([data-model.md](../data-model.md)) |
| `attachments` | Opaque string references. Never validated, resolved or dereferenced ([FR-031](../spec.md)); the Document Vault context does not exist |
| `category` | A platform-defined enum, not free text, so it carries no user-authored personal data and later contexts can reason about it |
| `UpdateEventRequest` | Every field optional; `PATCH` semantics. Changing `recurrenceRule`, `startsAt` or `timeZone` triggers the reconcile in [data-model.md](../data-model.md) |
| `OccurrenceResponse` | `occurrenceId`, `eventId`, `startsAt`, `endsAt`, `cancelledAt`, plus the event's title, kind, location, category and status. Denormalised deliberately: the 14-day view must not be N+1 |
| Every response | Never returns a participant the caller may not see, and never returns another family's identifiers |

### The range query

`from` and `to` are required, both ISO-8601 instants, and `to - from` is capped at **400 days** — the
materialisation horizon ([research.md §4](../research.md)). A wider window would return a range the
system cannot guarantee is materialised, which would silently under-report rather than error.

Overlap semantics, not containment: an occurrence is returned if it overlaps the window at all, so a
long event spanning the whole window appears rather than being missed. This is stated in the
contract because a client author would reasonably assume either.

### Idempotency

`POST /v1/families/:familyId/events` and both cancel routes accept and honour an `Idempotency-Key`
header ([FR-023](../spec.md), Principle IX). Mobile clients retry aggressively, and a duplicated
appointment is a visible defect a user has to clean up by hand.

Both cancel routes are additionally idempotent by construction: cancelling an already-cancelled
event or occurrence returns the same state rather than an error, because the caller's intent is
already satisfied.

---

## Error types

| `type` | HTTP | When | Disclosure note |
|---|---|---|---|
| `calendar/not_found` | 404 | The event or occurrence does not exist, **or** the caller has no standing in the family, **or** it carries a child participant the caller does not guard | Deliberately indistinguishable across all three — FR-016, FR-028, SC-004, SC-011 |
| `calendar/capability_required` | 403 | The caller is a member but lacks the route's capability | Names the capability, never the caller's role |
| `calendar/invalid_time_range` | 422 | `end` precedes `start`, on an event or on a range query | FR-002 |
| `calendar/unknown_time_zone` | 422 | Not a recognised IANA identifier | FR-002. Never silently defaults |
| `calendar/recurrence_invalid` | 422 | Not a well-formed RFC 5545 rule | FR-009 |
| `calendar/recurrence_unsupported` | 422 | Well-formed, but outside the declared subset | Names the unsupported part — research.md §2 |
| `calendar/recurrence_too_dense` | 422 | Expansion within the horizon exceeds 1,000 occurrences | FR-012. Rejected rather than expanded |
| `calendar/range_too_wide` | 422 | A range query wider than the 400-day horizon | Better than under-reporting silently |
| `calendar/occurrence_not_movable` | 422 | An attempt to retime a single occurrence | FR-022. Says so explicitly, and points at editing the series |
| `calendar/participant_invalid` | 422 | A participant who is not a member of this family | FR-018. Never discloses whether that member exists elsewhere |

**Why `calendar/not_found` collapses three cases.** A caller learns only that there is nothing here
for them. Distinguishing "you lack guardianship" from "it does not exist" would confirm that a child
in this family has an appointment at a time the caller chose to probe, which is the inference
FR-016 exists to prevent. The audit log records which of the three it really was — the same argument
spec 008 makes for `family/not_found` and spec 006 for `identity/session_invalid`.

Note the contrast with spec 008's `family/guardianship_required`, which *is* a distinguishable 403.
The difference is justified above and is worth a reviewer's attention, because two guardianship
denials behaving differently looks like an inconsistency until the starting information is
considered.

---

## Authorization matrix

A route missing from this list is a route without a test.

### The universal assertion

**For every route accepting a `:familyId`**, a member of a different family receives
`404 calendar/not_found`. These routes are added to spec 008's existing parameterised sweep rather
than getting a second one, so the table remains the single place a route can be forgotten.

### Per-route

| Route | Rule | Test that must exist |
|---|---|---|
| `POST …/events` | `calendar:write` | A `viewer` is denied; an `extended` member succeeds |
| `GET …/occurrences` | `calendar:read` + FR-016 | A non-guardian's range **omits** a child's event entirely; the guardian's range includes it. Both directions |
| `GET …/occurrences` | Counts leak nothing | The non-guardian's result count equals the count with the child's event absent — asserted numerically, because this is the inference FR-016 forbids |
| `GET …/events/:eventId` | FR-016 | A non-guardian gets `404`, **not** `403` — the one place this contract deliberately differs from spec 008 |
| `GET …/events/:eventId` | Guardianship is read-time | A guardian reads it, guardianship is revoked, the same request now returns `404` with no other change |
| `GET …/events/:eventId` | Role is not the control | An **owner** who is not a guardian is denied; a **viewer** who is a guardian is allowed. Both directions, because either alone passes with role-based logic |
| `GET …/events/:eventId` | Mixed participants | An event with one guarded and one unguarded child is hidden from a caller who guards only the first |
| `PATCH …/events/:eventId` | `calendar:write` | A `viewer` is denied; any writer may edit any event, not only their own ([spec.md](../spec.md) Assumptions) |
| `POST …/events/:eventId/cancel` | FR-021 | The event remains readable and still appears in its range, marked cancelled |
| `POST …/occurrences/:id/cancel` | FR-022 | The series is untouched; a rebuild preserves the cancellation |
| `PATCH …/events/:eventId` with a new time | FR-022's boundary | Individual cancellations under the old timing are **not** carried across, asserted deliberately |
| `POST …/events` with a foreign participant | FR-018 | Returns `calendar/participant_invalid` and discloses nothing about that member |

### The assertions that are not about a route

**Row-level security is real.** The integration test spec 008 wrote is extended to Calendar's three
tables: query each without `withFamilyContext` and see zero rows, then repeat connected as the
**owner** role and assert `FORCE ROW LEVEL SECURITY` still filters — the assertion that proves
ADR-017 is doing something.

**Calendar reads Family only through published ports.** An AST test asserts that every import in
`packages/core/src/calendar` naming `core/family` resolves to `family-context.port.js` or
`member-visibility.port.js` and nothing else. `no-cross-context-internals` cannot express this,
because it admits everything under `application/ports/` and a repository interface lives there too
([research.md §1](../research.md)).

**The recurrence kernel is pure.** A unit test asserts an expansion is identical across two calls
with the same arguments, and that expansion results are unchanged whether or not a
`PublicHolidayProvider` is supplied — SC-013, and the thing that keeps FR-014 honest.

---

## Rate limiting

| Route | Limit | Why |
|---|---|---|
| `GET …/occurrences` | 120 per user per minute | The cheapest route to abuse and the most expensive to serve. Also the one a broken client polls |
| `POST …/events` | 120 per user per hour | Nothing legitimate creates appointments in bulk; bulk import is not a feature |
| Everything else | The default per-user route limit | |

---

## Observability

Correlation id on every request, carried into the outbox row and the audit entry.

| Signal | Why |
|---|---|
| `calendar_range_query_duration` | SC-002's "no perceptible delay" at five years of history. p95 under 200 ms |
| `calendar_horizon_lag_seconds` | `min(materialised_through) - now()` across events. **The alert of this feature** — a horizon falling behind is the silent failure User Story 5 exists to prevent, and a family notices it before an operator would ([research.md §8](../research.md)) |
| `calendar_materialisation_duration` | The sweep's per-event cost, against the 50 ms budget |
| `calendar_occurrences_written_total{op}` | Split by `insert`, `update`, `delete`. A reconcile that deletes and reinserts everything each pass is a correctness bug that would otherwise look like health |
| `calendar_child_event_read_total{result}` | The volume Principle VI's audit obligation is producing here, so a gap is noticed |
| `member_visibility_resolve_duration` | The 2 ms budget on the port FR-016 added ([research.md §11](../research.md)) |

**No personal data in any of it.** No event title, description or location in a log line, metric
label, span attribute or outbox payload — identifiers and enum labels only. This feature holds more
free text than any before it, so the rule is restated where the signals are defined.
