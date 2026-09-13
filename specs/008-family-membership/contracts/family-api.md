# Contract: Family API v1 (spec 008)

**Feature**: 008-family-membership | **Date**: 2026-09-13

Defined once in `packages/contracts/src/v1/family.contract.ts` with Zod, bound with ts-rest,
consumed by the NestJS host (ADR-006, Principle IX). Path-versioned at `/v1`.

This document is the authorization surface as much as the wire surface. `ARCHITECTURE.md` §9 names
five layers; three of them are visible here, and the matrix at the end is the specification the
per-route authorization tests are written from.

---

## The two guards, and why a route's position in the table below is a design decision

Every authenticated route passes `SessionGuard` (spec 006, FR-023 — revocation checked on every
request). Routes carrying a `:familyId` additionally pass **`FamilyMembershipGuard`**, new in this
feature:

```text
SessionGuard            → UserId
FamilyMembershipGuard   → FamilyContextPort.resolve(userId, familyId)
                          null → 404, audited
                          otherwise → request.familyContext = { memberId, role, capabilities }
CapabilityGuard         → the route's declared capability ∈ familyContext.capabilities
                          absent → 403, audited
handler                 → runs inside withFamilyContext(familyId, …)
```

A route that takes a `:familyId` and is **not** in the family-scoped table below is a defect, not a
convenience. That is the whole of layer 2, and the reason the tables are split rather than merged.

---

## Routes

### Authenticated, no family context

These cannot be family-scoped: the caller either has no family yet, or is not yet a member of the
one in question.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/families` | Create a family; caller becomes its sole owner (US1, FR-001) |
| `GET` | `/v1/families` | The families the caller is a member of (FR-024) |
| `POST` | `/v1/invitations/accept` | Accept an invitation by token (US3, FR-011) |

`POST /v1/invitations/accept` is the one route that reaches a family the caller is not a member of.
It is keyed on the invitation token, not on a `:familyId` — a caller cannot name the family, only
present evidence — and it verifies that the authenticated account's email matches the invitation's
before writing anything ([research.md §8](../research.md)).

### Authenticated **and** family-scoped

Every row below returns **404** to a caller with no standing in `:familyId`, before the capability
in the third column is even consulted.

| Method | Path | Capability required |
|---|---|---|
| `GET` | `/v1/families/:familyId` | `family:read` |
| `PATCH` | `/v1/families/:familyId` | `family:manage` |
| `DELETE` | `/v1/families/:familyId` | `family:delete` |
| `GET` | `/v1/families/:familyId/members` | `members:read` |
| `POST` | `/v1/families/:familyId/members` | `members:add` |
| `GET` | `/v1/families/:familyId/members/:memberId` | `members:read` **+ guardianship if the subject is a child** |
| `PATCH` | `/v1/families/:familyId/members/:memberId/role` | `members:manage` |
| `DELETE` | `/v1/families/:familyId/members/:memberId` | `members:manage` |
| `POST` | `/v1/families/:familyId/ownership-transfer` | `members:manage` |
| `GET` | `/v1/families/:familyId/invitations` | `members:manage` |
| `POST` | `/v1/families/:familyId/invitations` | `members:manage` |
| `DELETE` | `/v1/families/:familyId/invitations/:invitationId` | `members:manage` |
| `POST` | `/v1/families/:familyId/members/:memberId/guardians` | `guardianship:manage` |
| `DELETE` | `/v1/families/:familyId/members/:memberId/guardians/:guardianMemberId` | `guardianship:manage` |

`DELETE /v1/families/:familyId` **requests** deletion. It publishes
`family.FamilyDeletionRequested.v1`, voids pending invitations (FR-025) and revokes access
immediately; it does not erase. Same shape as account deletion in spec 006, and the reason the verb
is honest about being a request is Principle XI's insistence that the two are different operations.

---

## Where the child boundary sits, exactly

This is the single most consequential line in the contract, so it is drawn explicitly rather than
left to a handler.

| Field | Who may read it |
|---|---|
| Member `id`, `kind`, `role`, `displayName` | Any member with `members:read` — a household roster; the family knows its own people's names |
| Child member `dateOfBirth`, and every field a later context attaches to a child record | **Only an active guardian of that specific child**, regardless of role (FR-007) |

`GET /v1/families/:familyId/members` therefore returns the roster with `dateOfBirth` **omitted for
every child the caller does not guard** — omitted, not nulled, so a client cannot distinguish
"withheld" from "never recorded" and the response shape carries no oracle.

`GET /v1/families/:familyId/members/:memberId` on a child the caller does not guard returns
`403 family/guardianship_required`. 403 rather than 404 here: the caller already knows the child
exists, because the roster told them, and 404 would be a lie that buys nothing. The 404 rule exists
to stop enumeration *across* families (FR-021), and it is applied unconditionally there.

**Every read of a child's personal details is audited, granted or denied** (FR-009, Principle VI) —
that means this route, not the roster, because auditing a roster load would write one row per child
per screen render and drown the signal the audit log exists to carry.

---

## Request and response shapes

Defined in the contract package; the notes here are the ones a schema cannot express.

| Shape | Note |
|---|---|
| `CreateFamilyRequest` | `name` (1–120, trimmed non-empty), optional `postcode`, `localAuthorityCode`, `composition`. FR-001 rejects a missing name with `family/name_required`, which carries the reason (US1 Scenario 3 asks for "specific, actionable") |
| `AddMemberRequest` | `kind: 'child' \| 'extended'`, `displayName`, optional `dateOfBirth`. **`kind: 'adult'` is not accepted here** — an adult joins by invitation, so the wire type makes the wrong call unrepresentable rather than rejecting it at runtime |
| `CreateInvitationRequest` | `email`, `proposedRole: 'adult' \| 'extended' \| 'viewer'`. `'owner'` is absent from the union for the same reason |
| `AcceptInvitationRequest` | `token` only. The family is not a parameter |
| `TransferOwnershipRequest` | `toMemberId`. Demotion and promotion are one transaction, never two calls |
| `FamilyContextResponse` (on `GET /v1/families`) | `familyId`, `name`, `role`, `capabilities[]`. **Capabilities, not roles, are what a client branches on** — FR-015 applies to the mobile app exactly as it applies to the server |
| Every response | Never returns a `token_hash`, and never returns another family's identifiers |

### Idempotency

`POST /v1/families`, `POST /v1/families/:familyId/members`,
`POST /v1/families/:familyId/invitations` and `POST /v1/invitations/accept` accept and honour an
`Idempotency-Key` header (Principle IX). Mobile clients retry aggressively, and a duplicated child
record or a family created twice is a visible defect that a user cannot clean up themselves.

`POST /v1/invitations/accept` is additionally idempotent by construction: the token is single-use,
and a second presentation of an accepted token returns the same membership rather than an error.

---

## Error types

| `type` | HTTP | When | Disclosure note |
|---|---|---|---|
| `family/not_found` | 404 | The family, member, invitation or guardianship does not exist **or** the caller has no standing in it | Deliberately indistinguishable — FR-021, SC-004 |
| `family/name_required` | 422 | Family created without a usable name | Carries the reason — US1 Scenario 3 |
| `family/capability_required` | 403 | The caller is a member but lacks the route's capability | Names the capability, not the caller's role — FR-015 |
| `family/guardianship_required` | 403 | A child's personal details requested by a non-guardian | FR-007. Audited as a denial |
| `family/guardian_ineligible` | 422 | Guardianship offered to an `extended` or `viewer` member | FR-006 |
| `family/last_guardian` | 409 | The action would leave a child with zero guardians | FR-008, SC-006 |
| `family/owner_required` | 409 | The sole owner tried to leave, be removed, or be demoted without a transfer | FR-018, SC-007 |
| `family/owner_ineligible` | 422 | Ownership transfer to a member who is not a linked adult | US4 Scenario 2 |
| `family/already_member` | 409 | An invitation to an email already belonging to a member of this family | FR-013 |
| `family/invitation_invalid` | 422 | The token is unknown, expired, revoked, or its family is pending deletion | One type for all four, on purpose |
| `family/invitation_email_mismatch` | 403 | A valid token presented by an account with a different email | Says the email does not match, never *which* email was invited |

**Why `family/invitation_invalid` collapses four cases.** The caller holding the token learns only
that it does not work. Distinguishing "revoked" from "expired" tells a forwarded-email recipient
that the invitation was real and recently live, which is useful to precisely one kind of reader.
The audit log records which it was — the same argument spec 006 makes for `identity/session_invalid`.

---

## Authorization matrix

The constitution requires dedicated authorization tests per route. This is that list; a route
missing from it is a route without a test.

### The universal assertion

**For every route accepting a `:familyId`**, a member of a *different* family receives
`404 family/not_found` — never 403, never a body that differs from a genuinely missing family, and
never a different response time in a way a test can measure. This is one parameterised test over
the whole route table, not fourteen hand-written ones, so a route added later without a test fails
by being absent from the table.

### Per-route

| Route | Rule | Test that must exist |
|---|---|---|
| `POST /v1/families` | Creator becomes sole owner | The created family has exactly one owner, and it is the caller |
| `GET /v1/families` | Lists only the caller's own memberships | A user in families A and B does not see C |
| `GET /:familyId/members/:memberId` (child) | Guardianship, not role | An **owner** who is not a guardian is denied; a **viewer** who is a guardian is allowed. Both directions, because either alone would pass with role-based logic |
| `GET /:familyId/members` | Roster withholds unguarded children's `dateOfBirth` | An adult non-guardian's response omits the field |
| `POST /:familyId/members` | `members:add` | An `extended` member is denied; an `adult` succeeds |
| `PATCH /:familyId/members/:memberId/role` | `members:manage` | An `adult` is denied; the owner succeeds |
| `PATCH …/role` on the sole owner | FR-018 | Demoting the sole owner returns `family/owner_required` |
| `DELETE /:familyId/members/:memberId` | `members:manage` + FR-008 | Removing a child's only guardian returns `family/last_guardian` |
| `POST /:familyId/ownership-transfer` | Owner only, atomic | After transfer exactly one owner exists; the previous owner is `adult`; a non-owner caller is denied |
| `POST /:familyId/invitations` | `members:manage` + FR-013 | An `adult` is denied; inviting an existing member's email returns `family/already_member` |
| `DELETE /:familyId/invitations/:id` | `members:manage` | Revoking then accepting returns `family/invitation_invalid` |
| `POST …/members/:memberId/guardians` | `guardianship:manage` + FR-006 | Granting to an `extended` member returns `family/guardian_ineligible` |
| `DELETE …/guardians/:guardianMemberId` | FR-008 | Ending the last guardianship returns `family/last_guardian` |
| `POST /v1/invitations/accept` | Email must match | A valid token presented by a different account returns `family/invitation_email_mismatch` and creates nothing |

### The assertion that is not about a route

**Row-level security is real.** An integration test opens a transaction *without*
`withFamilyContext`, queries each family-scoped table directly, and asserts it sees zero rows —
then repeats connected as the owner role and asserts `FORCE ROW LEVEL SECURITY` still filters it.
Without this test, [research.md §1](../research.md)'s failure mode is invisible: the policy exists,
the CI check passes, and every row is readable.

---

## Rate limiting

Per route and per user, stricter where the endpoint reaches outward or creates durable state
(Principle IX, and the constitution's stricter-limits-on-authentication rule by analogy).

| Route | Limit | Why |
|---|---|---|
| `POST /v1/families/:familyId/invitations` | 10 per family per hour | It sends email to an address the caller chose. This is the outbound-abuse surface of the whole feature |
| `POST /v1/invitations/accept` | 10 per user per hour | Token guessing, though the token space already makes it futile |
| `POST /v1/families` | 5 per user per day | Nothing legitimate creates families in bulk |
| Everything else | The default per-user route limit | |

---

## Observability

Correlation id on every request, carried into the outbox row and the audit entry so one identifier
joins the HTTP span, the event and the compliance record ([data-model.md](../data-model.md)).

| Signal | Why |
|---|---|
| `family_context_resolve_duration` | The 5 ms budget on the guard that runs before every family-scoped request ([research.md §12](../research.md)) |
| `family_authorization_denied_total{reason}` | Split by `not_a_member`, `capability`, `guardianship`. A spike in the first is an enumeration attempt |
| `family_rls_empty_result_total` | ARCHITECTURE §9: an unexpected empty result under RLS "should be unreachable" and is therefore an alert, not a metric to browse |
| `family_child_record_read_total{result}` | The volume Principle VI's audit obligation is producing, so that a gap is noticed |
| `family_children_without_guardian` | The SC-006 sweep's gauge. Any value above zero is an alert ([research.md §6](../research.md)) |

**No personal data in any of it** — Principle VI. Identifiers and enum labels only, in logs, metric
labels, spans and outbox payloads alike.
