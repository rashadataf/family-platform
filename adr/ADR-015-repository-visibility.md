# ADR-015: Repository Visibility — Public, Chosen Deliberately

- **Status:** Accepted
- **Date:** 2026-09-09
- **Deciders:** Founder

## Context

This repository has been public since it was created, and nothing in it ever recorded that as a decision — it was true by inheritance from whatever GitHub's create-repository default happened to be, not by anyone weighing the alternatives.

Spec 005 (merge gate enforcement) surfaced the question as a side effect of building the security gates: `gh repo view` reported `visibility=PUBLIC`, and two of the free security controls that research proposed relying on — GitHub secret scanning and push protection — turned out to already be active, for the specific reason that the repository is public. That is a good outcome arrived at accidentally, and the constitution's own rule for when an ADR is required — "changes a security or privacy control" — arguably applies just as much to *ratifying* an existing control on purpose as to changing one, especially for a project whose stated purpose is holding data about children and families.

Three consequences follow from being public that a project in this domain should decide on purpose rather than default into:

1. **Anything ever committed is permanently public.** Rewriting history does not un-publish it. Spec 005 hit a live example of this: an illustrative, non-secret string in a documentation commit is now permanently part of `main`'s history, harmless only because it happened to be fake.
2. **The architecture is readable by anyone**, today and for as long as the repository exists — `ARCHITECTURE.md`, the constitution, every ADR, and eventually the exact implementation of the family-isolation and authorization logic Principle V describes. Not a secret value, but the rulebook: if that logic ever has a bug, a reader has a map to find it rather than having to guess blind.
3. **Automated scrapers harvest public commits within seconds of a push.** A credential that reaches a public repository, even briefly, is assumed compromised the instant it is pushed — rotation is the only remedy, not deletion.

None of these makes public wrong. Plenty of security-conscious products are open source, and building on the assumption that your source is readable is a defensible discipline in its own right. But none of them had been weighed before now.

## Decision

**The repository stays public**, chosen deliberately rather than left as an unexamined default.

The concrete reasoning, checked rather than assumed:

**1. No secret has ever actually been exposed.** `gh api repos/.../secret-scanning/alerts` returns an empty list, and a full-history `gitleaks` scan is clean. The two findings surfaced during spec 005 were an illustrative, fake connection-string password in documentation prose — fixed and enumerated in `.gitleaks.toml` — not a credential. Public visibility has cost nothing so far because the separate, unconditional rule already in force — real secrets never enter the repository at all, public or private — has held.

**2. Public visibility is materially cheaper and better-defended than the alternative, given the project's other constraints.** Constitution Additional Engineering Constraints already establishes cost as a design axis and forbids any paid or subscription service. On the founder's personal GitHub account:

   - GitHub secret scanning and push protection are free on a public repository. They are not purchasable standalone on a personal account at all — only bundled into paid organization or enterprise tiers — so going private would not add a paid equivalent, it would remove the free one outright.
   - GitHub Actions minutes are unlimited and free on a public repository. A private repository on the same plan gets a metered 2,000 minutes/month, after which GitHub Actions either stops running or bills. With ten CI jobs running per push and pull request — several building and running real Docker containers — that limit is a real risk, not a theoretical one, and either outcome it produces (a merge gate that silently stops enforcing anything, or a paid bill) is worse than the status quo.

   Going private would trade a real, working, free security posture for a materially weaker one, in order to address a risk — architecture readability — that is real but of a different kind.

**3. The risk that remains is accepted, not eliminated, and is named here rather than hidden.** Being public means the eventual implementation of family-isolation and authorization is auditable by anyone, adversary included. The mitigation is not secrecy but correctness verified independently of it: [spec 005](../specs/005-merge-gate-enforcement/spec.md)'s integration-test harness exists precisely so that access-control logic is tested against a real database rather than asserted, and Principle V's future "Enforced by" clause is an API test suite asserting cross-family access returns not-found — a control that has to hold regardless of who can read the code that implements it.

## Alternatives considered

### Go private — rejected

Addresses consequence 2 (architecture readability) directly, at the cost of consequence identified in Decision point 2: on a personal GitHub account, private visibility removes free secret scanning and push protection entirely, and replaces unlimited CI minutes with a metered allowance that ten jobs per push could plausibly exceed. Reversing this decision means accepting a materially weaker free security posture, or paying for GitHub Advanced Security and/or extra Actions minutes — both of which the constitution's no-paid-service constraint forbids today. Revisit if that constraint changes, or if the project moves to an organization account where the calculus differs (GitHub Team includes some private-repo secret scanning without full GHAS).

### Public application code, private infrastructure/secrets repository — rejected for now

A genuine middle ground: split anything infrastructure- or secrets-adjacent into a second, private repository, keeping the application code (and its readable authorization logic) public. Rejected for now on the grounds of unnecessary complexity at this project's current size — one repository, one contributor, no infrastructure-as-code yet (spec 003 is parked, ADR-004 amended by ADR-013 and not yet implemented). Splitting the repository before there is a second repository's worth of content to justify it would be process built ahead of the problem it solves. **Revisit when spec 003 (VPS staging) actually introduces infrastructure configuration or deployment secrets**, at which point the question of where that configuration should live is worth asking on its own merits rather than folded into this ADR.

### Do nothing, leave visibility as an unexamined default — rejected

This is the state the ADR corrects. The objection to it is not that public is wrong — the Decision above concludes it is currently right — but that a security-relevant property of a project holding children's and family data should be the result of a choice a future reader can find and understand, not an artifact nobody remembers deciding.

## Consequences

### Positive

- Free secret scanning, push protection and unlimited Actions minutes continue, with no paid service and no organizational plan required.
- The decision is now discoverable. A future contributor, or an AI agent working in this repository, can find the reasoning here rather than re-deriving it or, worse, not noticing there was a question to ask.
- Nothing changes operationally. This ADR ratifies the existing state rather than migrating anything, so it carries no implementation risk.

### Negative

- **The eventual authorization and family-isolation implementation is permanently auditable by anyone, adversary included.** Accepted, and mitigated by testing that control independently of secrecy — spec 005's harness, and the future test suite Principle V's "Enforced by" clause names — rather than by hiding the implementation.
- **Anything ever committed is permanently public**, including in history, even if later corrected. Mitigated by the gates spec 005 built (push protection primary, `gitleaks` as a second layer catching what push protection's partner-pattern list does not) — but the mitigation reduces the *likelihood* of a real secret ever reaching the repository; it does not undo publication of one that does. The operational discipline this implies: a leaked credential is rotated, never merely deleted from history.
- **The project's design decisions, including future ones, are visible to competitors** for as long as the repository is public. Accepted as the cost of the working name's own placeholder status (see [README.md](../README.md)) and the project's current pre-product stage; worth re-weighing once there is a product and a market position to protect.

### Revisit this decision when

- The project moves from a personal GitHub account to an organization, which changes the private-repository cost calculus described in the rejected alternative above.
- Spec 003 introduces infrastructure-as-code or deployment secrets, reopening the split-repository alternative on its own merits.
- A real user's data exists in any environment reachable from information in this repository — at which point the Additional Engineering Constraints' cost axis should explicitly be weighed against a paid private-repository tier, rather than assumed to still win.
- GitHub's own free-tier feature boundaries change, which would change Decision point 2's cost comparison without anyone here having decided anything.
