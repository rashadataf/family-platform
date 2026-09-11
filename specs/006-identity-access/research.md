# Research: Identity and Access (spec 006)

Phase 0 output. Every decision below is resolved — no `NEEDS CLARIFICATION` remains. Decisions
that the constitution requires an ADR for are marked **ADR REQUIRED** and are listed again in
[plan.md](plan.md)'s Constitution Check as gating items that MUST merge before implementation.

---

## 1. Self-hosted identity, behind a replaceable port — **ADR REQUIRED (ADR-007)**

**Decision.** Own credential storage and session handling. `User`, `Session` and `Device` are
aggregates in `packages/core/identity`, persisted through repository ports implemented in
`packages/persistence`. Password hashing, token generation and mail delivery are ports implemented
in `packages/platform`. No managed identity provider is adopted at this stage.

**Rationale — the deciding constraint is FR-023, not cost.** Free managed tiers are real and
generous as of September 2026: [Clerk raised its free allotment to 50,000 monthly retained
users](https://clerk.com/articles/clerk-pricing-explained) in February 2026, [Auth0 offers 25,000
MAU](https://zuplo.com/learning-center/api-authentication-pricing), and [Cognito offers 10,000
MAU](https://tesseral.com/guides/a-simple-guide-to-aws-cognito-pricing) since its December 2024
restructure. Cost alone would favour adopting one.

The blocker is architectural. Clerk — the most generous of the three — issues **60-second JWTs
verified networklessly**, and [its own documentation is explicit about the
trade-off](https://clerk.com/docs/guides/how-clerk-works/overview): once issued, a JWT stays valid
until it expires, so revocation waits out the token. That is a bounded delay of up to 60 seconds,
which is precisely the option rejected during clarification. spec.md's FR-023 and SC-007 require a
revoked session or deleted account to be rejected **on its very next use**.

Preserving FR-023 on top of a managed provider means calling the provider's session API on every
authenticated request. That places a third party on the hottest path in the system, and at
[ADR-013](../../adr/ADR-013-staged-hosting-model.md)'s Stage 0 — a single VPS shared with an
unrelated site — their outage becomes our outage for every authenticated request. Self-hosting
satisfies FR-023 with a single indexed read that is already in the request path, because a session
lookup has to happen anyway.

Three supporting arguments, none of them sufficient alone:

- **Stage 0 exists to minimise commitments.** ADR-013 rejected a PaaS for Stage 0 on the reasoning
  that it "adds a new, unevaluated vendor… for a stage whose entire point is minimising new
  commitments." A managed identity provider is the same shape of commitment.
- **A vendor receiving personal data needs a privacy review**, per the constitution's Additional
  Engineering Constraints. That is real work, and at Stage 0 it buys nothing, because Stage 0 holds
  synthetic data only.
- **Free tiers move.** Cognito's own free tier went from 50,000 MAU to 10,000 in December 2024. A
  free tier is a pricing decision a vendor can revise, not a property of the architecture.

**What this costs us, stated honestly.** We own password hashing, throttling, rotation and replay
detection correctness. Password reset (already out of scope per spec.md) and MFA (already deferred)
must be built rather than inherited. This is accepted because the scope here is deliberately narrow
— no MFA, no social login, no SSO — and because the port boundary keeps the exit cheap.

**Keeping it replaceable is a requirement, not a nicety.**
[`ARCHITECTURE.md` §5.1](../../ARCHITECTURE.md) states that Identity is "the strongest candidate
for a managed provider" and that a `User` therefore holds no reference to a `Family`. The port
boundary below is what makes that claim true in code rather than in prose.

**Trigger to revisit** (recorded in ADR-007, mirroring ADR-013's trigger style): adopt a managed
provider when any one of the following becomes true — MFA is required; social or SSO login is
required; or Stage 1 arrives and the compliance burden of owning credentials outweighs the
integration cost. Migration is then an adapter swap plus a password-hash import, not a rewrite.

**Alternatives considered.**

| Option | Free tier | Rejected because |
|---|---|---|
| Clerk | 50,000 MRU | 60-second JWT revocation window contradicts FR-023; preserving FR-023 needs a per-request API call |
| Auth0 | 25,000 MAU | Same revocation model; steeper paid cliff; Okta-owned pricing history |
| Amazon Cognito | 10,000 MAU | Same revocation model; introduces AWS before ADR-013's Stage 1 trigger |
| Self-hosted, no port boundary | n/a | Contradicts ARCHITECTURE.md §5.1's explicit replaceability requirement; later migration becomes a rewrite |

---

## 2. Password hashing: argon2id via `@node-rs/argon2`

**Decision.** argon2id, through `@node-rs/argon2`, with parameters tuned so a verify stays inside
the request budget in §8 below.

**Rationale.** argon2id is OWASP's first recommendation for new password storage, and it is
memory-hard in a way PBKDF2 is not. `@node-rs/argon2` ships prebuilt native binaries rather than
requiring `node-gyp` at install time, which matters because
[ADR-014](../../adr/ADR-014-containerized-development.md) makes the container image the unit of
truth — a toolchain-dependent build step is a per-environment failure mode.

**Alternatives considered.** Node's built-in `crypto.scrypt` is genuinely viable and adds zero
dependencies, which the constitution's "new external dependencies are decisions" rule favours; it
is the fallback if `@node-rs/argon2` becomes unmaintained, and it is memory-hard. It is second
choice only because argon2id is the current consensus recommendation. `bcrypt` is rejected: it
silently truncates input beyond 72 bytes and is the weakest of the three against GPU attack.

---

## 3. Session credential: opaque random token, stored hashed, with a stable session identity

**Decision.** A session's credential is a 256-bit cryptographically random opaque token, not a JWT.
Only a SHA-256 hash of it is stored. A `Session` row carries a stable `SessionId` that survives
rotation; rotation replaces the credential while the `SessionId` and its `Device` association stay
put.

**Rationale.** FR-023 requires a revocation check on every use, which means a storage read on every
authenticated request regardless. Once that read is unavoidable, a self-contained token buys
nothing and costs the revocation guarantee — the exact trade that ruled out the managed providers
in §1. An opaque token is also shorter, carries no claims to leak, and cannot be parsed by a
client that should not be reading it.

Hashing the stored token means a database disclosure does not hand over usable sessions. SHA-256
without a work factor is correct here, unlike for passwords: the token is 256 bits of uniform
randomness, so there is no dictionary to attack and a slow KDF would only add latency to every
request.

The stable `SessionId` implements spec.md's second clarification directly: "log out this device"
revokes one `SessionId`, and every past and future rotated credential under it dies with it.

**Replay detection.** Presenting a superseded credential revokes the whole session lineage rather
than merely rejecting the request, per FR-011's "treat as possible compromise" — a superseded
token in the wild means either the legitimate client or an attacker holds a copy, and there is no
way to tell which from inside the request.

---

## 4. Email delivery at Stage 0: a local sink, no vendor

**Decision.** Define a `MailerPort` in the application layer. Implement it for Stage 0 with a
[Mailpit](https://github.com/axllent/mailpit) container in the Compose service set — used for both
`local` and the `vps-staging` environment. No third-party mail vendor is adopted. Vendor selection
is deferred to Stage 1 with its own ADR.

**Rationale.** A transactional mail vendor is an external service that receives personal data (an
email address), which the constitution requires an ADR and a privacy review for. At Stage 0 that
would buy nothing: [ADR-013](../../adr/ADR-013-staged-hosting-model.md) authorises synthetic data
only, so there is no real recipient to deliver to. Mailpit gives a browsable inbox, which makes
FR-003a's resend-and-expire flow fully exercisable end to end — including in the staging
environment the founder dogfoods against — with no vendor commitment and no credential to manage.

**Trigger.** The first real user is the same trigger as ADR-013's Stage 1, because a verification
email that must actually arrive is exactly what "real personal data" means here.

---

## 5. Event publishing: outbox rows now, SQS relay deferred

**Decision.** FR-017's three events are written to an `outbox_event` row in the same transaction as
the state change that produced them, per
[ADR-005](../../adr/ADR-005-event-system.md) Layer 2. ADR-005's Layer 3 — the SQS queues, the
dead-letter queues and the relay loop — is **not** built by this feature.

`apps/worker` *is* created, because [ADR-002](../../adr/ADR-002-modular-monolith.md) assigns it
"queue consumers, scheduled sweeps, the outbox relay" and FR-019/FR-020's retention erasure is a
scheduled sweep. It ships with the sweeps only: no queue consumer, no relay. Putting the sweeps in
`apps/api` instead was rejected — it contradicts ADR-002's topology for the sake of avoiding one
small deployable, and the API and the worker scale on different signals, which is the reason that
topology exists.

**Rationale.** ADR-005's Layer 2 rule is absolute by design: "every effect crossing a context
boundary or a process boundary. No exceptions and no case-by-case judgement." That rule is honoured
in full here — the row is written transactionally, so nothing can be silently lost, which is the
failure ADR-005 exists to prevent.

Layer 3 is a different question. It requires SQS, which requires AWS, which
[ADR-013](../../adr/ADR-013-staged-hosting-model.md) defers until Stage 1; and it would relay
messages to zero consumers, because spec.md states plainly that no other bounded context exists
yet. The constitution's cost principle — "a component MUST NOT be provisioned before the trigger
that justifies it" — forbids building it now. The outbox row is the durable seam; the relay is the
part with no work to do.

**This is a staging of ADR-005's implementation, not a departure from its decision**, in exactly
the way ADR-013 staged ADR-004's topology without amending ADR-004's choice of tooling. It is
recorded here and in plan.md's Complexity Tracking so that a future reader finds it stated rather
than inferred.

**Trigger.** The relay is built by whichever feature first introduces a consumer in another
context — on current sequencing, spec 007 (Family and Membership) or the Compliance context,
whichever lands first.

---

## 6. New packages this feature must establish

The repository currently contains `packages/{config-*,persistence,testing}` and `apps/api` only.
[`ARCHITECTURE.md` §6 and §8](../../ARCHITECTURE.md) require the following to exist before any
bounded context can be written. Creating them is part of this feature's cost and is the reason it
is larger than its user-facing surface suggests.

| Package | Why this feature needs it | Layer rule it must satisfy |
|---|---|---|
| `packages/kernel` | `domain/` may import `@fp/kernel` **only**, so it must exist first. Provides `Result`, branded identifiers, domain error types and the `Clock` port | Pure and dependency-free |
| `packages/core/identity/{domain,application}` | The context itself: aggregates, ports, command and query handlers | No framework, no ORM, no I/O |
| `packages/contracts` | [ADR-006](../../adr/ADR-006-api-style-and-type-safety.md) and Principle IX: request and response shapes defined once as Zod, bound with ts-rest, at `/v1` | MUST NOT import domain or application code |
| `packages/platform` | Adapters: argon2id hasher, random token generator, `MailerPort` → Mailpit, system `Clock` | May import provider SDKs; MUST NOT import `@fp/core` or `@fp/persistence` |
| `packages/persistence` (extend) | Prisma models and migrations for `user`, `session`, `device`, `outbox_event`; repository implementations satisfying application ports | Prisma client never escapes this package |
| `apps/api` (extend) | `@ts-rest/nest` controllers, the authentication guard, DI wiring | Thin; no business logic |

`apps/worker` **is** created, minimally: the FR-019/FR-020 retention sweeps only, with no queue
consumer and no outbox relay (see §5). `packages/api-client`, `packages/ui` and `apps/mobile` are
**not** created — spec.md scopes out all UI.

---

## 7. `ARCHITECTURE.md` §8 does not list `core/identity` — drift to reconcile first

**Finding.** [`ARCHITECTURE.md` §5.1](../../ARCHITECTURE.md) defines Identity and Access as a
bounded context with `User`, `Session` and `Device` aggregates. But §8's `packages/core/` tree
lists `family`, `calendar`, `tasks`, `documents`, `reminders`, `notifications`, `reference`,
`compliance` and `billing` — and **no `identity`**. §8.1 compounds it: in rejecting a proposed
`auth` package it states "Authentication adapters are `platform`. Authorization is `core/family`
capabilities plus a guard in `apps/api`" — which describes where the *adapters* go without
allocating a home for the context's own domain and application layers.

**Assessment.** This is documentation drift, not a contradiction. §5.1 already establishes the
context; §8's tree simply predates it being scheduled. §8.1's statement remains true under the
decision in §1 — the adapters *do* live in `platform`; what §8.1 does not say is where the
aggregates live.

**Resolution.** `ARCHITECTURE.md` §8's tree gains `identity/{domain,application}` under
`packages/core/`, in the same pull request as ADR-007. Principle III requires an ADR merged before
an implementation PR for anything that changes a context boundary; this clarifies rather than
changes one, but ADR-007 is being written regardless, so the correction rides with it and no
separate ADR is needed.

---

## 8. Performance budget and argon2id parameters

**Decision.** Target p95 under 300 ms for the authentication endpoint end to end, of which
argon2id verification is budgeted at roughly 100 ms. Parameters are tuned against the Stage 0 VPS,
not a developer laptop, and the chosen values are recorded in the adapter alongside the measurement
that justified them.

**Rationale.** SC-002's "under 10 seconds" is a user-facing ceiling, not an engineering target, and
optimising to it would permit a badly tuned hasher. argon2id is deliberately slow, and the cost is
a security parameter: too low and it is cheap to attack offline, too high and it becomes a
denial-of-service vector against our own login endpoint. Measuring on the machine that will run it
is the only way to choose honestly, because memory-hard cost does not transfer between machines.

Session validation — the FR-023 check on every authenticated request — is a separate budget: a
single indexed lookup on the session token hash, targeted under 5 ms, because unlike login it runs
on every request in the system.

---

## 9. What this feature does and does not close on the constitution's merge-gate table

The constitution's sync report records one gate row still open: "Contract and API tests, including
cross-family authorization assertions," noted as closing "with the first bounded context." This is
that feature, so the row moves — but only partly.

- **Contract and API tests: closed.** `packages/contracts` and the ts-rest binding arrive here, and
  every route in this feature gets contract-level tests plus per-route authorization tests (a user
  may revoke only their own sessions, delete only their own account).
- **Cross-family authorization assertions: still open, and cannot close here.** Identity has no
  family concept by construction (FR-018). The assertion that "a member of another family receives
  not-found" has nothing to assert against until `core/family` exists, so it closes with spec 007.

Recording this split matters because a reviewer reading the gate row as closed would otherwise
assume cross-family authorization had been tested somewhere. It has not been, and cannot be, yet.
