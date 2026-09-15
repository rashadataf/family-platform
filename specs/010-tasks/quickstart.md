# Quickstart: Tasks (spec 010)

Phase 1 output. Runnable scenarios that prove this feature works end to end. Each maps to a user
story, or to a requirement whose failure would be invisible without checking for it deliberately:
the successor chain under retries and races, the overdue marker, and every path through the guardian
filter.

Routes and error types are in [contracts/tasks-api.md](contracts/tasks-api.md), and fields are in
[data-model.md](data-model.md). They are not repeated here.

## Prerequisites

Docker, and nothing else ([ADR-014](../../adr/ADR-014-containerized-development.md)).

```sh
cp .env.example .env
docker compose up
curl -s localhost:3000/health/ready    # {"status":"ok"} before starting
```

Run [spec 008's quickstart](../008-family-membership/quickstart.md) through Scenario 4. That leaves:

| Who | Standing | Export as |
|---|---|---|
| Ada | owner, guardian of Charlie | `$ADA`, `$ADA_ID` |
| Grace | adult, **not** a guardian of Charlie | `$GRACE`, `$GRACE_ID` |
| Alan | extended member | `$ALAN` |
| Viv | viewer | `$VIV` |
| Charlie | child member, no account | `$CHARLIE_ID` |

Export the family as `$FAM`. Scenario 6 runs the worker's sweep script with `--as-of`.

---

## Scenario 1: Write it down, see it outstanding (User Story 1, FR-001 to FR-007)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/tasks \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"title":"Renew car tax","priority":"high","category":"admin",
       "due":{"kind":"date","date":"2026-09-30","timeZone":"Europe/London"}}'

curl -s -X POST localhost:3000/v1/families/$FAM/tasks \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -d '{"title":"Fix the shed door"}'

curl -s localhost:3000/v1/families/$FAM/tasks -H "authorization: Bearer $VIV"
```

**Expect** both tasks for Viv (a viewer can read). The car tax comes first, the undated shed door
last, and there is no total count in the body. `dueAt` for the car tax is `2026-09-30T23:00:00Z`: the
end of 30 September in London, which is BST (FR-003).

Rejections, each with its own type:

```sh
# Viv creates a task                                  → 403 task/capability_required
# "timeZone":"Europe/Londn"                           → 422 task/unknown_time_zone
# due {kind:"date_time", date, time} with no timeZone → 400 at the contract: unrepresentable
# "recurrenceRule":"FREQ=WEEKLY" with no due          → 422 task/recurrence_requires_due
```

---

## Scenario 2: A child's task is invisible, not forbidden (User Story 2, FR-013 to FR-016)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/tasks \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d "{\"title\":\"Pack PE kit\",\"assigneeIds\":[\"$CHARLIE_ID\"],
       \"due\":{\"kind\":\"date_time\",\"date\":\"2026-09-17\",\"time\":\"08:00\",\"timeZone\":\"Europe/London\"}}"
```

```sh
curl -s localhost:3000/v1/families/$FAM/tasks/$PE_ID -H "authorization: Bearer $ADA"    # 200
curl -s localhost:3000/v1/families/$FAM/tasks/$PE_ID -H "authorization: Bearer $GRACE"  # 404 task/not_found
curl -s localhost:3000/v1/families/$FAM/tasks -H "authorization: Bearer $GRACE" | jq '.items | length'
curl -s "localhost:3000/v1/families/$FAM/tasks?assignee=$CHARLIE_ID" -H "authorization: Bearer $GRACE"
```

**Expect** Grace's list length to exclude the PE kit, and her `?assignee=` query to return `200` with
an empty page. Ada's read writes one audit row, `task_assignment.read` with result `granted`, subject
Charlie. Grace's direct read writes one with result `denied`.

Then the directions that catch role-based logic:

- Grant Grace guardianship of Charlie (spec 008's route) and repeat: `200`. Revoke it: `404` on the
  very next request.
- Assign Grace as well as Charlie, then revoke her guardianship: Grace can **no longer see a task
  she is assigned to**. This is the accepted cost stated in the spec's edge cases.
- Try to complete it as Grace with a correct `expectedVersion`: `404`, not `200` and not `409`.

---

## Scenario 3: Tick it off, reopen it, call it off (User Story 3, FR-008 to FR-011)

```sh
V=$(curl -s localhost:3000/v1/families/$FAM/tasks/$PE_ID -H "authorization: Bearer $ADA" | jq .version)
curl -s -X POST localhost:3000/v1/families/$FAM/tasks/$PE_ID/complete \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" -d "{\"expectedVersion\":$V}"
```

**Expect** `status: completed`, `completedByMemberId: $ADA_ID` (the guardian, never Charlie), and
`successor: null` because the task is not recurring. Then:

- `POST …/reopen` with the new version: `open` again, completion fields cleared.
- `POST …/cancel {scope:"instance"}`: `cancelled`.
- `POST …/reopen`: `409 task/invalid_transition`, because cancelled is terminal.
- `PATCH` the title on the cancelled task: `409 task/invalid_transition`.
- `GET …/tasks/history?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z`: the task appears with
  `cancelledByMemberId`.

**The race.** On a fresh task, fire two completions at the same `expectedVersion` in parallel, as Ada
and as Alan:

```sh
for T in $ADA $ALAN; do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/v1/families/$FAM/tasks/$ID/complete \
    -H "authorization: Bearer $T" -H 'content-type: application/json' \
    -H "idempotency-key: $(uuidgen)" -d "{\"expectedVersion\":$V}" &
done; wait
```

**Expect** one `200` and one `409`, never two `200`s (SC-009).

---

## Scenario 4: Bins every Thursday, across the clock change (User Story 4, FR-017 to FR-024, SC-007)

```sh
curl -s -X POST localhost:3000/v1/families/$FAM/tasks \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"title":"Bins out","recurrenceRule":"FREQ=WEEKLY;BYDAY=TH",
       "due":{"kind":"date_time","date":"2026-10-22","time":"19:00","timeZone":"Europe/London"}}'
```

Complete it. **Expect** `successor` in the response due `2026-10-29` at local `19:00`. Its `dueAt` is
`2026-10-29T19:00:00Z`, where the first instance's was `2026-10-22T18:00:00Z`. The clocks go back on
25 October, so the instants differ by 7 days **plus one hour**. If they differ by exactly 7 days, the
successor was computed in UTC and SC-007 fails.

Then, each on its own fresh series:

| Step | Expect |
|---|---|
| Retry the completion with the **same** `Idempotency-Key` | Identical body; one successor row in the database |
| Create a head due **three Thursdays ago** and complete it now | Successor is the first Thursday after *now*; no backlog of overdue instances (FR-021). The fixed-clock integration test asserts the same thing precisely |
| `POST …/cancel {scope:"instance"}` on the head | Cancelled, and a successor exists |
| `POST …/cancel {scope:"series"}` on the head | Cancelled, `successor: null`, `isSeriesHead` still true |
| Reopen the completed first instance, complete it again | `successor: null`; still exactly one head in the series (SC-006) |
| `PATCH` only the head's `due.date` to the Friday | Complete it: the successor is the *next Thursday*, not the next Friday |
| `"recurrenceRule":"FREQ=WEEKLY;COUNT=2"`, complete twice | The second completion returns `successor: null` |
| `"recurrenceRule":"FREQ=HOURLY"` | `422 task/recurrence_unsupported`, naming the part |

Also create `FREQ=WEEKLY;BYDAY=FR` due `2026-12-18`, and complete it. The successor is due
`2026-12-25`: Christmas Day, unmoved. Holiday-aware due dates are deferred by decision.

---

## Scenario 5: Assignees carry forward, and are independent (FR-021, research.md §7)

On the bins series, `PUT …/assignees/$GRACE_ID` on the head, then complete it. **Expect** the
successor's `assigneeIds` to contain Grace. `DELETE …/assignees/$GRACE_ID` on the successor, then
read the completed predecessor. It still shows Grace, because each instance's assignees are its own.

`PUT` the same assignee twice: both `200`, one `TaskAssigned` outbox row. The successor's copied
assignment writes **no** `TaskAssigned`.

---

## Scenario 6: Overdue is noticed by the sweep (User Story 5, FR-025 to FR-028, SC-008)

Create a task due `2026-09-16` (date-only, Europe/London). Then:

```sh
docker compose exec worker node dist/sweep-retention.js --as-of 2026-09-16T22:30:00Z
```

**Expect** no `TaskOverdue`. It is 23:30 BST on the 16th, and the date has not ended there (US5 #5).

```sh
docker compose exec worker node dist/sweep-retention.js --as-of 2026-09-16T23:30:00Z
docker compose exec worker node dist/sweep-retention.js --as-of 2026-09-17T09:00:00Z
```

**Expect** exactly one `TaskOverdue` outbox row after both runs, with payload
`{ familyId, taskId, dueAt }` and nothing else. The task reads `isOverdue: true`.

Then:

- `PATCH` its due to `2026-09-20`, run the sweep `--as-of 2026-09-21T00:30:00Z`: a **second**
  `TaskOverdue`, carrying the new `dueAt` (FR-027).
- Complete a task before its due, and run the sweep after: nothing.
- Seed 50 overdue tasks, kill the sweep process after the first few (`timeout 0.5`), and re-run:
  exactly 50 `TaskOverdue` rows in total.
- The sweep's output line reports `lagSeconds` returning to 0 after a clean pass.

**`isOverdue` does not wait for the sweep.** Create a task due one minute ago, and read it
immediately without running anything: `isOverdue: true` (FR-025).

---

## Scenario 7: Cross-family non-disclosure (FR-032, SC-003)

With an account with no standing in `$FAM`, call every route in the contract table against `$FAM` and
a real task id. **Expect** `404 task/not_found` from all ten routes, with a body byte-identical to a
random UUID's. This is covered by adding the routes to spec 008's parameterised sweep.

---

## Scenario 8: Row-level security and the successor invariants are in the database

```sql
-- as family_platform_app, then as family_platform_owner, no app.family_id set
SELECT count(*) FROM task;              -- 0 both times; the owner case proves FORCE
SELECT count(*) FROM task_assignment;   -- 0 both times

-- inside a family scope, attempt by hand what the domain never does
INSERT INTO task (…, predecessor_id) VALUES (…, '<an id that already has a successor>');
-- expect: unique violation on predecessor_id                                   (FR-022)
UPDATE task SET is_series_head = true WHERE series_id = '<s>' AND NOT is_series_head;
-- expect: unique violation on the partial head index                           (FR-019)
```

---

## Scenario 9: Boundary and kernel discipline

```sh
pnpm vitest run packages/core/src/tasks/reads-family-only-through-published-ports.spec.ts
pnpm vitest run packages/kernel/src/recurrence
pnpm boundaries
```

**Expect** Tasks' imports from `core/family` to be only the two published ports and **no import from
`core/calendar`** (FR-012, SC-010). Expect `nextOccurrenceAfter` to pass its fixtures (both UK clock
changes, `COUNT` counted from the anchor, a leap-day yearly rule, a midnight-transition zone) with
every existing kernel test unchanged. Expect `dependency-cruiser` to report no forbidden edge or cycle.

---

## Scenario 10: Background work runs on its own, locally and on staging (FR-037, FR-038, SC-012, SC-013)

Locally, with nothing invoked by hand:

```sh
docker compose up -d
docker compose logs -f worker | grep worker_sweep_run
```

**Expect**, within about a minute of boot, one `succeeded` line for **each** of the seven sweeps,
including the daily `guardian-coverage`, which runs once shortly after boot rather than a day later.
Then create a task due two minutes from now and wait. **Expect** a `TaskOverdue` outbox row within
three minutes of the due moment, with no `sweep-retention.js` run (SC-012).

Then the failure paths:

| Do | Expect |
|---|---|
| Set `SWEEP_REPORT_OVERDUE_TASKS_INTERVAL_SECONDS=0` and restart | Worker refuses to boot, naming the variable |
| `docker compose pause postgres` for four minutes | `failed` lines, then `ALERT sweep_stalled sweep=report-overdue-tasks`. Unpause and the next tick succeeds with no restart |
| `docker compose stop worker` during a run | Logs show in-flight runs awaited, then a clean exit inside 30 s |
| `docker compose ps worker` | `healthy`. Freeze it (`docker compose pause worker`) and it turns `unhealthy` after about 3 minutes |

On staging, after `pulumi up` on the `vps-staging` stack
([docs/staging-environment.md](../../docs/staging-environment.md)):

```sh
ssh <vps> 'docker ps --filter name=worker --format "{{.Status}}"'   # Up … (healthy)
ssh <vps> 'docker logs --since 10m <worker> | grep worker_sweep_run'
```

**Expect** the same seven `succeeded` lines. Staging never ran the worker before this feature.

---

## What this quickstart cannot prove

- **List performance at five years of history** (SC-002). A seeded load test, not a curl.
- **Event delivery.** Outbox rows are written on time, but nothing relays them until spec 011
  ([ADR-018](../../adr/ADR-018-stage-0-event-transport.md)).
- **That Reminders can act on the six events.** Nothing subscribes. The rows are asserted to exist and
  to carry identifiers only.
- **That a title naming a person is handled well on member erasure.** Not scrubbed, by decision.
