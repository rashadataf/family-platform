# Feature Specification: Calendar

**Feature Branch**: `009-calendar`

**Created**: 2026-09-14

**Status**: Draft

**Input**: User description: "Implement the Calendar bounded context (ARCHITECTURE.md section 5.3) as the platform's first core scheduling subdomain, built on top of the existing Family and Membership tenant root (spec 008) and Identity and Access (spec 006). Calendar owns things that happen at a time: appointments, school and nursery events, activities, birthdays, holidays and deadlines, with recurrence, participants, location, categories, and attachments held by reference only. Aggregates are CalendarEvent and EventOccurrence, exactly as named in the architecture doc. The central modelling decision, per the architecture doc, is that occurrences of a recurring event are materialised rows within a bounded horizon rather than expanded from the recurrence rule at query time: the dashboard question is "what is happening in the next 14 days across everything", and expanding RRULEs at query time across a family's whole history to answer that is both slow and untestable. A bounded materialisation window, rebuilt whenever the recurrence rule changes, makes that query a plain indexed range query and will later make reminder scheduling a plain join. The accepted trade is a background rebuild job and an explicit horizon, both of which must be observable and testable. Recurrence itself must be implemented as the shared kernel the architecture doc names, @fp/kernel/recurrence: an RFC 5545 RRULE value object plus expansion, timezone-correct against Europe/London including DST transitions and UK bank holidays. It is the only shared kernel permitted in the system, it must be pure with no dependencies and exhaustive unit tests, and it is justified only because the Tasks context will consume the identical logic and duplicating it would guarantee two subtly different DST bugs — so it must be built here as a properly separated package, not as Calendar-internal code that Tasks later has to reach into. Note that UK bank holiday data is conceptually owned by the deferred Reference and Locale context (ARCHITECTURE.md section 5.11), so the kernel must take holiday data through an interface rather than hardcoding a UK calendar, keeping the platform UK-first without being UK-welded; timezones are stored as IANA identifiers and no UK-shaped primitive may be stored anywhere in this context. Participants on an event are FamilyMember references (memberId) from the Family context, never User references — a child who has no account must still be a participant on their own nursery appointment. Attachments are stored as opaque references only; the Document Vault context does not exist yet and this feature must not validate or dereference them. Authorization must go exclusively through the FamilyContextPort open host service published by spec 008, which resolves (userId, familyId) to { memberId, role, capabilities[] } or null; Calendar must check capabilities, never roles, must not query Family tables directly, and the boundary must be verifiably enforced by the existing boundary tests. Every Calendar table is family-scoped and must sit behind the same defence-in-depth tenant isolation described in ARCHITECTURE.md section 9 and ADR-017, including row-level security under the two database roles established by spec 008. This context must publish EventCreated, EventUpdated, EventCancelled and OccurrenceMaterialised domain events per the architecture doc, even though no downstream context yet subscribes to them — Reminders is the eventual consumer and does not exist. A cancelled event still occupies its slot and remains visible as cancelled; it is not deleted, which is the behaviour that distinguishes an event from a task. Out of scope: every other bounded context in the architecture doc (Tasks, Document Vault, Reminders, Notifications, AI, Billing, Compliance, Reference and Locale), the GET /v1/families/:id/dashboard aggregate endpoint described in ARCHITECTURE.md section 11 (it spans Tasks and Documents, which do not exist yet, so it cannot be built here), calendar sharing or sync with external providers such as Google or Apple calendars, and any UI beyond what is needed to exercise and verify the API."

## Clarifications

### Session 2026-09-14

- Q: Does a child's participation on an event make that event a "child's record" under Constitution Principle VI? → A: Guardians only. An event with a child participant is reachable only by that child's guardians, not by every member holding the calendar read capability. This is the strict reading of Principle VI, which states that family membership alone MUST NOT grant access to a child's records, and the constitution names children's medical appointments as precisely the case it is protecting. The accepted cost is that an extended or viewer member cannot see a child's commitments at all.
- Q: Can a single occurrence of a recurring series be moved or cancelled on its own in this feature? → A: Cancel-only. A single occurrence can be skipped, leaving the rest of the series intact; it cannot be independently moved or retimed. Moving an individual occurrence is deferred to a later feature.
- Q: What should public-holiday awareness actually do to a recurrence expansion? → A: Holiday data is exposed to callers but has no effect on expansion. An occurrence landing on a public holiday still occurs. The recurrence vocabulary stays conformant to RFC 5545 and is not extended with skip or shift behaviour, which is deferred until a context actually needs it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Put something on the family's calendar and see it there (Priority: P1)

A member of an existing family records a one-off event — a title, when it starts, when it ends, and the time zone it was authored in — and it appears when the family asks what is happening over a range of dates.

**Why this priority**: This is the floor. A calendar that cannot record a single appointment and show it back is not a calendar, and every other story here presupposes it. It is also the first slice that proves the whole tenant chain works end to end for a context other than Family itself: a request resolves to a member's standing, a capability is checked, a family-scoped row is written, and only that family can read it back.

**Independent Test**: Can be fully tested by having a member of an existing family create an event and then query a date range covering it, confirming it comes back, and confirming a member of a different family querying the same range gets nothing and querying the event directly gets a not-found response.

**Acceptance Scenarios**:

1. **Given** a member of an existing family holding the calendar write capability, **When** they create an event with a title, a start, an end and a time zone, **Then** the event is created scoped to that family and an `EventCreated` event is published.
2. **Given** an existing event, **When** any member of that family holding the calendar read capability queries a date range that covers it, **Then** the event is returned within that range.
3. **Given** an existing event, **When** a member of a *different* family queries a range covering it or requests it by identifier, **Then** the response is indistinguishable from the event not existing.
4. **Given** a member holding only the calendar read capability, **When** they attempt to create an event, **Then** the attempt is rejected.
5. **Given** an event creation request whose end is before its start, **When** creation is attempted, **Then** it is rejected with a specific, actionable reason.
6. **Given** an event creation request naming a time zone that is not a recognised IANA identifier, **When** creation is attempted, **Then** it is rejected rather than silently defaulting.

---

### User Story 2 - Say who an event is for and where it is (Priority: P2)

A member enriches an event with the people it concerns — including children, who have no account of their own — a location, and a category, so that the calendar answers "who needs to be where" rather than only "something is happening".

**Why this priority**: An event with no participant is a note. The platform's actual promise is that a household knows which of its people needs to be where, and the people it most needs to track are exactly the ones who cannot hold an account. This is also where the platform's central privacy rule meets the calendar for the first time.

**Independent Test**: Can be fully tested by adding both an adult member and a child member as participants on an event, confirming the event records them as family member references with no dependency on either holding an account, and confirming the child's participation is reachable only under the visibility rule this feature adopts.

**Acceptance Scenarios**:

1. **Given** an existing event and an existing family member with a linked account, **When** that member is added as a participant, **Then** the event records a reference to the family member, not to the underlying account.
2. **Given** an existing event and a child family member who has no account and no login path, **When** that child is added as a participant, **Then** the participation is recorded exactly as for any other member, because participation never implies an ability to sign in.
3. **Given** an event with a location and a category, **When** it is read back, **Then** both are returned as recorded.
4. **Given** an attempt to add a participant who is a member of a different family, **When** the attempt is made, **Then** it is rejected and the response discloses nothing about whether that member exists.
5. **Given** an event with a child participant, **When** a member who holds the calendar read capability but no guardianship relationship with that child reads the calendar, **Then** the event does not appear in their range query and requesting it directly is indistinguishable from it not existing.
6. **Given** an event with a child participant, **When** one of that child's guardians reads it, **Then** the event is returned and the read is written to the audit log with the acting member, the child, and the outcome.
7. **Given** a member who is a guardian of a child participant, **When** that guardianship is later revoked, **Then** events involving that child stop being visible to them from that point, because guardianship is evaluated at read time rather than when the event was created.

---

### User Story 3 - Schedule something that repeats, and have every occurrence be right (Priority: P3)

A member records an event that repeats — swimming every Tuesday at four, a bin collection every other Thursday, a birthday every year — and each repetition shows up at the correct local time, including across the two weekends a year when the clocks change.

**Why this priority**: Most of a household's calendar is repetition, and getting repetition wrong is worse than not supporting it: an event that silently shifts by an hour in late October sends a family to a swimming lesson at the wrong time. This is also the story that produces the shared recurrence kernel the Tasks context will later depend on, so its correctness is borrowed by a context that does not exist yet.

**Independent Test**: Can be fully tested by creating a weekly recurring event that spans the last Sunday in October, then querying ranges on either side of that date and confirming every occurrence holds the same local wall-clock time, with no additional feature required.

**Acceptance Scenarios**:

1. **Given** a member holding the calendar write capability, **When** they create an event with a recurrence rule, **Then** the event is created, its occurrences are materialised within the horizon, and an `OccurrenceMaterialised` event is published.
2. **Given** a weekly recurring event at a fixed local time spanning a daylight-saving transition, **When** occurrences either side of the transition are read, **Then** every occurrence holds the same local wall-clock time and the underlying instants differ by the transition offset.
3. **Given** a recurring event whose rule has no end date and no occurrence count, **When** its occurrences are materialised, **Then** materialisation stops at the horizon rather than attempting to expand indefinitely.
4. **Given** an all-day recurring event such as an annual birthday, **When** occurrences are read from any time zone, **Then** each falls on the intended calendar date and is not shifted by a time-zone offset.
5. **Given** a recurrence rule that would produce occurrences at an implausible density or volume, **When** creation is attempted, **Then** it is rejected rather than accepted and expanded.
6. **Given** a recurrence rule that is not a well-formed RFC 5545 rule, **When** creation is attempted, **Then** it is rejected with a specific reason.

---

### User Story 4 - Change your mind: move it, edit it, or call it off (Priority: P4)

A member edits an event — moving its time, changing its recurrence, or cancelling it — and the family's view of what is happening updates correspondingly, with a cancelled event remaining visible as cancelled rather than vanishing.

**Why this priority**: Plans change constantly, and a calendar that can only be appended to is abandoned within a week. It sits below recurrence because there must be something worth editing first, and because editing a recurring event is only meaningful once recurrence exists.

**Independent Test**: Can be fully tested by creating a recurring event, changing its recurrence rule, and confirming that occurrences matching the old rule but not the new one are gone while occurrences matching the new rule are present — then cancelling the event and confirming it still appears, marked cancelled.

**Acceptance Scenarios**:

1. **Given** an existing event, **When** a member holding the calendar write capability changes its title, time, location, category or participants, **Then** the change is stored and an `EventUpdated` event is published.
2. **Given** a recurring event with materialised occurrences, **When** its recurrence rule or its start time is changed, **Then** its materialised occurrences are rebuilt so that none contradicting the new rule survives.
3. **Given** an existing event, **When** a member cancels it, **Then** it is marked cancelled, an `EventCancelled` event is published, and it remains readable and still occupies its slot in a range query rather than being deleted.
4. **Given** a cancelled event, **When** a range query covering it is made, **Then** it is returned and distinguishable as cancelled, so that a family can see that something they expected is no longer happening.
5. **Given** a recurring event with materialised occurrences, **When** a member cancels one single occurrence, **Then** that occurrence alone is cancelled, every other occurrence in the series is untouched, and the cancellation survives a later rebuild of the series.
6. **Given** a recurring event, **When** a member attempts to move one single occurrence to a different time rather than cancelling it, **Then** the attempt is rejected, because retiming is a change to the series in this feature.
7. **Given** any mutating request, **When** the same request is retried with the same idempotency key, **Then** it does not produce a duplicate event, occurrence or participation.

---

### User Story 5 - The calendar keeps looking ahead on its own (Priority: P5)

A family's long-running repeating events keep producing occurrences months and years later, without anyone re-saving them, because the materialisation horizon advances on its own.

**Why this priority**: A refinement that only matters once time passes, but its absence is a slow, silent failure: an indefinitely repeating event created today would simply stop appearing once the horizon it was materialised against fell into the past, and nothing would report an error. It is last because every other story is demonstrable on the day it is built and this one is not.

**Independent Test**: Can be fully tested by creating an indefinitely repeating event, advancing the clock past the point where the original horizon would have been exhausted, running the sweep, and confirming occurrences now exist beyond the original horizon.

**Acceptance Scenarios**:

1. **Given** an indefinitely repeating event materialised to the current horizon, **When** time advances and the materialisation sweep runs, **Then** occurrences are extended so that the horizon remains at least the configured distance ahead of the present.
2. **Given** the materialisation sweep, **When** it runs against events it has already materialised, **Then** it produces no duplicate occurrences.
3. **Given** the materialisation sweep, **When** it runs, **Then** how far ahead each family's calendar is materialised is observable, so that a horizon falling behind is detectable before a family notices a missing occurrence.
4. **Given** a family whose events have all ended, **When** the sweep runs, **Then** no work is performed for that family and no occurrences are created.

---

### Edge Cases

- A recurring event's local start time falls in the hour that does not exist on the spring-forward morning — the occurrence resolves to a single defined instant by a stated, tested rule rather than being dropped or duplicated.
- A recurring event's local start time falls in the hour that happens twice on the autumn fall-back morning — the occurrence resolves to a single defined instant by a stated, tested rule.
- An event is authored in a time zone other than the family's usual one (a member travelling, or a household split across time zones) — the authored time zone is recorded with the event and the event does not silently re-anchor to anyone's current location.
- An all-day event crosses a month or year boundary — it is treated as date-bounded, never as an instant range subject to offset arithmetic.
- A participant is removed from the family while an event they are on is still in the future — the event survives and its reference to that person is resolved under the deletion rules stated below, never left as a dangling reference that breaks the range query.
- A member loses guardianship of a child who is a participant on future events — their access to those events follows the same rule as any other read of that child's record, evaluated at read time rather than frozen at the time the event was created.
- An attachment reference points at a document that does not exist, because the Document Vault context does not exist — the reference is stored and returned opaquely and is never validated or dereferenced by this feature.
- A member of one family attempts to read, edit, cancel or add a participant to another family's event or occurrence — every such attempt is indistinguishable from the target not existing, never a distinguishable "forbidden" response.
- A recurrence rule is edited to a form that produces no occurrences at all — accepted, and the series simply has no future occurrences, which is a different state from being cancelled.
- The materialisation sweep is interrupted partway through a family's events and re-run — it resumes without duplicating what it already produced.
- An event's recurrence rule is changed while the sweep is materialising that same event — the resulting occurrence set matches the rule that won, and never interleaves occurrences from both rules.
- A recurring event is created with a start far in the past — occurrences are materialised only within the retained window, not back across the whole history.

## Requirements *(mandatory)*

### Functional Requirements

**Recording an event**

- **FR-001**: System MUST allow a member holding the calendar write capability to create a CalendarEvent scoped to a single Family, given at minimum a title, a start, an end, and the time zone the event was authored in.
- **FR-002**: System MUST reject an event whose end precedes its start, and MUST reject a time zone that is not a recognised IANA time-zone identifier, in both cases with a specific, actionable reason rather than a silent default.
- **FR-003**: System MUST store every instant in UTC with time zone, and MUST additionally record the time zone the event was authored in, so that an event's intended local time is recoverable independently of where it is later read.
- **FR-004**: System MUST support all-day events as date-bounded rather than instant-bounded, so that an all-day event falls on its intended calendar date regardless of the reader's time zone.
- **FR-005**: System MUST allow an event to record a location and a category, and MUST NOT require either.

**Reading the calendar**

- **FR-006**: System MUST allow a member holding the calendar read capability to retrieve the occurrences falling within a requested date range for their family, returned in chronological order.
- **FR-007**: System MUST answer a range query by reading materialised occurrence rows, and MUST NOT expand recurrence rules at query time.
- **FR-008**: System MUST return cancelled events within range queries, distinguishable as cancelled, because a cancelled event still occupies its slot and a family needs to see that something they expected is no longer happening.

**Recurrence**

- **FR-009**: System MUST allow an event to carry a recurrence rule expressed as an RFC 5545 recurrence rule, and MUST reject a rule that is not well-formed.
- **FR-010**: System MUST materialise the occurrences of a recurring event as individual records within a bounded horizon ahead of the present, and MUST NOT attempt to expand an unbounded rule in full.
- **FR-011**: System MUST preserve an event's intended local wall-clock time across daylight-saving transitions, and MUST resolve local times that are non-existent or ambiguous because of a transition to exactly one instant by a stated, tested rule.
- **FR-012**: System MUST reject a recurrence rule whose expansion within the horizon would exceed a defined occurrence limit, rather than accepting it and expanding it.
- **FR-013**: System MUST implement recurrence parsing and expansion in a shared, dependency-free component that another bounded context can consume directly, without importing anything belonging to Calendar. The component MUST be free of I/O, clock access and randomness, and MUST obtain any public-holiday data through an interface supplied by its caller rather than embedding a jurisdiction's calendar, so that no UK-shaped primitive is fixed into it.
- **FR-014**: System MUST treat public-holiday data as available to callers but without effect on expansion: an occurrence landing on a public holiday still occurs. The recurrence vocabulary MUST remain conformant to RFC 5545 and MUST NOT be extended with holiday-skipping or working-day-shifting behaviour, so that no rule depends on holiday data being present in order to expand at all.

**Participants, and the people who cannot hold an account**

- **FR-015**: System MUST record an event's participants as references to family members, never as references to user accounts, and MUST allow a member with no linked account and no login path — including a child — to be a participant.
- **FR-016**: System MUST restrict every event that has a child participant to that child's guardians. A member holding the calendar read capability but no active guardianship relationship with that child MUST NOT be able to read the event, see it in a range query, or infer its existence, because family membership alone never grants access to a child's records. Guardianship MUST be evaluated at the time of the read, not frozen at the time the event was created.
- **FR-017**: System MUST write every permitted read of a child participant's details to the audit log, capturing the acting member, the child, and the outcome, and MUST audit every denial, per Constitution Principle VI.
- **FR-018**: System MUST reject an attempt to add a participant who is not a member of the same family, with a response that discloses nothing about whether that member exists.

**Editing and cancelling**

- **FR-019**: System MUST allow a member holding the calendar write capability to change an event's title, timing, location, category, participants and recurrence rule, publishing an `EventUpdated` event.
- **FR-020**: System MUST rebuild an event's materialised occurrences whenever a change affects which occurrences the rule produces, such that no occurrence contradicting the current rule survives the change, while preserving any individually cancelled occurrences recorded under FR-022.
- **FR-021**: System MUST support cancellation of an event as a state change, never a deletion, publishing an `EventCancelled` event and leaving the event readable and in place.
- **FR-022**: System MUST allow a single occurrence of a recurring series to be cancelled independently, leaving the rest of the series intact, and MUST preserve that cancellation across a subsequent rebuild of the series. System MUST NOT support independently moving or retiming a single occurrence; changing an occurrence's time is a change to the series.
- **FR-023**: System MUST accept and honour an idempotency key on every mutating operation, such that a retried request produces no duplicate event, occurrence or participation.

**Keeping the horizon ahead**

- **FR-024**: System MUST advance the materialisation horizon by background work rather than only at write time, so that an indefinitely repeating event continues to produce occurrences as time passes.
- **FR-025**: System MUST make the materialisation sweep idempotent, so that re-running it produces no duplicate occurrences.
- **FR-026**: System MUST expose how far ahead occurrences are materialised as an observable measure, so that a horizon falling behind is detectable before a family notices a missing occurrence.

**Boundaries, isolation and events**

- **FR-027**: System MUST determine a requesting user's standing exclusively through the Family context's published resolution port, MUST check capabilities and never role names, and MUST NOT read Family, member, guardianship or invitation data by any other means.
- **FR-028**: System MUST respond to any request referencing an event, occurrence or participation belonging to a family the requester has no standing in with the platform's standard not-found response, never a response that discloses the target's existence.
- **FR-029**: System MUST scope every record it stores to exactly one Family, and MUST enforce that scoping in the database in addition to in application code, consistent with the tenant-isolation model already established for the Family context.
- **FR-030**: System MUST publish `EventCreated`, `EventUpdated`, `EventCancelled` and `OccurrenceMaterialised` for every corresponding state change, regardless of whether any other context currently subscribes to them.
- **FR-031**: System MUST store attachment references as opaque identifiers, and MUST NOT validate, resolve or dereference them, because the context that would own them does not exist.
- **FR-032**: System MUST use the calendar read and calendar write capabilities already issued by the Family context, and MUST NOT require any change to that context's role-to-capability map.
- **FR-033**: System MUST expose the erasure operations required of every bounded context, covering both the removal of one member's data and the erasure of a whole family, per Constitution Principle XI.

### Key Entities

- **CalendarEvent**: The thing a family intends to happen. Holds a title, an optional description, a start and end, whether it is all-day, the time zone it was authored in, an optional location, an optional category, an optional recurrence rule, a status (confirmed or cancelled), and its participants. Scoped to exactly one Family. The record of truth — every occurrence is derived from it.
- **EventOccurrence**: A single materialised instance of an event within the horizon. Holds its own start and end instants, whether it has been individually cancelled, and a reference to the event that produced it. Otherwise derived data: rebuilt when the event changes, extended as the horizon advances, and never the place a fact is authored — its one authored attribute is that individual cancellation, which is why a rebuild must preserve it rather than regenerate blindly.
- **EventParticipant**: The link between an event and a family member it concerns. Holds a reference to the family member — never to a user account — so that a person with no login path can be a participant on their own appointment.
- **RecurrenceRule**: The rule that produces occurrences, expressed in the RFC 5545 vocabulary and nothing beyond it. A value with no identity of its own, owned by the event and interpreted by the shared recurrence component against a time zone. Public holidays are available to callers of that component but do not influence expansion, so a rule expands identically whether or not holiday data is supplied.
- **MaterialisationHorizon**: How far ahead a family's occurrences are currently materialised. Not user-facing, but the thing the background sweep advances and the thing operators watch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member of an existing family can record an appointment and see it on the family's calendar in under 30 seconds.
- **SC-002**: A family asking what is happening over the next 14 days receives a complete answer in a single request, with no perceptible delay, for a household with five years of accumulated history and hundreds of repeating events.
- **SC-003**: 100% of repeating events hold the same local wall-clock time on both sides of each of the two annual UK clock changes.
- **SC-004**: 100% of cross-family access attempts — reading, editing, cancelling, or adding a participant to another family's event or occurrence — receive a response indistinguishable from the target not existing.
- **SC-005**: At every point in time, zero materialised occurrences exist that contradict their event's current recurrence rule.
- **SC-006**: At every point in time, every indefinitely repeating event has occurrences materialised at least as far ahead as the configured horizon, with no family's horizon silently falling behind.
- **SC-007**: 100% of reads of a child participant's details are recorded in the audit log, whether they were permitted or denied.
- **SC-008**: Zero cancelled events disappear from the range in which they were scheduled; every one remains visible and identifiable as cancelled.
- **SC-009**: A retried create or edit request carrying the same idempotency key produces zero duplicate events, occurrences or participations.
- **SC-010**: The recurrence component can be consumed by a second bounded context with no change to it and no dependency on Calendar, demonstrated by it having no imports from any bounded context.
- **SC-011**: 100% of attempts to read an event involving a child by a family member who holds no active guardianship relationship with that child return a result indistinguishable from the event not existing, whatever else that member can reach in the family.
- **SC-012**: An individually cancelled occurrence stays cancelled across 100% of subsequent rebuilds of its series, including rebuilds triggered by a change to the recurrence rule itself.
- **SC-013**: Recurrence expansion produces identical results with and without public-holiday data supplied, confirming no rule silently depends on it.

## Personal Data, Deletion, and Export *(mandatory — Constitution Principle XI)*

1. **What personal data this feature stores, and why**:
   - **Event title and description** — free text a member authors. This is the calendar itself; without it an event is a timestamp nobody can act on. It is authored text and may name people, which is why it is treated as personal data even though the system never parses it.
   - **Start, end, all-day flag, and authored time zone** — when the family intends to be somewhere. The authored time zone is required by the platform's own rule that anything a user sees a date for records the time zone it was authored in.
   - **Location** — where a member of the household will physically be at a known time. Held because a calendar entry without a place is frequently unusable, and recognised as among the more sensitive fields here for exactly that reason.
   - **Category** — how the family classifies the event. Held so that a household can tell a medical appointment from a swimming lesson at a glance.
   - **Participants** — which of the family's people an event concerns, recorded as references to member records rather than as names. This is data *about* those people, including children, and is the field that makes a nursery appointment reachable as part of a child's schedule.
   - **Recurrence rule** — the pattern a commitment repeats on, which describes a household's routine and is therefore not neutral metadata.
   - **Attachment references** — identifiers only. No document content, no filename, no extracted text.
   - Nothing else. No attendee email addresses, no external calendar identities, no contact details for people outside the family, no structured health or school fields: those either belong to contexts that do not exist yet or have no specified feature requiring them, and Principle VI forbids collecting a field before one does.

2. **What happens when a family member's account is deleted**: their participation records are removed from every event, and events they authored remain as the family's own record with authorship reduced to the same tombstone reference the Family context already keeps. An event whose only participant was that person is retained, because it remains part of the household's history of its own arrangements, but it no longer references them. One honest limitation is stated rather than glossed: an event *title* is free text the family authored and may contain a person's name, and removing a member cannot rewrite text a household wrote about its own household. Structured references are removed; authored text is not machine-scrubbed. Deleting a member is never conflated with erasing a family.

3. **What happens when a whole family is erased**: every event, every materialised occurrence, every participation and every attachment reference scoped to that family is permanently removed. Nothing in this context survives a family erasure, and because every record here is scoped to exactly one family, there is no data the erasure cannot reach — which is the reason the scoping rule is enforced in the database and not only in application code.

4. **How this data appears in a user's data export**: an export contains the events that person is entitled to see under the same rules that govern reading them — no more, and evaluated the same way. It includes events they authored, events they participate in, and their family's shared events with the participants, timings, locations, categories and recurrence rules they can already see. It does not contain events restricted from them, including any event involving a child they are not a guardian of (FR-016). The rule that governs reading governs exporting; an export is not a second, more permissive read path.

5. **Retention period after which data is removed even without a deletion request**: events are retained for as long as the family is active. A household's record of what it did and when is its own, and there is no interval after which a family should stop being able to look back at its own calendar. Materialised occurrences are derived rather than authored, and are pruned behind a trailing window — the event and its recurrence rule remain the record of truth and any pruned past occurrence is reconstructible from them. Audit entries recording access to a child participant's details follow the platform's separate audit retention schedule, because erasing the record of an access would defeat the control that produced it.

## Out of Scope

- **Every other bounded context**: Tasks, Document Vault, Reminders, Notifications, AI Assistant, Billing and Entitlements, Audit and Compliance beyond the audit trail this feature's own obligations require, and Reference and Locale. The shared recurrence component is built here because Tasks will consume it, but no part of Tasks is built here.
- **The cross-context dashboard endpoint** described in the architecture document. It aggregates calendar, tasks and documents in one response; two of those three contexts do not exist, so it cannot be built or meaningfully tested yet. This feature provides the range query the dashboard will later read.
- **Reminders and notifications of any kind.** This feature decides nothing about what a family should be told or when. It publishes the events that the Reminders context will one day consume, and stops there.
- **Synchronisation or sharing with external calendars** such as Google, Apple or Outlook, in either direction, including subscription feeds. An external service that receives family data requires an ADR and a privacy review first.
- **Invitations to, or attendance responses from, people outside the family.** Participants are members of the family. There is no external attendee, no RSVP and no availability lookup.
- **Validating or dereferencing attachment references.** They are opaque identifiers until the Document Vault context exists.
- **Real public-holiday data.** The recurrence component takes holidays through an interface; populating that interface from an authoritative source belongs to the deferred Reference and Locale context.
- **Holiday-aware recurrence behaviour.** Rules that skip a public holiday, or shift to the next working day, are deliberately not part of the recurrence vocabulary. The first context that genuinely needs working-day semantics — most likely Tasks — specifies them, at which point the holiday interface is already in place to serve them.
- **Moving a single occurrence of a series.** One occurrence can be cancelled independently; retiming one independently of its series is deferred, and until then changing a time is a change to the series.
- **Any user interface** beyond what is needed to exercise and verify the API.
- **The erasure orchestration itself.** This feature exposes the erasure operations a family and a member require; the saga that calls them across every context belongs to Audit and Compliance.

## Assumptions

- The calendar read and calendar write capabilities this feature checks already exist in the Family context's role-to-capability map (spec 008), which issued them deliberately for a context that did not yet exist. This feature consumes those strings and changes nothing about how they are assigned: owner, adult and extended members can write; viewers can read. No ADR or change to the Family context is therefore required, and if implementation finds one is, that is a signal to stop rather than to edit the map.
- A family's calendar is shared by default among members holding the read capability, with exactly one exception: events involving a child are restricted to that child's guardians (FR-016). This feature introduces no other per-event visibility, no private events and no personal calendar distinct from the family's. The child rule is a privacy control required by the constitution, not the beginning of a general sharing model, and a household that wants an extended member to see a child's commitments grants guardianship rather than acquiring a new visibility setting.
- Any member holding the calendar write capability may edit or cancel any of their family's events, not only ones they authored. A household calendar that only its author can correct does not match how households actually operate, and the platform's authorization model is capability-based rather than ownership-based.
- The materialisation horizon is a configured span rather than a per-family or per-event choice, and it is long enough that no realistic query outruns it. Its exact length is an implementation decision for the plan, constrained by FR-026 making it observable.
- Past occurrences are pruned behind a trailing window because they are derived data reconstructible from the event and its rule. The events themselves are never pruned while the family is active.
- Event categories are a fixed, platform-defined set rather than family-authored labels, keeping them free of user-authored personal data and available for later contexts to reason about. Family-defined categories, if wanted, are a later feature.
- The two annual UK clock changes are the correctness bar this feature is tested against because the platform is UK-first, but nothing in the recurrence component is specific to the UK: it operates on IANA time zones and caller-supplied holidays, and a second jurisdiction would need no change to it.
- Nothing subscribes to the four published events yet. They are published because the architecture document requires them and because Reminders will consume them, and their absence of subscribers is not evidence they are unnecessary.
