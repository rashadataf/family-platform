# Quickstart: Calendar (spec 009)

Phase 1 output. Runnable scenarios that prove this feature works end to end. Each maps to a user
story, or to a requirement whose failure would be invisible without deliberately checking for it —
which here means the two mornings a year the clocks change, and every path through the guardian
filter.

Route and error-type details are in [contracts/calendar-api.md](contracts/calendar-api.md); field
definitions are in [data-model.md](data-model.md). They are not repeated here.

## Prerequisites

Docker, and nothing else ([ADR-014](../../adr/ADR-014-containerized-development.md)).

```sh
cp .env.example .env
docker compose up
curl -s localhost:3000/health/ready    # {"status":"ok"} before starting
```

Every scenario needs a family with members in it. Run
[spec 008's quickstart](../008-family-membership/quickstart.md) through Scenario 4, which leaves you
with:

| Who | Standing | Export as |
|---|---|---|
| Ada | owner, guardian of Charlie | `$ADA` |
| Grace | adult, **not** a guardian of Charlie | `$GRACE` |
| Alan | extended member | `$ALAN` |
| Charlie | child member, no account | `$CHARLIE_ID` |

Export the family as `$FAM`. Scenarios 5 and 6 need the worker, which `docker compose up` already
runs.

---

## Scenario 1 — Put something on the calendar and read it back (User Story 1, FR-001 to FR-008)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/events \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"kind":"timed","title":"Dentist","startsAt":"2026-09-20T09:00:00Z",
       "endsAt":"2026-09-20T09:30:00Z","timeZone":"Europe/London"}'
```

**Expect** `201` with an `eventId`. Then the range query:

```sh
curl -s "localhost:3000/v1/families/$FAM/occurrences?from=2026-09-14T00:00:00Z&to=2026-09-28T00:00:00Z" \
  -H "authorization: Bearer $ADA"
```

**Expect** one occurrence, carrying the event's title and status inline — the 14-day view must not be
N+1.

Three rejections that must each carry their own reason rather than a generic `400`:

```sh
# end before start                  → 422 calendar/invalid_time_range
# "timeZone":"Europe/Londn"         → 422 calendar/unknown_time_zone
# a 500-day range query             → 422 calendar/range_too_wide
```

The zone is validated against the runtime's own IANA set, not a regex, so a plausible-looking
typo fails (FR-002).

---

## Scenario 2 — A repeating event, and the weekend the clocks go back (User Story 3, FR-011, SC-003)

This is the scenario the shared kernel exists for, and the one whose failure a family discovers by
arriving an hour early.

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/events \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"kind":"timed","title":"Swimming","startsAt":"2026-10-20T16:00:00Z",
       "endsAt":"2026-10-20T17:00:00Z","timeZone":"Europe/London",
       "recurrenceRule":"FREQ=WEEKLY;BYDAY=TU"}'
```

The UK clocks go back on **25 October 2026**. Query across it:

```sh
curl -s "localhost:3000/v1/families/$FAM/occurrences?from=2026-10-19T00:00:00Z&to=2026-11-03T00:00:00Z" \
  -H "authorization: Bearer $ADA"
```

**Expect** occurrences on 20 and 27 October whose **local** time is `16:00` on both, and whose UTC
instants differ by an hour — `15:00Z` before the change and `16:00Z` after. If the two instants are
equal, the expansion is treating local time as UTC and SC-003 fails.

Repeat with `FREQ=WEEKLY;BYDAY=SU` across **29 March 2026** for the spring transition, where the
disambiguation rule is the interesting one: a rule landing on `01:30` that day resolves to `02:30`,
because that local time does not exist ([research.md §3](research.md)).

Two rules that must be refused rather than expanded:

```sh
# "FREQ=HOURLY"                     → 422 calendar/recurrence_unsupported  (names the part)
# "FREQ=MINUTELY;INTERVAL=1"        → 422 calendar/recurrence_too_dense
```

---

## Scenario 3 — A child's event is invisible, not forbidden (User Story 2, FR-016, SC-011)

The feature's hardest requirement, and the place it deliberately differs from spec 008.

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/events \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d "{\"kind\":\"timed\",\"title\":\"Nursery settling-in\",
       \"startsAt\":\"2026-09-22T09:00:00Z\",\"endsAt\":\"2026-09-22T10:00:00Z\",
       \"timeZone\":\"Europe/London\",\"participants\":[\"$CHARLIE_ID\"]}"
```

Ada guards Charlie, so:

```sh
curl -s localhost:3000/v1/families/$FAM/events/$EVENT_ID -H "authorization: Bearer $ADA"   # 200
curl -s localhost:3000/v1/families/$FAM/events/$EVENT_ID -H "authorization: Bearer $GRACE" # 404
```

**Expect** `404 calendar/not_found` for Grace — **not** `403`. Grace is an adult member of the family
and still learns nothing, because nothing had disclosed the event's existence to her. Contrast with
spec 008, where reading a child's member record returns a distinguishable `403` because the roster
already told her the child exists.

The assertion that matters most is numeric:

```sh
curl -s "localhost:3000/v1/families/$FAM/occurrences?from=2026-09-21T00:00:00Z&to=2026-09-23T00:00:00Z" \
  -H "authorization: Bearer $GRACE" | jq 'length'
```

**Expect** a count that does not include the nursery event. A count that differs from "the events
Grace may see" is the inference FR-016 forbids, and it is why the filter is in the query rather than
applied to a fetched page ([research.md §7](research.md)).

Then the two directions that catch role-based logic:

- **Alan** (extended, holds `calendar:read`, guards nobody) — `404`.
- Grant Grace guardianship of Charlie via spec 008's route, repeat the read — now `200`, with no
  other change. Guardianship is evaluated at read time (FR-016).
- Revoke it again — `404` immediately. No cache, no session refresh.

An event with **two** child participants where Grace guards only one must be hidden from her, since
showing it would disclose the second child's commitment.

---

## Scenario 4 — Cancel the series, cancel one lesson (User Story 4, FR-021, FR-022)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/events/$SWIMMING_ID/cancel \
  -H "authorization: Bearer $ADA" -H "idempotency-key: $(uuidgen)"
```

**Expect** `200`, and the event **still present** in its range, marked cancelled. It occupies its
slot — that is what distinguishes an event from a task, and a family needs to see that something
they expected is off (FR-008).

Now the single occurrence, on a fresh series:

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/events/$ID/occurrences/$OCC_ID/cancel \
  -H "authorization: Bearer $ADA" -H "idempotency-key: $(uuidgen)"
```

**Expect** that one occurrence cancelled and **every other occurrence untouched**. Retiming one is
refused:

```sh
# PATCH the occurrence's startsAt  → 422 calendar/occurrence_not_movable
```

The error points at editing the series, because that is the supported route (FR-022).

---

## Scenario 5 — A rebuild preserves the cancellation, until it cannot (FR-020, SC-012)

The subtlest behaviour in the feature, and the reason the rebuild is a reconcile rather than a
regenerate.

1. Cancel one occurrence of a weekly series, as above.
2. `PATCH` the event to `FREQ=WEEKLY;BYDAY=TU,TH` — same times, more days.
3. Re-read the range.

**Expect** Thursday occurrences to appear **and the cancelled Tuesday to still be cancelled**. The
reconcile matches on `(event_id, starts_at)` and never writes `cancelled_at`
([data-model.md](data-model.md)).

Then the boundary:

4. `PATCH` the event's `startsAt` to `17:00`.
5. Re-read.

**Expect** every occurrence at the new time and the individual cancellation **gone**. This is
correct, not a bug: "swimming is off on the 14th" was a statement about a 16:00 slot that no longer
exists ([research.md §5](research.md)). Asserted deliberately so the behaviour is a tested decision.

---

## Scenario 6 — The horizon advances on its own (User Story 5, FR-024 to FR-026, SC-006)

Create an indefinitely repeating event, then check how far it reaches:

```sh
curl -s "localhost:3000/v1/families/$FAM/occurrences?from=2027-09-01T00:00:00Z&to=2027-10-01T00:00:00Z" \
  -H "authorization: Bearer $ADA"
```

**Expect** occurrences roughly 400 days out, and none beyond
([research.md §4](research.md)). Then advance the clock past the point the original horizon would
have been exhausted, run the sweep twice, and assert:

- occurrences now exist beyond the original horizon;
- **the second run inserts nothing** — idempotence comes from the `(event_id, starts_at)` unique
  index, not from a guard the sweep has to remember (FR-025);
- `calendar_horizon_lag_seconds` returns to zero.

The metric is the one that matters operationally. A horizon silently falling behind is the failure
this story exists to prevent, and a family would notice it before an operator.

---

## Scenario 7 — Cross-family non-disclosure (FR-028, SC-004)

With an account holding no standing in `$FAM`:

```sh
curl -s localhost:3000/v1/families/$FAM/events/$EVENT_ID -H "authorization: Bearer $OUTSIDER"
curl -s "localhost:3000/v1/families/$FAM/occurrences?from=…&to=…" -H "authorization: Bearer $OUTSIDER"
```

**Expect** `404 calendar/not_found` from every Calendar route, with a body indistinguishable from a
genuinely missing event. This is covered by extending spec 008's existing parameterised sweep rather
than by hand, so a route added later without a test fails by being absent from the table.

---

## Scenario 8 — Row-level security is actually on (ADR-017)

The assertion that proves layer five exists rather than appearing to. Against each of
`calendar_event`, `event_occurrence` and `event_participant`:

```sql
-- as family_platform_app, no app.family_id set
SELECT count(*) FROM calendar_event;     -- expect 0, not every family's events

-- as family_platform_owner, no app.family_id set
SELECT count(*) FROM calendar_event;     -- expect 0 — this is what proves FORCE is doing something
```

The owner-role case is the one that catches
[ADR-017](../../adr/ADR-017-tenant-isolation-at-the-database.md)'s entire subject. Without it the
policy exists, the CI check passes, and every row is readable.

---

## Scenario 9 — Boundary and purity discipline (research.md §1, §2)

Not runnable by curl; run by `pnpm test` and listed here because these are the assertions that keep
the two decisions this feature made from eroding.

```sh
pnpm vitest run packages/core/src/calendar/reads-family-only-through-published-ports.spec.ts
pnpm vitest run packages/kernel/src/recurrence
pnpm boundaries
```

**Expect**: Calendar's imports from `core/family` name only `family-context.port.js` and
`member-visibility.port.js`; the recurrence expansion returns identical results across two identical
calls, and identical results whether or not a `PublicHolidayProvider` is supplied (SC-013); and
`dependency-cruiser` reports no forbidden edge or cycle.

---

## What this quickstart cannot prove

- **That the range query stays fast at five years of history.** SC-002 needs a seeded volume test,
  not a curl. The scenarios above prove correctness; the p95 budget is a load-test concern.
- **That no consumer is broken by the four published events**, because none subscribes yet
  ([research.md §9](research.md)). The outbox rows are asserted to exist and to carry identifiers
  only; whether Reminders can act on them is Reminders' problem to demonstrate.
- **That every DST case in every zone is right.** Both UK transitions are asserted as fixtures, and
  the kernel's unit suite covers the general rule. A zone with a 30-minute or historical offset
  change is tested in the kernel, not through the API.
- **That an event title containing a name is handled well on member erasure.** It is not scrubbed,
  by decision ([data-model.md](data-model.md)), and no test can assert a judgement call.
