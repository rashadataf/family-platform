# ADR-007: Authentication — managed identity provider versus self-hosted

- **Status:** Accepted
- **Date:** 2026-09-11
- **Deciders:** Principal Engineer

## Context

Spec 006 (Identity and Access) implements the bounded context [`ARCHITECTURE.md` §5.1](../ARCHITECTURE.md)
defines: `User`, `Session` and `Device` aggregates, credential-based registration and login, session
issuance, rotation and revocation, and account deletion. §5.1 goes further than most contexts in the
architecture document and names its own likely fate: Identity is "the strongest candidate for a
managed provider," because a managed provider can only ever hold a `UserId`, an email and
authentication factors — never family data — so adopting one would not compromise the family-scoped
boundary the rest of the system is built around.

That framing makes this a real decision rather than a default. The constitution requires an ADR
before a decision that "introduces or removes a foundational dependency" or "changes a security or
privacy control," and authentication is both at once: whichever way this goes, every other bounded
context calls through it.

Two things fixed the shape of the answer before pricing entered the picture at all.

**FR-023, chosen during spec.md's clarification session, requires a revoked session or a deleted
account to be rejected on its very next use** — no grace window, no waiting out a token's remaining
lifetime. SC-007 makes this a measured success criterion, not an aspiration.

**[ADR-013](ADR-013-staged-hosting-model.md) puts Stage 0 on a single VPS**, already shared with an
unrelated portfolio site, with no autoscaling and no managed dependency beyond what that ADR already
accepted. Anything added to the request path at Stage 0 either fails together with that VPS or adds
a new external failure mode on top of it.

The question this ADR answers is narrower than "self-host or not" in general — it is whether a
managed identity provider can satisfy FR-023 at Stage 0 without the fallback of calling that
provider on every authenticated request, which would defeat the reason to adopt one.

## Decision

**Self-host.** Own credential storage, session issuance, rotation and revocation. `User`, `Session`
and `Device` are aggregates in `packages/core/identity`, persisted through repository ports in
`packages/persistence`. Password hashing, opaque token generation and mail delivery are ports
implemented in `packages/platform`. No managed identity provider is adopted at this stage.

**The port boundary is part of the decision, not an implementation detail.** `packages/core/identity`
depends on abstract ports for hashing, token issuance and mail — never on a vendor SDK directly —
specifically so that §5.1's claim that Identity is replaceable is true in code, not only in prose. A
later migration to a managed provider is an adapter swap and a password-hash import, not a rewrite of
the aggregates or the API surface in front of them.

Pricing was researched and is genuinely favourable as of September 2026 — [Clerk raised its free
allotment to 50,000 monthly retained users](https://clerk.com/articles/clerk-pricing-explained) in
February 2026, [Auth0 offers 25,000 MAU](https://zuplo.com/learning-center/api-authentication-pricing),
and [Cognito offers 10,000 MAU](https://tesseral.com/guides/a-simple-guide-to-aws-cognito-pricing)
since its December 2024 restructure. Cost alone would favour adopting one, which is worth stating
plainly because the deciding factor below is not cost.

**The deciding factor is FR-023's revocation guarantee.** Clerk, the most generous of the three,
issues 60-second JWTs verified networklessly, and [its own documentation states the trade-off
directly](https://clerk.com/docs/guides/how-clerk-works/overview): once issued, a JWT remains valid
until it expires, so revocation waits out the token. Auth0 and Cognito share the same networkless-JWT
revocation model. A 60-second window is bounded and small, but it is precisely the option spec.md's
clarification rejected in favour of "effectively instant."

Preserving FR-023 on top of any of the three therefore means calling the provider's session-status
API on every authenticated request — the standard mitigation for short-lived-JWT revocation lag. That
reintroduces the exact dependency adopting a managed provider was supposed to remove, and does so on
the hottest path in the system: at ADR-013's Stage 0, a third party's outage becomes this
application's outage for every authenticated request, on a VPS that was chosen in part to keep new
external failure modes off the table. Self-hosting satisfies FR-023 with a single indexed read against
data already in the request path, because a session lookup has to happen on every request regardless
of who owns the credential.

Three supporting reasons, none sufficient alone, all pointing the same way:

- **ADR-013 already rejected adding an unevaluated vendor at Stage 0** — its own words, rejecting a
  PaaS, were that Stage 0 "minimis[es] new commitments." A managed identity provider is the same
  shape of commitment, arriving through a different door.
- **A vendor that receives personal data needs a privacy review**, per the constitution's Additional
  Engineering Constraints. That review is real work that buys nothing at Stage 0, which
  [ADR-013](ADR-013-staged-hosting-model.md) restricts to synthetic data only.
- **Free tiers are a pricing decision, not an architectural property.** Cognito's own free tier fell
  from 50,000 MAU to 10,000 in December 2024. A decision this foundational should not rest on a
  number a vendor can revise unilaterally.

## Alternatives considered

### Clerk

**Rejected.** The most generous free tier of the three (50,000 MRU) and the best-documented
developer experience. Rejected on the 60-second networkless-JWT revocation window described above,
which directly contradicts FR-023 and SC-007 unless mitigated with a per-request API call — at which
point the dependency this option exists to avoid is reintroduced anyway.

### Auth0

**Rejected.** Same revocation model as Clerk. Additionally a steeper paid cliff past its 25,000 MAU
free tier and a pricing history (now under Okta) that has moved before. Offers nothing that changes
the FR-023 analysis above.

### Amazon Cognito

**Rejected.** Same revocation model. Also introduces AWS as a dependency before
[ADR-013](ADR-013-staged-hosting-model.md)'s Stage 1 trigger (real personal data) has fired, which
that ADR specifically defers. Adopting Cognito for authentication alone, ahead of the rest of the AWS
topology, would split Stage 0 across two hosting substrates for no compensating benefit.

### Self-hosted, without a port boundary

**Rejected.** Would satisfy FR-023 identically but would contradict
[`ARCHITECTURE.md` §5.1](../ARCHITECTURE.md)'s explicit statement that this context is a strong
migration candidate. Coupling `core/identity` directly to a hashing library, a mail transport or a
token format would turn a later migration into a rewrite of the aggregates rather than an adapter
swap, which is the exact cost the port boundary exists to avoid paying twice.

### Do nothing until Stage 1

**Rejected.** Spec 006 is the platform's first real bounded context; every other context depends on
`UserId` existing. Deferring authentication defers everything.

## Consequences

### Positive

- FR-023 and SC-007 are satisfied exactly as specified, with a single indexed read already on the
  request path, and no per-request call to a third party.
- No new vendor, no new privacy review, and no new external failure mode added to a Stage 0 VPS that
  ADR-013 already chose to keep minimal.
- The port boundary makes §5.1's replaceability claim real: migrating to a managed provider later is
  an adapter swap and a password-hash import, not a rewrite.
- Consistent with ADR-013's Stage 0 philosophy and with the constitution's cost principle — nothing
  is provisioned before the trigger that justifies it.

### Negative

- **We own correctness for password hashing, throttling, rotation and replay detection**, work a
  managed provider would otherwise carry. Mitigated by argon2id via `@node-rs/argon2` (OWASP's
  current recommendation), an opaque hashed session token, and single-previous-hash replay detection
  — all recorded in [research.md](../specs/006-identity-access/research.md) §2–§3.
- **Password reset and MFA are not inherited for free** and must be built if ever required, rather
  than toggled on in a vendor dashboard. Accepted because spec.md scopes both out for this feature,
  and the port boundary keeps adding either later, in-house or via a provider, a contained change.
- **No SSO or social login out of the box**, which a managed provider would offer immediately.
  Accepted because spec.md does not require it and it is a named revisit trigger below.
- **This is more code to write and operate than delegating to a provider would be.** Accepted because
  the code is bounded (spec 006's scope is deliberately narrow) and sits behind a port that makes it
  replaceable rather than permanent.

### Revisit this decision when

- **MFA becomes required.** Building it in-house is a materially larger undertaking than adopting a
  provider that already offers it.
- **Social login or SSO becomes required.** Same reasoning — protocol support a provider already
  maintains is expensive to build and maintain in-house for marginal benefit.
- **Stage 1 arrives** ([ADR-013](ADR-013-staged-hosting-model.md)'s trigger: real personal data) and
  the compliance burden of owning credential storage at that point outweighs the integration cost of
  a provider. This is not automatic — Stage 1 alone does not require revisiting this decision, only
  the compliance-burden comparison at that time does.
- **A future provider offers a networkless revocation model compatible with FR-023's "next use"
  guarantee** without a per-request API call. None of the three evaluated here do, as of this ADR's
  date; if that changes, the calculus above changes with it.

In every case, migration is an adapter swap behind the port boundary this ADR establishes, plus a
password-hash import — not a rewrite of `core/identity`'s aggregates or of the API surface in front
of them.
