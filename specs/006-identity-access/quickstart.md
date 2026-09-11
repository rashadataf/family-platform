# Quickstart: Identity and Access (spec 006)

Phase 1 output. Runnable scenarios that prove this feature works end to end. Each maps to a user
story or to a requirement whose failure would be invisible without deliberately checking for it.

Route and error-type details are in [contracts/identity-api.md](contracts/identity-api.md); field
definitions are in [data-model.md](data-model.md). They are not repeated here.

## Prerequisites

Docker, and nothing else — [ADR-014](../../adr/ADR-014-containerized-development.md) makes the
container image the unit of truth.

```sh
cp .env.example .env
docker compose up
```

That starts PostgreSQL, applies migrations, runs the API on <http://localhost:3000>, and starts
**Mailpit** — the Stage 0 mail sink from [research.md §4](research.md). Its inbox is at
<http://localhost:8025>; no mail leaves the machine.

```sh
curl -s localhost:3000/health/ready    # {"status":"ok"} before starting
```

---

## Scenario 1 — Register, verify, authenticate (User Stories 1 and 2)

```sh
curl -s -X POST localhost:3000/v1/identity/registrations \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct horse battery staple"}'
```

**Expect** `201`. Open <http://localhost:8025> — a verification message is waiting. Take the token
from its link.

```sh
curl -s -X POST localhost:3000/v1/identity/verifications \
  -H 'content-type: application/json' -d '{"token":"<token>"}'

curl -s -X POST localhost:3000/v1/identity/sessions \
  -H 'content-type: application/json' \
  -d '{"email":"ADA@example.com","password":"correct horse battery staple"}'
```

**Expect** a session credential. Note the email was sent in different case — it must resolve to the
same account (FR-022). Authenticating *before* verifying must fail with `identity/not_verified`
(FR-003); check that too, by re-running this scenario and skipping the verification step.

---

## Scenario 2 — Verification is resendable and the old link dies (FR-003a)

Register a second account, then request a replacement before using the first link:

```sh
curl -s -X POST localhost:3000/v1/identity/verifications/resend \
  -H 'content-type: application/json' -d '{"email":"grace@example.com"}'
```

**Expect** two messages in Mailpit. The **newer** link verifies successfully; the **older** one now
returns `identity/verification_invalid`. A resend that silently left both links working would pass
a naive test and violate FR-003a.

---

## Scenario 3 — Rotation, then replay detection (User Story 3, FR-010 and FR-011)

```sh
curl -s -X POST localhost:3000/v1/identity/sessions/current/renewal \
  -H 'authorization: Bearer <token>'
```

**Expect** a new credential. Now present the **old** one:

```sh
curl -s localhost:3000/v1/identity/sessions -H 'authorization: Bearer <old-token>'
```

**Expect** `identity/session_invalid` — and critically, the **new** credential must now be dead
too. FR-011 requires a superseded credential to be treated as a compromise, so the whole session
lineage is revoked, not just the replayed token. Confirm `revoked_reason = replay_detected` in the
database and that an alert fired.

A system that merely rejected the old token while leaving the session alive would pass a careless
reading of FR-011 and leave a thief holding a working session.

---

## Scenario 4 — Log out one device, others survive (User Story 3, FR-012)

Authenticate twice to create two sessions, list them, revoke one:

```sh
curl -s localhost:3000/v1/identity/sessions -H 'authorization: Bearer <token-a>'
curl -s -X DELETE localhost:3000/v1/identity/sessions/<session-b-id> \
  -H 'authorization: Bearer <token-a>'
```

**Expect** session B dead on its very next use, session A still working. Then rotate A several
times and revoke it by the **same id first listed** — it must still die, because the id is stable
across rotation (spec.md clarification 2). An implementation that created a new id per rotation
would fail exactly here, and nowhere else.

---

## Scenario 5 — Deletion revokes instantly (User Story 4, FR-015, FR-023, SC-007)

This is the scenario that justifies self-hosting at all — see [research.md §1](research.md).

```sh
curl -s -X DELETE localhost:3000/v1/identity/account -H 'authorization: Bearer <token>'
curl -s localhost:3000/v1/identity/sessions -H 'authorization: Bearer <token>'
```

**Expect** the second call to fail on its **very next use** — no grace window, no waiting out a
token lifetime. Re-registering with the same email must now return `identity/email_unavailable`
until erasure completes (FR-002, spec.md clarification 4).

Time the two calls back to back. If a revoked credential ever succeeds, SC-007 has failed.

---

## Scenario 6 — Non-disclosure (FR-002, FR-007, SC-003)

Compare responses for an unknown email against a known email with the wrong password:

```sh
curl -si -X POST localhost:3000/v1/identity/sessions \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com","password":"whatever"}'

curl -si -X POST localhost:3000/v1/identity/sessions \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"wrong"}'
```

**Expect** identical status, identical `type`, identical body. Response *timing* should also not
separate them — an implementation that skips the argon2id verify for an unknown email leaks
account existence through a timing side channel while looking correct in every functional test.

---

## Scenario 7 — Retention sweeps (FR-019, FR-020)

The sweeps run in `apps/worker`. Rather than waiting 30 days, run them against a clock moved
forward — the domain takes `Clock` as an injected port precisely so this is testable:

```sh
docker compose run --rm worker pnpm --filter @fp/worker run sweep:retention -- \
  --as-of "$(date -u -v+31d +%Y-%m-%dT%H:%M:%SZ)"
```

(`--filter @fp/worker` is required — the container's working directory is the workspace root, and
plain `pnpm sweep:retention` only resolves a script defined at the root, not one scoped to a single
package. Every other cross-package invocation in this codebase is written the same fully-qualified
way, e.g. `apps/api/Dockerfile`'s own `pnpm --filter @fp/api run dev`.)

**Expect** the unverified registration from Scenario 2 gone, the deleted account from Scenario 5
gone, and the `outbox_event` rows for both **still present** — they carry identifiers only and must
survive the erasure of the account they reference ([data-model.md](data-model.md)).

Re-run the sweep. It must be a no-op, not an error.

---

## What this quickstart cannot prove

The `UserRegistered`, `UserAuthenticated` and `UserDeletionRequested` events are written to
`outbox_event` and verifiable there, but nothing consumes them yet — no relay and no subscriber
exist at this stage ([research.md §5](research.md)). "The event reached another context" becomes
testable with the first consumer, which is spec 007's work, not this one's.
