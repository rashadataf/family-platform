# Feature Specification: Tasks

**Feature Branch**: `010-tasks`

**Created**: 2026-09-15

**Status**: Draft

**Input**: User description: "Implement the Tasks bounded context (ARCHITECTURE.md section 5.4) as the platform's second core scheduling subdomain, built on top of Family and Membership (spec 008), Identity and Access (spec 006), and the shared recurrence kernel @fp/kernel/recurrence delivered by Calendar (spec 009). Tasks owns things that must get done, with or without a fixed time: assignment, due dates, recurrence, priority, completion, and categories. Aggregates are Task and TaskAssignment, exactly as named in the architecture doc. The architecture doc is explicit that Calendar and Tasks are separate contexts, not one "Planning" context: an event is attended and has a duration, a task is completed by someone and has a state machine. Their invariants diverge — a cancelled event still occupies its slot, but a completed recurring task spawns its successor, and an overdue task escalates while an overdue event does not — so this feature must model a genuine task lifecycle state machine and must not copy the Calendar aggregate shape or introduce a type discriminator shared with events. Recurrence must consume @fp/kernel/recurrence as-is; Tasks must not reimplement, fork, or reach into Calendar-internal code for recurrence or timezone logic, and must not depend on the Calendar context at all. The completion model for recurring tasks is successor-spawning, not materialised occurrences: completing (or otherwise closing) an instance of a recurring task creates the next instance from the rule, and per ADR-005 this derivation happens as an in-process domain event inside the same transaction so the completed task and its successor are never observed inconsistently. Calendar spec 009 deliberately deferred holiday-aware recurrence (skip a public holiday, or shift to the next working day) to the first context that needs working-day semantics, naming Tasks as the likely candidate; this feature must decide, through the spec, whether task due dates need that behaviour, and if so it must be expressed through the existing public-holiday port in the kernel rather than by hardcoding a UK calendar. Assignees are FamilyMember references (memberId) from the Family context, never User references; a task may be assigned to a child who has no account (e.g. "pack PE kit"), and Constitution Principle VI applies exactly as Calendar adopted it: a task concerning a child is reachable only by that child's guardians, evaluated at read time, with guardian reads of a child's record written to the audit log. Overdue is a first-class concept: the context must be able to determine which tasks are overdue and must publish TaskOverdue, which implies a worker-driven detection mechanism that is replayable, observable and testable by moving a clock rather than per-task scheduled callbacks, consistent with ADR-005's sweep philosophy; the escalation policy itself (who gets told, and when) belongs to the deferred Reminders and Notifications contexts and is out of scope. Authorization must go exclusively through the FamilyContextPort open host service, checking the existing tasks:read and tasks:write capabilities, never roles, never querying Family tables directly, with the boundary verified by the existing boundary tests. Every Tasks table is family-scoped and must sit behind the defence-in-depth tenant isolation of ARCHITECTURE.md section 9 and ADR-017, including row-level security under the two database roles established by spec 008. The context must publish TaskCreated, TaskAssigned, TaskCompleted and TaskOverdue per the architecture doc even though Reminders, the eventual consumer, does not exist yet, and must implement the ErasurePort operations for a family and for a member as Calendar did. Out of scope: every other bounded context (Reminders, Notifications, Document Vault, AI Assistant, Billing, Compliance orchestration, Reference and Locale data population), any change to Calendar or linking tasks to calendar events, the GET /v1/families/:id/dashboard aggregate endpoint (Document Vault still does not exist), external task-manager sync, and any UI beyond what is needed to exercise and verify the API."

## Decisions Taken While Specifying

These choices had more than one reasonable answer. They were settled here so the spec could go on to planning. Each one is open to review, and changing one changes the requirements it names.

- **Holiday-aware due dates are not part of this feature (FR-017).** Tasks does need working days in the long run. "Submit the form by the next working day" is a real household deadline. But the public-holiday interface has no authoritative data behind it until Reference and Locale exists. A due date that shifts only when someone supplies holiday data would move in one environment and not in another, and that is worse than not moving at all. Weekday-only rules ("every weekday", "every Monday") are fully supported, because the RFC 5545 vocabulary already expresses them. Skipping or shifting around holidays is deferred again, this time to the first feature that ships real holiday data.
- **A successor's due date comes from the schedule, not from when the task was closed (FR-021).** "Bins out every Thursday" completed on Friday is next due the following Thursday, not eight days after Friday. If an instance is closed after one or more later scheduled dates have already passed, those dates are not created as a backlog of already-overdue instances. The successor is the first scheduled date after the moment of closing.
- **Overdue is a condition, not a lifecycle state (FR-025).** An open task whose due moment has passed is overdue. It is still open: it can still be completed, and completing it is ordinary completion. The lifecycle is `open → completed`, `open → cancelled`, and `completed → open` (reopen). `TaskOverdue` is published once for each due moment the task misses. Moving the due date resets this, so a task that becomes overdue again is reported again.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write down something that needs doing, and see what's still outstanding (Priority: P1)

A member of an existing family records a task, such as "renew the car tax", with an optional due date. It appears when the family asks what is still outstanding.

**Why this priority**: This is the floor. A task list that cannot record one thing and show it back is not a task list, and every other story depends on it. It is also the first slice that proves the tenant chain works end to end for a second consuming context: a request resolves to a member's standing, the tasks capability is checked, a family-scoped row is written, and only that family can read it back.

**Independent Test**: Have a member of an existing family create a task, list the family's open tasks, and confirm it comes back. Confirm that a member of a different family who lists tasks sees nothing, and gets a not-found response when requesting the task directly.

**Acceptance Scenarios**:

1. **Given** a member of an existing family holding the tasks write capability, **When** they create a task with a title and no due date, **Then** the task is created open, scoped to that family, and a `TaskCreated` event is published.
2. **Given** a member holding the tasks write capability, **When** they create a task with a due date, or a due date and time, and the time zone it was authored in, **Then** the task records exactly what was given and nothing more precise.
3. **Given** existing open tasks, **When** any member of that family holding the tasks read capability lists open tasks, **Then** the tasks are returned. Tasks with a due moment come first, earliest first. Tasks with no due date follow.
4. **Given** an existing task, **When** a member of a *different* family lists tasks or requests it by identifier, **Then** the response is indistinguishable from the task not existing.
5. **Given** a member holding only the tasks read capability, **When** they attempt to create a task, **Then** the attempt is rejected.
6. **Given** a task creation request naming a time zone that is not a recognised IANA identifier, or giving a due time without a time zone, **When** creation is attempted, **Then** it is rejected with a specific, actionable reason rather than silently defaulting.
7. **Given** a task with a priority and a category, **When** it is read back, **Then** both are returned as recorded.

---

### User Story 2 - Say whose job it is, including a child's (Priority: P2)

A member assigns a task to one or more of the family's people. That includes children, who have no account of their own, like "pack PE kit" for a seven-year-old. The list can then answer "what is each of us meant to be doing".

**Why this priority**: An unassigned task in a shared household is a task nobody does. The people a household most needs to track are often the ones who cannot hold an account. This is where the platform's central privacy rule meets the task list, and the rule has to hold exactly as it does in Calendar.

**Independent Test**: Assign a task to an adult member and to a child member. Confirm both assignments are recorded as family member references with no dependency on either person holding an account. Confirm the task is reachable only under the child-visibility rule.

**Acceptance Scenarios**:

1. **Given** an existing task and a family member with a linked account, **When** that member is assigned, **Then** the task records a reference to the family member, not to the underlying account, and a `TaskAssigned` event is published.
2. **Given** an existing task and a child family member with no account and no login path, **When** the child is assigned, **Then** the assignment is recorded exactly as for any other member, because being assigned never implies being able to sign in.
3. **Given** a member holding the tasks read capability, **When** they list open tasks assigned to a particular family member, **Then** only tasks assigned to that member are returned, still subject to every visibility rule below.
4. **Given** an attempt to assign a member of a different family, **When** the attempt is made, **Then** it is rejected, and the response discloses nothing about whether that member exists.
5. **Given** a task assigned to a child, **When** a member who holds the tasks read capability but is not that child's guardian lists or requests tasks, **Then** the task does not appear, and requesting it directly is indistinguishable from it not existing.
6. **Given** a task assigned to a child, **When** one of that child's guardians reads it, **Then** the task is returned and the read is written to the audit log with the acting member, the child, and the outcome.
7. **Given** a member who is a guardian of a child assignee, **When** that guardianship is later revoked, **Then** tasks assigned to that child stop being visible to them from that point, because guardianship is checked at read time.
8. **Given** a task with an assignee, **When** that assignee is unassigned, **Then** the assignment is removed and the task remains, open and otherwise unchanged.

---

### User Story 3 - Tick it off, call it off, or change your mind (Priority: P3)

A member marks a task done, calls it off because it no longer needs doing, reopens something ticked off by mistake, or edits the details. The outstanding list reflects each change, and the family can see who did what.

**Why this priority**: Completion is what makes this a task rather than a note, and it is the state machine the architecture separates from Calendar. It sits below assignment because "who did it" matters most once "whose job was it" exists.

**Independent Test**: Create a task. Complete it and confirm it leaves the open list, appears as completed with the completing member, and publishes `TaskCompleted`. Reopen it and confirm it is open again. Cancel it and confirm it is closed without counting as done.

**Acceptance Scenarios**:

1. **Given** an open task, **When** a member holding the tasks write capability completes it, **Then** it becomes completed, the completing member and the moment of completion are recorded, a `TaskCompleted` event is published, and it no longer appears among open tasks.
2. **Given** an open task assigned to a child, **When** one of that child's guardians completes it on the child's behalf, **Then** the completion records the guardian as the member who completed it. A person with no account never appears as the actor.
3. **Given** a completed task, **When** a member reopens it, **Then** it is open again, its completion record is cleared from its current state, and the change is published as an update.
4. **Given** an open task, **When** a member cancels it, **Then** it is closed as cancelled, it is distinguishable from a completed task, and it no longer appears among open tasks.
5. **Given** a cancelled task, **When** a member attempts to complete or reopen it, **Then** the attempt is rejected, because cancellation is terminal.
6. **Given** an open task, **When** a member changes its title, notes, due date, priority or category, **Then** the change is stored and an update is published.
7. **Given** two members completing the same open task at the same moment, **When** both requests are processed, **Then** exactly one completion is recorded, and the other request receives a conflict response rather than a second completion.
8. **Given** any mutating request, **When** the same request is retried with the same idempotency key, **Then** it produces no duplicate task, assignment, completion or successor.
9. **Given** a member holding the tasks read capability, **When** they list completed or cancelled tasks over a date range, **Then** those tasks are returned with who closed them and when, so the household can look back at what got done.

---

### User Story 4 - Chores that come round again (Priority: P4)

A member records a task that repeats: bins out every Thursday, water the plants every three days, the boiler service every year. Ticking off this week's instance produces next week's, due on the right day at the right local time, including across the clock changes.

**Why this priority**: A large part of running a household is repetition. A recurring task that does not come back, or comes back on the wrong day, silently breaks the promise that nothing is forgotten. It is also the first use of the recurrence kernel by a second context, which is the reason the kernel was built as a shared kernel.

**Independent Test**: Create a weekly recurring task due at a fixed local time the week before the last Sunday in October. Complete it and confirm exactly one successor exists, due one week later at the same local wall-clock time. Then complete an instance two weeks late and confirm the successor is the next scheduled date after the completion, with no backlog of missed instances.

**Acceptance Scenarios**:

1. **Given** a member holding the tasks write capability, **When** they create a task with a due date and a recurrence rule, **Then** exactly one open instance exists, due on the given date. Future instances are not created in advance.
2. **Given** an open instance of a recurring task, **When** it is completed, **Then** in the same step exactly one successor is created, open, due on the next scheduled date after the closed instance's due date and after the moment of closing. The successor carries forward the title, notes, priority, category, assignees and rule. At no moment can a reader see the completed instance without its successor.
3. **Given** an open instance of a recurring task, **When** it is cancelled as a single instance ("skip this week"), **Then** it is closed as cancelled and a successor is created exactly as for completion.
4. **Given** an open instance of a recurring task, **When** a member stops the series, **Then** the instance is closed as cancelled, no successor is created, and the series has ended.
5. **Given** a weekly recurring task at a fixed local time spanning a daylight-saving transition, **When** successive instances are completed across the transition, **Then** every successor is due at the same local wall-clock time.
6. **Given** a recurring task whose rule has reached its end date or occurrence count, **When** its last instance is closed, **Then** no successor is created.
7. **Given** a completed instance of a recurring task whose successor already exists, **When** the completed instance is reopened and completed again, **Then** no second successor is created.
8. **Given** an open instance of a recurring task, **When** a member changes its recurrence rule, **Then** the change applies to that instance and to every successor spawned from it. Previously closed instances are unchanged.
9. **Given** a recurrence rule that is not well-formed, **When** creation is attempted, **Then** it is rejected with a specific reason. **Given** a recurrence rule on a task with no due date, **When** creation is attempted, **Then** it is rejected, because a rule needs a date to recur from.

---

### User Story 5 - Overdue things get noticed without anyone looking (Priority: P5)

When a task's due moment passes and nobody has closed it, the platform notices on its own and records it as overdue. The future Reminders context can then decide who to tell.

**Why this priority**: This is the other half of what separates a task from an event: an overdue task escalates. It comes last because it only matters once time passes, and because nothing acts on it yet. Without it, though, Reminders would be built on a gap where nobody noticed anything.

**Independent Test**: Create a task due in the past relative to a moved clock, run the overdue sweep, and confirm a single `TaskOverdue` event is published. Run the sweep again and confirm nothing further is published. Move the due date later, move the clock past it, run the sweep, and confirm it is reported overdue again.

**Acceptance Scenarios**:

1. **Given** an open task whose due moment has passed, **When** the overdue sweep runs, **Then** a `TaskOverdue` event is published for it and the task reads as overdue.
2. **Given** a task already reported overdue for its current due moment, **When** the sweep runs again, **Then** no further `TaskOverdue` event is published for it.
3. **Given** a task reported overdue, **When** its due date is moved later and the new due moment passes, **Then** the next sweep reports it overdue again.
4. **Given** a task that is completed or cancelled before its due moment, or has no due date, **When** the sweep runs, **Then** it is never reported overdue.
5. **Given** a task due on a date with no time, **When** the sweep runs during that date in the task's authored time zone, **Then** the task is not yet overdue. It becomes overdue only once that whole date has ended there.
6. **Given** the sweep is interrupted partway through and re-run, **When** it completes, **Then** every task that was overdue has been reported exactly once.
7. **Given** the sweep, **When** it runs, **Then** how far behind overdue detection is running is observable, so a stalled sweep is detectable before a family misses something.

---

### Edge Cases

- A task's due time falls in the hour that does not exist on the spring-forward morning, or in the hour that occurs twice on the autumn fall-back morning. It resolves to one defined instant by the same stated, tested rule the recurrence kernel already applies. It is never dropped, duplicated or shifted by a whole day.
- A recurring task's next scheduled date falls on a public holiday. The successor is due on that date, as scheduled. This feature does not move due dates around holidays (see Decisions).
- A member is removed from the family while assigned to open tasks. The tasks survive with that assignment removed, and a task left with no assignees is unassigned rather than deleted or hidden.
- A member loses guardianship of a child assigned to open tasks. Their access follows the same read-time rule as any other read of that child's record, including tasks they themselves created.
- A task is assigned to both an adult and a child. The child rule applies: only the child's guardians can reach it, because the task concerns the child. The adult assignee who is not a guardian of that child cannot see a task they are assigned to, and this cost is accepted, as it was in Calendar.
- A recurring task is completed while its recurrence rule is being edited by another member. The successor follows exactly one of the two rules, and the concurrency conflict is surfaced to the losing request. The result never mixes the two rules.
- A completed instance of a recurring task is reopened after its successor has itself been completed. Reopening succeeds and creates nothing new, and the series is not rewound.
- An open instance of a recurring task has only its due date moved, for example bins pushed from Thursday to Friday in a bank-holiday week. The move applies to that instance alone, and its successor is still due on the next scheduled Thursday. Changing the day a series falls on is a change to its recurrence rule. This is also how a household works around a holiday by hand while holiday-aware due dates are deferred.
- A recurring task's rule produces no further dates at all (an end date already in the past). Closing the current instance creates no successor. That is a normal end of series, not an error.
- A task is created with a due moment already in the past. It is accepted and reported overdue by the next sweep. It is not rejected, because recording something that should already have been done is a common real case.
- A member of one family attempts to read, edit, complete, reopen, cancel or assign another family's task. Every such attempt is indistinguishable from the target not existing.
- The same task is listed by a guardian and by a non-guardian at the same time. Each sees exactly what their own standing permits, and the list count never reveals the existence of hidden tasks.
- A due date with no time is read by a member in a different time zone. It still shows as that calendar date and is never shifted by an offset.

## Requirements *(mandatory)*

### Functional Requirements

**Recording a task**

- **FR-001**: System MUST allow a member holding the tasks write capability to create a Task scoped to a single Family, given at minimum a title.
- **FR-002**: System MUST allow a task to have no due date, a due date without a time, or a due date with a time. When a due date is given, System MUST record the IANA time zone it was authored in, and MUST reject an unrecognised time zone with a specific, actionable reason rather than a silent default.
- **FR-003**: System MUST store every instant in UTC with time zone. System MUST treat a date-only due date as a calendar date, never as an instant subject to offset arithmetic, whose due moment is the end of that date in the authored time zone.
- **FR-004**: System MUST allow a task to record optional notes, a priority from a fixed platform-defined set, and a category from a fixed platform-defined set, and MUST NOT require any of them.

**Reading tasks**

- **FR-005**: System MUST allow a member holding the tasks read capability to list their family's open tasks, filterable by assignee, by overdue, and by due-date range. Results are ordered by due moment, earliest first, with undated tasks last.
- **FR-006**: System MUST allow a member holding the tasks read capability to list completed and cancelled tasks over a date range of closure, including who closed each one and when.
- **FR-007**: System MUST allow a member holding the tasks read capability to read a single task by identifier, including its status, assignees, whether it is overdue and, if it belongs to a recurring series, its rule.

**The lifecycle**

- **FR-008**: System MUST model a task's lifecycle as exactly three states, open, completed and cancelled, with exactly these transitions: open to completed (complete), open to cancelled (cancel), and completed to open (reopen). Every other transition MUST be rejected with a specific reason, and cancelled MUST be terminal.
- **FR-009**: System MUST record, on completion, the family member who completed the task and the moment of completion. On cancellation it MUST record the member who cancelled and the moment. The recorded actor MUST always be a member acting through an account, never a member with no login path.
- **FR-010**: System MUST allow a member holding the tasks write capability to change an open task's title, notes, due date, time zone, priority, category and recurrence rule. It MUST NOT allow changes to a closed task other than reopening a completed one.
- **FR-011**: System MUST protect every task against concurrent modification. When two changes to the same task race, exactly one succeeds and the other receives a conflict response. Changes are never merged silently or applied twice.
- **FR-012**: System MUST model the task lifecycle independently of Calendar. It MUST NOT share an aggregate, table, status set or type discriminator with calendar events, and MUST NOT depend on the Calendar context in any way.

**Assignment, and the people who cannot hold an account**

- **FR-013**: System MUST record a task's assignees as references to family members, never as references to user accounts. It MUST allow zero or more assignees, and MUST allow a member with no linked account and no login path, including a child, to be assigned.
- **FR-014**: System MUST restrict every task with a child assignee to that child's guardians. A member holding the tasks read capability but no active guardianship relationship with that child MUST NOT be able to read, list, count, modify or infer the existence of the task. Guardianship MUST be checked at read time, not recorded when the task was created.
- **FR-015**: System MUST write every permitted read of a child assignee's task to the audit log, capturing the acting member, the child, and the outcome, and MUST audit every denial, per Constitution Principle VI.
- **FR-016**: System MUST reject an attempt to assign a family member who is not a member of the same family, with a response that discloses nothing about whether that member exists.

**Recurrence**

- **FR-017**: System MUST allow a task with a due date to carry a recurrence rule expressed in RFC 5545 vocabulary, and MUST reject a malformed rule, or a rule on a task without a due date, with a specific reason. System MUST NOT move a due date because it falls on a public holiday or non-working day, and MUST NOT extend the recurrence vocabulary with holiday-skipping or working-day-shifting behaviour.
- **FR-018**: System MUST perform all recurrence parsing, expansion and time-zone resolution through the shared recurrence kernel. Tasks MUST NOT reimplement, copy or fork that logic, and MUST NOT import anything belonging to the Calendar context. Any change the kernel needs for this feature MUST be additive and MUST keep it pure and free of I/O, clock access and randomness.
- **FR-019**: System MUST keep exactly one head per recurring series: the newest instance, the only one that can spawn a successor. A series whose head is open has exactly one open instance the rule is waiting on. System MUST NOT create future instances in advance. A past instance that is reopened (FR-008) is an ordinary open task. It does not become the head again and never spawns a second successor.
- **FR-020**: System MUST create the successor of a recurring instance in the same atomic step as closing that instance, whether it was completed or cancelled as a single instance, so that no reader can ever observe a closed instance without its successor. Stopping the series closes the instance as cancelled and creates no successor.
- **FR-021**: System MUST set a successor's due date to the first date produced by the rule that is later than both the closed instance's due moment and the moment of closing. It MUST NOT create instances for scheduled dates skipped over by a late closure. A successor MUST carry forward the title, notes, priority, category, assignees, time zone and rule.
- **FR-022**: System MUST create at most one successor per instance, across retries, reopen-and-recomplete, and concurrent closure attempts.
- **FR-023**: System MUST NOT create a successor when the rule produces no further dates.
- **FR-024**: System MUST preserve a recurring task's intended local wall-clock due time across daylight-saving transitions.

**Overdue**

- **FR-025**: System MUST treat an open task whose due moment has passed as overdue. Overdue is a derived condition, not a lifecycle state: an overdue task remains open and is completed or cancelled like any other.
- **FR-026**: System MUST detect newly overdue tasks by recurring background work over stored due moments, not by per-task scheduled callbacks. The detection MUST produce identical results when re-run for the same moment, and MUST be testable by moving a clock. It MUST run on its own, on a fixed cadence, in every environment where the platform runs, without anyone invoking it by hand.
- **FR-027**: System MUST publish `TaskOverdue` exactly once per task per due moment. It MUST NOT publish again for the same due moment on a re-run, and MUST publish again if the due moment is changed and the new one passes.
- **FR-028**: System MUST expose how far behind overdue detection is running as an observable measure, so a stalled or failing sweep is detectable before a family misses something.
- **FR-029**: System MUST NOT decide who is told about an overdue task, or when. That policy belongs to Reminders and Notifications.
**Boundaries, isolation and events**

- **FR-030**: System MUST determine a requesting user's standing exclusively through the Family context's published resolution port. It MUST check the tasks read and tasks write capabilities and never role names, and MUST NOT read Family, member, guardianship or invitation data by any other means.
- **FR-031**: System MUST use the tasks read and tasks write capabilities already issued by the Family context, and MUST NOT require any change to that context's role-to-capability map.
- **FR-032**: System MUST respond to any request referencing a task or assignment belonging to a family the requester has no standing in with the platform's standard not-found response, never a response that discloses the target's existence.
- **FR-033**: System MUST scope every record it stores to exactly one Family, and MUST enforce that scoping in the database as well as in application code, consistent with the tenant-isolation model established for the Family and Calendar contexts.
- **FR-034**: System MUST publish `TaskCreated`, `TaskAssigned`, `TaskCompleted` and `TaskOverdue` for every corresponding state change, and additionally `TaskUpdated` (covering edits, unassignment and reopening) and `TaskCancelled`, regardless of whether any context currently subscribes. Event payloads MUST carry identifiers only, never titles, notes or other authored text.
- **FR-035**: System MUST accept and honour an idempotency key on every mutating operation.
- **FR-036**: System MUST expose the erasure operations required of every bounded context, covering both the removal of one member's data and the erasure of a whole family, per Constitution Principle XI.

**Background work runs on its own**

- **FR-037**: System MUST run all of the platform's recurring background work on its own, each on a configured fixed cadence, in every environment where the platform runs, including the shared staging environment. That covers this feature's overdue detection and the retention, erasure, invitation-expiry, guardian-coverage and calendar-horizon work of earlier features. A run that is still in progress MUST NOT be started a second time, a failing run MUST NOT stop other background work or later runs, and stopping the platform MUST let an in-progress run finish or abandon it safely.
- **FR-038**: System MUST make it observable when recurring background work has stopped running or keeps failing, so that a stalled schedule is detectable before a family notices something was not done.

### Key Entities

- **Task**: One thing that must get done. Holds a title, optional notes, an optional due date (with or without a time) and its authored time zone, a priority, an optional category, a lifecycle status (open, completed or cancelled), who closed it and when, the due moment most recently reported overdue, a concurrency version, and, if recurring, its recurrence rule and a reference to the series it belongs to. Scoped to exactly one Family. Each instance of a recurring chore is its own Task, which is why a completed instance keeps its own record of who did it.
- **TaskAssignment**: The link between a task and a family member whose job it is. Holds a reference to the family member, never to a user account, so a person with no login path can be assigned. It is also what makes a task concern a child for visibility purposes.
- **Series**: The identity shared by successive instances of one recurring task, so that "every instance of bins night" can be recognised, a successor can be proven unique for its predecessor, and stopping the series is a meaningful command. It knows which instance is its head, the newest one and the only one able to spawn a successor, and carries no authored data of its own.
- **RecurrenceRule**: The rule that produces successive due dates, in RFC 5545 vocabulary and nothing beyond it. A value owned by the task and interpreted by the shared recurrence kernel against the authored time zone.
- **OverdueDetectionProgress**: How far overdue detection has got. Not user-facing, but the thing the background sweep advances and the thing operators watch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member of an existing family can record a task and see it on the family's outstanding list in under 30 seconds.
- **SC-002**: A family asking what is outstanding, or what is due in the next 14 days, receives a complete answer in a single request with no perceptible delay, for a household with five years of accumulated completed chores.
- **SC-003**: 100% of cross-family access attempts to read, edit, complete, reopen, cancel or assign another family's task receive a response indistinguishable from the target not existing.
- **SC-004**: 100% of attempts to reach a task assigned to a child, by a member with no active guardianship of that child, return a result indistinguishable from the task not existing, including in list counts.
- **SC-005**: 100% of reads of a task assigned to a child are recorded in the audit log, whether permitted or denied.
- **SC-006**: At every point in time, every recurring series that has not ended has exactly one open head instance: never zero, never two. Reopening a past instance never creates a second head.
- **SC-007**: 100% of recurring tasks due at a fixed local time are due at that same local wall-clock time on both sides of each of the two annual UK clock changes.
- **SC-008**: 100% of tasks whose due moment passes while they are open are reported overdue exactly once for that due moment, including when the sweep is interrupted and re-run.
- **SC-009**: A retried or concurrent completion of the same task produces zero duplicate completions and zero duplicate successors.
- **SC-010**: Tasks uses the recurrence kernel with no copied recurrence or time-zone logic and no dependency on the Calendar context, as shown by the boundary checks.
- **SC-011**: No task event payload contains a title, note or any other authored text.
- **SC-012**: In a running environment with nobody intervening, 99% of tasks whose due moment passes while they are open are reported overdue within 5 minutes of that moment.
- **SC-013**: After the platform starts, every kind of recurring background work has run at least once within its own configured cadence, with no manual step, in both local and staging environments.

## Personal Data, Deletion, and Export *(mandatory — Constitution Principle XI)*

1. **What personal data this feature stores, and why**:
   - **Task title and notes**: free text a member writes. This is the task itself; without it a task is a checkbox nobody can act on. It may name people or describe private household matters, so it is treated as personal data even though the system never parses it.
   - **Due date, due time and authored time zone**: when the household intends something to be done by. The authored time zone is required by the platform's rule that anything a user sees a date for records the time zone it was authored in.
   - **Priority and category**: how the family ranks and classifies the task, from fixed platform-defined sets. Held so a household can see what matters most, and so later contexts can reason about categories without parsing text.
   - **Assignees**: which of the family's people a task is for, recorded as references to member records rather than names. This is data *about* those people, including children, and it is the field that makes "pack PE kit" part of a child's record.
   - **Who completed or cancelled a task, and when**: the household's record of who did what. Held because "was the boiler booked, and by whom" is a question families actually ask, and because it is what lets a guardian's completion on a child's behalf be attributed honestly.
   - **Recurrence rule and series membership**: the pattern a chore repeats on, which describes a household's routine and is therefore not neutral metadata.
   - **Overdue detection marker**: the due moment last reported overdue. Operational data about the task, holding nothing new about any person.
   - Nothing else. No attachments, no locations, no contact details, no links to calendar events, no subtasks, no comments. None of these has a specified feature requiring it, and Principle VI forbids collecting a field before one does.

2. **What happens when a family member's account is deleted**: their assignments are removed from every task. Tasks they created, completed or cancelled remain as the family's own record, with those actor references reduced to the same tombstone reference the Family context already keeps. A task whose only assignee was that person stays, unassigned, because the household still needs it done. One limitation is stated plainly: a task's title and notes are free text the family wrote and may contain a person's name. Removing a member cannot rewrite text a household wrote about itself. Structured references are removed; authored text is not machine-scrubbed. Deleting a member is never treated as erasing a family.

3. **What happens when a whole family is erased**: every task, assignment, series and overdue marker scoped to that family is permanently removed. Nothing in this context survives a family erasure. Because every record here is scoped to exactly one family, the erasure can reach all of it, which is why the scoping rule is enforced in the database and not only in application code.

4. **How this data appears in a user's data export**: an export contains the tasks that person is entitled to see, under the same rules that govern reading them, no more. It includes open, completed and cancelled tasks, with assignees, due dates, priorities, categories, recurrence rules and who closed each one. It excludes tasks restricted from them, including any task assigned to a child they are not a guardian of (FR-014). The rule that governs reading also governs exporting; an export is not a second, more permissive read path.

5. **Retention period after which data is removed even without a deletion request**: open tasks are retained for as long as the family is active. Completed and cancelled tasks are also retained while the family is active, because a household's record of what it got done is its own and there is no interval after which it should lose that. Unlike Calendar's occurrences, a closed task instance is authored fact rather than derived data, so it is not pruned. Audit entries recording access to a child's tasks follow the platform's separate audit retention schedule, because erasing the record of an access would defeat the control that produced it.

## Out of Scope

- **Every other bounded context**: Reminders, Notifications, Document Vault, AI Assistant, Billing and Entitlements, Audit and Compliance beyond the audit trail this feature's own obligations require, and populating Reference and Locale data.
- **Deciding who is told about an overdue task, and when.** This feature detects and publishes; escalation is Reminders' policy and delivery is Notifications'.
- **Holiday-aware or working-day due dates.** Deferred until real public-holiday data exists (see Decisions). Weekday-only recurrence is in scope because RFC 5545 already expresses it.
- **Any change to Calendar**, and any link between a task and a calendar event, in either direction.
- **The cross-context dashboard endpoint.** Document Vault still does not exist. This feature provides the due-range and overdue queries the dashboard will later read.
- **Subtasks, checklists, comments, attachments, and dependencies between tasks.**
- **Per-task privacy or personal task lists.** Tasks are shared across the family, with the child-guardian rule as the only restriction.
- **Rewards, points or allowance tracking for children's chores.**
- **Completion-anchored recurrence** ("three days after I last did it"). Successors are scheduled from the rule, not from completion (see Decisions).
- **Synchronisation with external task managers**, in either direction.
- **Delivering events to other contexts.** The outbox relay, queues and dead-letter handling are spec 011, per ADR-018.
- **Any user interface** beyond what is needed to exercise and verify the API.
- **The erasure orchestration itself.** This feature exposes the erasure operations; the saga that calls them belongs to Audit and Compliance.

## Assumptions

- The tasks read and tasks write capabilities already exist in the Family context's role-to-capability map (spec 008). Owner, adult and extended members can write; viewers can read. This feature uses them unchanged. If implementation finds a change is needed, that is a signal to stop rather than to edit the map.
- Any member holding the tasks write capability may complete, cancel, reopen or edit any of the family's tasks they can see, not only ones assigned to them or created by them. The platform's authorization model is based on capabilities, not ownership, and households routinely do each other's chores.
- A task concerns a child when a child is among its assignees. Title or notes mentioning a child do not make it one, because the system never parses authored text.
- Priorities and categories are fixed platform-defined sets, as Calendar's categories are, keeping them free of user-authored personal data. Family-defined labels, if wanted, are a later feature.
- The two extra events, `TaskUpdated` and `TaskCancelled`, are an additive extension of the four named in ARCHITECTURE.md §5.4. Reminders will need them to withdraw or reschedule reminders for a task whose due date moved or that no longer needs doing. They do not change a context boundary, so no ADR is required, but §5.4's published-events list is updated alongside this feature.
- The overdue sweep runs on a fixed cadence in the existing background worker, which this feature makes run all background work on its own (FR-037). Before this feature, every earlier feature's background work only ran when someone invoked it by hand, and the staging environment did not run the worker at all. Fixing that here, rather than in a separate feature, is deliberate: overdue detection is the first background work whose value depends on timeliness. Exact cadences are a planning decision, bounded by SC-012.
- Delivering published events to other contexts (the relay from the outbox to queues) is **not** part of this feature. It belongs to a dedicated feature, spec 011, which depends on ADR-018 being accepted and which must be complete before Reminders. Until then, events are durably recorded but not delivered, which is harmless while nothing subscribes.
- The recurrence kernel from spec 009 already provides expansion from a rule, a start and a time zone. Finding "the first date after a given moment" is expected to be expressible with it. If a small additive function is needed, FR-018 permits it, provided the kernel stays pure.
- Nothing subscribes to the published events yet. They are published because the architecture requires them and Reminders will consume them.
