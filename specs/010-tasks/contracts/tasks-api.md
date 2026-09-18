# Contract: Tasks API v1 (spec 010)

**Spec**: [spec.md](../spec.md) | **Plan**: [plan.md](../plan.md) | **Data model**: [data-model.md](../data-model.md)

Additive within `/v1` ([ADR-006](../../../adr/ADR-006-api-style-and-type-safety.md)). Defined in
`packages/contracts/src/v1/tasks.contract.ts` and consumed by `apps/api` and the mobile app from that
one file (Principle IX). Every route is family-scoped.

## Routes

Every row returns **404** to a caller with no standing in `:familyId` before the capability is
consulted. The guard chain is spec 008's, unchanged.

| Method | Path | Capability |
|---|---|---|
| `GET` | `/v1/families/:familyId/tasks?assignee=&overdue=&dueFrom=&dueTo=&cursor=&limit=` | `tasks:read` |
| `GET` | `/v1/families/:familyId/tasks/history?from=&to=&cursor=&limit=` | `tasks:read` |
| `POST` | `/v1/families/:familyId/tasks` | `tasks:write` |
| `GET` | `/v1/families/:familyId/tasks/:taskId` | `tasks:read` |
| `PATCH` | `/v1/families/:familyId/tasks/:taskId` | `tasks:write` |
| `POST` | `/v1/families/:familyId/tasks/:taskId/complete` | `tasks:write` |
| `POST` | `/v1/families/:familyId/tasks/:taskId/reopen` | `tasks:write` |
| `POST` | `/v1/families/:familyId/tasks/:taskId/cancel` | `tasks:write` |
| `PUT` | `/v1/families/:familyId/tasks/:taskId/assignees/:memberId` | `tasks:write` |
| `DELETE` | `/v1/families/:familyId/tasks/:taskId/assignees/:memberId` | `tasks:write` |

**`tasks:read` and `tasks:write` already exist** in `capabilities.ts`. Owner, adult and extended
members can write; viewers can read (FR-031). No change there, and no ADR.

**Transitions are `POST …/complete|reopen|cancel`, not a writable `status` field on `PATCH`.** Each
transition has its own preconditions, side effects (a successor) and event. A `status` field would
make `PATCH` a second, partial implementation of the state machine (FR-008), and "PATCH status to
completed" would have to decide whether to spawn a successor from a request that looks like an edit.

**Assignees are a sub-resource with `PUT`/`DELETE`**, both idempotent by construction. Assigning an
already-assigned member returns `200` with the current task, and removing an absent one also returns
`200`. A replace-the-whole-array field would publish `TaskAssigned` for members who were already
assigned, or need a diff to avoid it, and a concurrent add from another member would be silently
overwritten. `POST …/tasks` still accepts an initial `assigneeIds` array, because a task created and
then assigned in N more requests is N chances for a partial failure.

---

## The guardian boundary

Identical to Calendar's ([spec 009 contract](../../009-calendar/contracts/calendar-api.md#where-the-guardian-boundary-sits-exactly)),
with "assignee" for "participant".

- A task is **hidden** from a caller if **any** assignee is outside the caller's visible set
  (`MemberVisibilityPort`). Unassigned tasks are visible to every `tasks:read` holder.
- Hidden means: omitted from both lists **in the query** (so counts and page sizes reveal nothing),
  and `404 task/not_found` on every route addressing it directly, reads and writes alike.
- `?assignee=<childId>` from a non-guardian returns an empty page, not an error. An error would
  confirm the id is a child in this family.
- Every permitted read of a task with a guarded-child assignee writes one audit row per (task, child),
  action `task_assignment.read`, at task granularity. So does every denial on a direct route. List
  reads audit per task returned, never per page.

---

## Request and response shapes

| Shape | Note |
|---|---|
| `Due` | **Discriminated union on `kind`**: `{ kind: 'date', date: 'YYYY-MM-DD', timeZone }` or `{ kind: 'date_time', date, time: 'HH:mm', timeZone }`. Absent means no due date. A time without a zone is unrepresentable (US1 #6). `timeZone` is validated with the kernel's `isValidTimeZone` |
| `CreateTaskRequest` | `title`, `notes?`, `priority?`, `category?`, `due?`, `recurrenceRule?`, `assigneeIds?: memberId[]` (max 20). `recurrenceRule` without `due` is `422 task/recurrence_requires_due` |
| `UpdateTaskRequest` | `expectedVersion` (required) plus any of `title`, `notes`, `priority`, `category`, `due` (`null` clears it), `recurrenceRule` (`null` removes it). Only valid on `open` tasks |
| `CompleteTaskRequest` / `ReopenTaskRequest` | `{ expectedVersion }` |
| `CancelTaskRequest` | `{ expectedVersion, scope: 'instance' \| 'series' }` |
| `TaskResponse` | `taskId`, `version`, `title`, `notes`, `priority`, `category`, `status`, `due`, `dueAt`, `isOverdue`, `recurrenceRule`, `seriesId`, `isSeriesHead`, `predecessorId`, `assigneeIds`, `createdByMemberId`, `completedAt`, `completedByMemberId`, `cancelledAt`, `cancelledByMemberId` |
| `CloseTaskResponse` | `{ task: TaskResponse, successor: TaskResponse \| null }`, so a client can show next week's bins without a refetch |
| `TaskPage` | `{ items: TaskResponse[], nextCursor: string \| null }`. **No total count**, which would be a cheap inference channel for hidden tasks |

`isOverdue` is computed from the server clock at response time (FR-025). It never depends on whether
the sweep has run.

### Lists

**Open list** (`GET …/tasks`): `status = 'open'` only. Ordered by `due_at` ascending with nulls last,
then `id`. Keyset cursor over that ordering. `limit` 1–200, default 50. `overdue=true` narrows to
`due_at <= now`. `dueFrom`/`dueTo` are ISO instants filtering `due_at` half-open `[from, to)`, capped
at 400 days. Undated tasks are excluded whenever either bound is given.

**History** (`GET …/tasks/history`): `status <> 'open'`. `from`/`to` required, filtering `closed_at`,
capped at 400 days. Ordered by `closed_at` descending.

### Idempotency and concurrency

Every mutating route accepts and honours `Idempotency-Key` (FR-035) through the existing
`IdempotencyPort`. A retried key returns the stored response, successor included, and never re-runs
the transition.

Every route addressing an existing task, except the idempotent assignee `PUT`/`DELETE`, requires
`expectedVersion` ([research.md §9](../research.md)). A mismatch is `409 task/version_conflict`,
carrying the current `version` and nothing else, so the client refetches through the ordinary read
path, which re-applies visibility.

---

## Error types

| `type` | HTTP | When | Disclosure note |
|---|---|---|---|
| `task/not_found` | 404 | Does not exist, **or** no standing in the family, **or** has an assignee the caller may not see | Indistinguishable across all three (FR-014, FR-032, SC-003, SC-004) |
| `task/capability_required` | 403 | Member lacks the route's capability | Names the capability, never the role |
| `task/unknown_time_zone` | 422 | Not a recognised IANA zone | FR-002; never defaults |
| `task/invalid_due` | 422 | An invalid calendar date or time (`2026-02-30`, `25:00`) | Names the field |
| `task/recurrence_invalid` | 422 | Not well-formed RFC 5545 | FR-017 |
| `task/recurrence_unsupported` | 422 | Outside the kernel's declared subset | Names the unsupported part, as Calendar does |
| `task/recurrence_requires_due` | 422 | A rule on a task with no due date | FR-017 |
| `task/assignee_invalid` | 422 | Assignee not a member of this family | FR-016; discloses nothing about the id |
| `task/range_too_wide` | 422 | A due or history range over 400 days | |
| `task/invalid_transition` | 409 | Not permitted from the current status (FR-008), including any edit of a closed task | Carries `from` status and attempted command |
| `task/version_conflict` | 409 | `expectedVersion` is stale (FR-011) | Carries the current `version` only |

**A visible task with a stale version is `409`; a hidden one is `404` before the version is checked.**
Visibility is resolved first on every route, so a conflict response can never confirm a hidden task
exists.

---

## Authorization matrix

A route missing from here is a route without a test.

### The universal assertion

For every route accepting `:familyId`, a member of a different family receives `404 task/not_found`.
The routes are **added to spec 008's existing parameterised cross-family sweep**, the same table
Calendar extended.

### Per-route

| Route | Rule | Test that must exist |
|---|---|---|
| `POST …/tasks` | `tasks:write` | A `viewer` is denied `403`; an `extended` member succeeds |
| `GET …/tasks` | FR-014 in the query | A non-guardian's page **omits** a child's task; the guardian's includes it. The non-guardian's `items.length` equals the count with that task absent, asserted numerically |
| `GET …/tasks?assignee=<child>` | No disclosure | A non-guardian gets `200` with an empty page |
| `GET …/tasks/:taskId` | Read-time guardianship | Guardian reads, guardianship revoked, the same request is now `404` |
| `GET …/tasks/:taskId` | Role is not the control | An **owner** non-guardian is denied; a **viewer** guardian is allowed |
| `GET …/tasks/:taskId` | Mixed assignees | Adult plus unguarded child is hidden from the adult assignee |
| `POST …/complete` on a hidden task | Writes hide too | `404`, not `409`, even with a stale `expectedVersion` |
| `POST …/complete` | FR-009 | A guardian completing a child's task is recorded as `completedByMemberId`; the child is never the actor |
| `POST …/complete` concurrent | FR-011, SC-009 | Two parallel completions at the same version: one `200`, one `409`; exactly one successor row |
| `POST …/complete` retried | FR-035 | Same `Idempotency-Key` twice: identical bodies, one successor |
| `POST …/reopen` then `…/complete` | FR-022 | On a former head, no second successor |
| `POST …/cancel` `scope: series` | US4 #4 | No successor; `isSeriesHead` stays true on the cancelled row |
| `POST …/cancel` then `…/reopen` | Terminal | `409 task/invalid_transition` |
| `PATCH` on a completed task | FR-010 | `409 task/invalid_transition` |
| `PUT …/assignees/:memberId` foreign | FR-016 | `422 task/assignee_invalid`, identical body for a non-existent id |
| `PUT …/assignees/:childId` | Assigning hides from yourself | A non-guardian with `tasks:write` who assigns a child gets `200`, and the next read is `404`. **Asserted deliberately**: accepted behaviour, not a bug |

### Assertions that are not about a route

**RLS is real.** Spec 008's integration test is extended to `task` and `task_assignment`: zero rows
without `withTasksFamilyContext`, and zero again as the **owner** role (proving `FORCE`).

**Tasks reads Family only through published ports, and Calendar not at all.** AST test
([research.md §1](../research.md)).

**The successor invariants hold in the database.** An integration test attempts, via raw insert, a
second successor for one predecessor and a second head for one series. Both fail on the unique
indexes.

**No authored text leaves the context.** The telemetry test Calendar added
(`no-personal-data-in-telemetry.integration.spec.ts`) is copied for Tasks and asserts no title or
notes in any outbox payload, log line or audit `purpose` (SC-011).

---

## Rate limiting

| Route | Limit | Why |
|---|---|---|
| `GET …/tasks`, `GET …/tasks/history` | 120 per user per minute | The routes a broken client polls |
| `POST …/tasks` | 120 per user per hour | No legitimate bulk creation |
| Everything else | Default per-user limit | |

## Observability

Correlation id on every request, carried into outbox rows and audit entries.

| Signal | Why |
|---|---|
| `tasks_list_duration{list}` | SC-002, against the budgets in [research.md §11](../research.md) |
| `tasks_overdue_detection_lag_seconds` | `now − min(due_at)` of unreported overdue tasks after a pass. **This feature's alert** (FR-028) |
| `tasks_overdue_reported_total` | A pass that reports nothing forever looks like health |
| `tasks_successor_spawned_total{trigger}` | `complete` or `cancel_instance`. Compared with closures of heads, a gap is a broken series |
| `tasks_transition_conflict_total{type}` | `version_conflict` vs `invalid_transition`. A spike means a client is not refetching |
| `tasks_child_assignment_read_total{result}` | Principle VI's audit volume |
| `worker_sweep_run{sweep,outcome}` | One structured line per scheduled run: `succeeded`, `failed` or `skipped_overlap`, with duration. Covers all seven sweeps ([research.md §6](../research.md)) |
| `ALERT sweep_stalled{sweep}` | A sweep's last success is older than 3× its cadence (FR-038). The heartbeat `HEALTHCHECK` covers the process being wedged or dead |

No title, notes or any other authored text in any signal: identifiers and enum labels only.
