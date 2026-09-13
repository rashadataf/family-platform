# Quickstart: Family and Membership (spec 008)

Phase 1 output. Runnable scenarios that prove this feature works end to end. Each maps to a user
story, or to a requirement whose failure would be invisible without deliberately checking for it —
which, in a feature whose entire subject is who may see what, is most of them.

Route and error-type details are in [contracts/family-api.md](contracts/family-api.md); field
definitions are in [data-model.md](data-model.md). They are not repeated here.

## Prerequisites

Docker, and nothing else ([ADR-014](../../adr/ADR-014-containerized-development.md)).

```sh
cp .env.example .env
docker compose up
```

That starts PostgreSQL, applies migrations, runs the API on <http://localhost:3000>, and starts
Mailpit at <http://localhost:8025>, where invitation emails land. No mail leaves the machine.

```sh
curl -s localhost:3000/health/ready    # {"status":"ok"} before starting
```

Every scenario below needs authenticated accounts. Register and verify them with
[spec 006's quickstart](../006-identity-access/quickstart.md#scenario-1--register-verify-authenticate-user-stories-1-and-2)
— `ada@example.com`, `grace@example.com` and `alan@example.com` are used throughout. Export their
session credentials as `$ADA`, `$GRACE` and `$ALAN`.

---

## Scenario 1 — Create a family and become its owner (User Story 1, FR-001)

```sh
curl -s -X POST localhost:3000/v1/families \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -d '{"name":"Lovelace","postcode":"SW1A 1AA","localAuthorityCode":"E09000033"}'
```

**Expect** `201` with a `familyId`. Then:

```sh
curl -s localhost:3000/v1/families -H "authorization: Bearer $ADA"
```

**Expect** one family, `"role":"owner"`, and a `capabilities` array containing `billing:manage` and
`family:delete`. The client is given capabilities, not a role to branch on (FR-015).

Creating without a name must return `422 family/name_required` (US1 Scenario 3).

---

## Scenario 2 — Add a child, and watch a non-guardian bounce off it (User Story 2, FR-003 to FR-009)

```sh
curl -s -X POST localhost:3000/v1/families/$FAMILY/members \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -d '{"kind":"child","displayName":"Bo","dateOfBirth":"2019-04-02"}'
```

**Expect** `201`. The response carries no user id, and no verification email is sent — a child has
no login path at all (FR-003). Ada is now Bo's guardian, established in the same action (FR-005).

Now invite Grace as an `adult` (Scenario 3 below), accept, and then, as Grace:

```sh
curl -s -i localhost:3000/v1/families/$FAMILY/members/$BO -H "authorization: Bearer $GRACE"
```

**Expect** `403 family/guardianship_required`. Grace is an adult member of the family and it makes
no difference (FR-007). Repeat as Ada and expect `200` with `dateOfBirth` present.

```sh
curl -s localhost:3000/v1/families/$FAMILY/members -H "authorization: Bearer $GRACE"
```

**Expect** Bo in the roster — with **no `dateOfBirth` key at all**, not a null one. Omitted so the
shape carries no oracle ([contracts/family-api.md](contracts/family-api.md)).

Then grant Grace guardianship as Ada and repeat the detail read: it now succeeds (US2 Scenario 3).

**Check the audit trail**, which is the requirement most likely to be quietly missing:

```sh
docker compose exec postgres psql -U postgres -d family_platform \
  -c "select action, result, reason from audit_log where subject_id = '$BO' order by occurred_at"
```

**Expect** both the denial and both grants, each with an actor, a purpose and a result (FR-009,
Principle VI). A missing denial row is a failure even though the API behaved correctly.

---

## Scenario 3 — Invite an adult, before and after they have an account (User Story 3)

```sh
curl -s -X POST localhost:3000/v1/families/$FAMILY/invitations \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -d '{"email":"GRACE@example.com","proposedRole":"adult"}'
```

Take the token from <http://localhost:8025>.

```sh
curl -s -X POST localhost:3000/v1/invitations/accept \
  -H "authorization: Bearer $GRACE" -H 'content-type: application/json' \
  -d '{"token":"<token>"}'
```

**Expect** `201`. Note the invitation was addressed in a different case from Grace's registered
address and still matched (spec.md Edge Cases).

Four negatives, each of which has been a real bug in a real system:

| Do this | Expect |
|---|---|
| Accept the same token again | The same membership, not a second member and not an error — the token is single-use and the route is idempotent |
| Present Grace's token as `$ALAN` | `403 family/invitation_email_mismatch`, and **no member created** |
| Invite `grace@example.com` again | `409 family/already_member` (FR-013) |
| Revoke a fresh invitation, then accept it | `422 family/invitation_invalid` |

For the no-account-yet path (US3 Scenario 3): invite `alan@example.com` *before* registering that
account, then register and verify it through spec 006, then accept. The outcome must be identical.

---

## Scenario 4 — Extended member, and the ownership floor (User Story 4)

```sh
curl -s -X POST localhost:3000/v1/families/$FAMILY/members \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' \
  -d '{"kind":"extended","displayName":"Nan"}'
```

**Expect** `201`, no login path, and the `extended` capability set — which contains
`documents:write` but **not** `documents:write:sensitive` ([data-model.md](data-model.md)).

Attempting to make that unlinked member the owner must return `422 family/owner_ineligible`
(US4 Scenario 2). Attempting to grant them guardianship of Bo must return
`422 family/guardian_ineligible` (FR-006).

---

## Scenario 5 — Roles, transfer, and the two things that must never happen (User Story 5)

```sh
curl -s -X PATCH localhost:3000/v1/families/$FAMILY/members/$GRACE_MEMBER/role \
  -H "authorization: Bearer $ADA" -H 'content-type: application/json' -d '{"role":"viewer"}'

curl -s localhost:3000/v1/families -H "authorization: Bearer $GRACE"
```

**Expect** Grace's capability array to have lost `documents:write:sensitive` on the very next
request — no cache, no delay (FR-016, SC-005).

| Do this | Expect | Requirement |
|---|---|---|
| Ada (sole owner) removes herself | `409 family/owner_required` | FR-018 |
| Ada demotes herself to `adult` | `409 family/owner_required` | FR-018 |
| Ada removes Bo's only guardian | `409 family/last_guardian` | FR-008 |
| Ada transfers ownership to Grace | `200`; Ada is now `adult`, Grace is `owner`, and Bo's guardianship is untouched | FR-018, spec.md Edge Cases |

After the transfer, assert in SQL that exactly one owner exists — the partial unique index is what
makes SC-007 a database guarantee rather than an application hope
([research.md §6](research.md)):

```sh
docker compose exec postgres psql -U postgres -d family_platform \
  -c "select role, count(*) from family_member where family_id = '$FAMILY' group by role"
```

---

## Scenario 6 — Cross-family non-disclosure (FR-021, SC-004)

Create a second family as Alan, then, as Ada, walk the entire route table against it:

```sh
for path in "" "/members" "/members/$ALAN_MEMBER" "/invitations"; do
  curl -s -o /dev/null -w "%{http_code} $path\n" \
    "localhost:3000/v1/families/$ALANS_FAMILY$path" -H "authorization: Bearer $ADA"
done
```

**Expect `404` on every line.** Not one `403`, and not one response body that differs from a
genuinely nonexistent family id. A `403` anywhere here is an enumeration oracle and a failure of
Principle V, not a cosmetic difference.

The corresponding denials must appear in `audit_log` with `result = 'denied'` and the *real* reason
— the log records what the caller was not told.

---

## Scenario 7 — Row-level security is actually on (research.md §1)

The scenario that catches the failure the other six cannot see. Query a family-scoped table
directly, with no `app.family_id` set:

```sh
docker compose exec postgres psql -U family_platform_app -d family_platform \
  -c "select count(*) from family_member"
```

**Expect `0`**, with rows plainly present in the table. Then set the context and repeat:

```sh
docker compose exec postgres psql -U family_platform_app -d family_platform \
  -c "begin; select set_config('app.family_id','$FAMILY',true); select count(*) from family_member; commit;"
```

**Expect** only that family's members. Finally, as the owner role:

```sh
docker compose exec postgres psql -U postgres -d family_platform \
  -c "select count(*) from family_member"
```

**Expect `0` as well** — that is `FORCE ROW LEVEL SECURITY` doing its job. If this returns every
row, the policy is decorative and the platform's fifth isolation layer does not exist, however
green CI is.

---

## Scenario 8 — Family deletion is a request (FR-025, Principle XI)

Send a pending invitation, then:

```sh
curl -s -X DELETE localhost:3000/v1/families/$FAMILY -H "authorization: Bearer $GRACE"
```

**Expect** `202`. Then: accepting the pending invitation returns `422 family/invitation_invalid`
(FR-025); every family-scoped route returns `404` for every member (access revoked immediately);
and a `family.FamilyDeletionRequested.v1` row exists in `outbox_event`. The rows themselves are
still present — erasure is the saga's job, on its own grace period, and conflating the two is what
Principle XI forbids.

---

## What this quickstart cannot prove

- **That the erasure saga completes.** This feature implements `eraseForFamily` and
  `eraseForMember` and tests them directly; the orchestration that calls them belongs to Audit and
  Compliance and does not exist ([research.md §11](research.md)).
- **That events reach a consumer.** There is no relay and no subscriber
  ([research.md §10](research.md)). What is provable is that the outbox row is written in the same
  transaction as its state change, which is what the integration tests assert.
- **Concurrency.** Two simultaneous ownership promotions, or two simultaneous invitations to the
  same address, are caught by partial unique indexes that a sequential `curl` walk cannot exercise.
  Those live in the integration suite, which runs both halves against a real database.
- **The SC-006 guarantee over time.** A quickstart shows the domain refusing to strand a child at
  the moment of the attempt. That zero children are *ever* left without a guardian is the worker
  sweep's gauge, not a scenario.
