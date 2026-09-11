# Contract: Identity API v1 (spec 006)

Phase 1 output. Defines the wire surface as it will be expressed in `packages/contracts` — Zod
schemas composed into a ts-rest contract, per
[ADR-006](../../../adr/ADR-006-api-style-and-type-safety.md) and Principle IX. This document is the
design; the contract package is the executable source of truth once written.

Path-versioned at `/v1`. The contract package imports nothing from `domain/` or `application/` —
the wire language and the domain language are allowed to differ, and the domain must not reach the
wire by accident.

---

## Credential transport

A session's credential travels as `Authorization: Bearer <token>`, not a cookie.

The first client is an Expo mobile app, which has no cookie jar worth relying on and no
browser-origin CSRF surface to defend. A bearer header avoids cookie domain and `SameSite`
questions entirely. The token is the opaque 256-bit value from
[research.md §3](../research.md) — clients must treat it as meaningless bytes and must not attempt
to parse it.

**One token, not an access/refresh pair.** FR-023 forces a session-store read on every
authenticated request regardless, so the usual reason for a short-lived access token — avoiding
that read — does not apply here. A single credential that is explicitly rotated is simpler, and
rotation still bounds how long a leaked token stays useful and still enables replay detection.

---

## Routes

### Unauthenticated

| Method | Path | Purpose | Requirement |
|---|---|---|---|
| `POST` | `/v1/identity/registrations` | Create an account | FR-001, FR-002, FR-004 |
| `POST` | `/v1/identity/verifications` | Consume a verification token | FR-003 |
| `POST` | `/v1/identity/verifications/resend` | Issue a replacement verification link | FR-003a |
| `POST` | `/v1/identity/sessions` | Authenticate and issue a session | FR-006, FR-007, FR-008 |
| `POST` | `/v1/identity/sessions/current/renewal` | Rotate the presented credential | FR-010, FR-011, FR-013 |

`renewal` is listed here because it authenticates with the session credential itself rather than
passing the standard guard — a session at its absolute expiry must be rejected by *this route's*
own rule (FR-013), not silently accepted by a guard that only checks revocation.

### Authenticated — requires a valid session

| Method | Path | Purpose | Requirement |
|---|---|---|---|
| `GET` | `/v1/identity/sessions` | List the caller's own sessions | supports FR-012 |
| `DELETE` | `/v1/identity/sessions/{sessionId}` | Revoke one session by its stable id | FR-012 |
| `DELETE` | `/v1/identity/account` | Request deletion of the caller's own account | FR-014, FR-015 |
| `GET` | `/v1/identity/account/export` | Export the caller's personal data | FR-021 |

---

## Request and response shapes

Every shape is a Zod schema in `packages/contracts`, defined once. Notable rules:

- **`email`** is parsed, trimmed and lowercased at the boundary, so FR-022's case-insensitivity is
  a property of the contract rather than a thing each handler remembers.
- **`password`** has a minimum-strength refinement (FR-004) that returns a *specific* reason.
  This is the one deliberate asymmetry with the login route below: at registration, telling
  someone their password is too short is helpful and discloses nothing; at login, telling them
  anything specific is a disclosure.
- **`GET /v1/identity/sessions`** returns, per session: `sessionId`, device label, `issuedAt`,
  `rotatedAt`, `absoluteExpiresAt`, and whether it is the session making the request. It never
  returns a token hash or any credential material.

### Idempotency

`POST /v1/identity/registrations` and `DELETE /v1/identity/account` accept an `Idempotency-Key`
header and honour it, per Principle IX — mobile clients retry aggressively, and a double-submitted
registration or a deletion request racing itself must not produce a second outcome.

`POST /v1/identity/sessions/current/renewal` does **not** take an idempotency key: a retried
renewal presenting an already-rotated credential is exactly the replay signal FR-011 exists to
catch, and an idempotency key would mask it. Clients retry by re-authenticating.

---

## Error types

Machine-readable problem format with stable `type` values, so client code can handle them
exhaustively (Principle IX).

| `type` | HTTP | When | Disclosure note |
|---|---|---|---|
| `identity/invalid_credentials` | 401 | Wrong email **or** wrong password | Deliberately indistinguishable — FR-007, SC-003 |
| `identity/email_unavailable` | 409 | Registration against an email already taken, in any status including pending erasure | Does not say *which* status — FR-002 |
| `identity/weak_password` | 422 | Registration password below the strength rule | Carries the specific reason — FR-004 |
| `identity/not_verified` | 403 | Authentication attempted before verification | FR-003 |
| `identity/throttled` | 429 | Failed-attempt threshold exceeded | Returned even when the password would have been correct — FR-008 |
| `identity/session_invalid` | 401 | Credential unknown, revoked, expired, superseded, or owned by a deleted account | One type for all of these, on purpose — see below |
| `identity/verification_invalid` | 422 | Verification token unknown, expired, consumed or superseded | Does not distinguish which |
| `identity/rate_limited` | 429 | Per-route limit exceeded | Distinct from `identity/throttled`, which is per-account |

**Why replay returns `identity/session_invalid` rather than its own type.** FR-011 requires a
superseded credential to be treated as a possible compromise, and the system does treat it as one
— it revokes the entire session lineage and records `revoked_reason = replay_detected`. But it
does not *tell the caller* that is what happened. Whoever presented that token is either the
legitimate client or an attacker, and the system cannot tell which from inside the request;
confirming "that token was real and recently valid" is useful to exactly one of them. The incident
is visible in the audit trail and metrics, which is where it belongs.

---

## Authorization matrix

The constitution requires dedicated authorization tests per route. Identity has no family to
authorize against, so the obligation takes its Identity-appropriate form: **a caller may only ever
act on their own resources.**

| Route | Rule | Test that must exist |
|---|---|---|
| `GET /v1/identity/sessions` | Returns only sessions whose `user_id` is the caller's | A user with sessions sees none belonging to another user |
| `DELETE /v1/identity/sessions/{sessionId}` | Revokes only if the session belongs to the caller | Revoking another user's session id returns **404, not 403** |
| `DELETE /v1/identity/account` | Acts only on the caller's own account | No route exists to delete another account |
| `GET /v1/identity/account/export` | Exports only the caller's own data | Export contains no other user's data |

**404, not 403, for another user's session id** — this mirrors Principle V's rule that a
cross-tenant access attempt returns not-found so resource existence is not disclosed. The audit log
records the real reason. The principle is written about families, but the reasoning is identical
here and applying it costs nothing.

---

## Rate limiting

Principle IX requires per-route and per-user limits, stricter on authentication.

| Route | Limit basis | Relative strictness |
|---|---|---|
| `POST /v1/identity/sessions` | Per source and per account | Strictest. Layered *on top of* FR-008's per-account throttling, which is a different control: throttling protects one account from a focused attack, rate limiting protects the endpoint from a broad one |
| `POST /v1/identity/registrations` | Per source | Strict — limits automated account creation |
| `POST /v1/identity/verifications/resend` | Per account | Strict — FR-003a allows unlimited resends by design, so the rate limit is what stops it becoming a mail-flooding vector against a third party's inbox |
| `POST /v1/identity/sessions/current/renewal` | Per session | Moderate |
| Authenticated reads | Per user | Standard |

---

## Observability

Per the constitution's "observability is part of the feature, not a follow-up":

- Every authentication outcome logs `UserId`, correlation id and result — **never** the email
  address or any credential (Principle VI forbids personal data in log messages; identifiers only).
- Metrics: authentication success and failure rates, throttle activations, replay detections,
  verification resend counts, and outbox row age.
- Replay detection raises an alert rather than only incrementing a counter. It is the one signal
  here that indicates a credential is loose in the world.
