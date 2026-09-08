# ADR-013: Staged Hosting Model — VPS-First Pre-Launch, AWS at Real-User Data

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

This ADR supersedes [ADR-004](ADR-004-infrastructure-as-code.md)'s "The MVP infrastructure this provisions" section only. ADR-004's Decision section — Pulumi with TypeScript, one stack per environment sharing a single program, stack outputs as the source of truth for application configuration, deletion protection on stateful resources, and CI-gated production applies — remains in full effect and is not restated here.

ADR-004 assumed every environment (local, development, staging, production) provisions the same AWS topology, parameterised by size. That assumption was made before a harder constraint was made explicit: no paid, always-on infrastructure is justified before the trigger defined below. The AWS topology in ADR-004's original table — a VPC with NAT gateways, an Application Load Balancer, ECS Fargate, Multi-AZ RDS — bills continuously from the moment it exists, independent of traffic. For a pre-revenue solo founder, that cost has no offsetting return yet, and the constitution's own cost principle ("a component MUST NOT be provisioned before the trigger that justifies it") already forbids provisioning it early; ADR-004's original table did not yet honour that principle.

Two resources already exist outside this decision and are reused rather than re-justified:

- A VPS the founder already operates and pays for, currently hosting an unrelated portfolio site, with spare capacity.
- Working experience running a Dockerized Pulumi program against that VPS for the portfolio project (`pulumi up` / `pulumi down`, dev and prod stacks) — the same tool ADR-004 already chose, targeting a different provider set.

A second constraint is not economic and does not move with revenue: [Constitution Principle VI, Children and Family Data Are Sensitive by Default](../.specify/memory/constitution.md) is marked NON-NEGOTIABLE and requires no relaxation for cost reasons. A shared personal VPS, already carrying an unrelated public-facing site, is not an acceptable home for a real family's passport scans, medical appointments or a child's record, regardless of whether money has changed hands. The trigger for moving to the AWS topology is therefore **real personal data, not revenue** — the two will often arrive together, but must not be conflated, because an unpaid beta with real families is exactly the case a revenue-based trigger would miss.

## Decision

**Two hosting stages, one Pulumi program family, different provider targets.**

**Stage 0 — VPS, synthetic data only.** `local` (unchanged, per spec 001) plus a single shared `staging` environment, deployed to the founder's existing VPS via a Pulumi stack using the `command` (remote execution over SSH) and `docker` providers to build, push and run the same container images `local` already produces — the deployed equivalent of the existing Docker Compose service set. This environment exists for technical validation, demos, and the founder's own dogfooding. It MUST NOT hold any real family's data: seeded and reset from fixtures only, the same discipline `local`'s baseline migration already established. No environment at this stage is production, because production implies real user data and nothing in Stage 0 is authorised to hold it.

**Stage 1 — AWS, triggered by real personal data, not revenue.** The first time this product is to hold one real family's actual data — a real passport scan, a real child's name, a real calendar a real person depends on — provisioning moves to the topology ADR-004 already specified (VPC, ALB, ECS Fargate, Multi-AZ RDS, KMS, Secrets Manager, and the rest of that table, unchanged). This applies even to an unpaid, invite-only beta with a handful of trusted early users. Revenue is not the trigger; it is merely the thing that usually arrives around the same time as real users, and must not be used as a proxy for a decision that is actually about data sensitivity.

Supporting choices:

- Stage 0's Pulumi program lives in the same `infrastructure/` package ADR-004 already established, as an additional, smaller stack (`vps-staging`) alongside the eventual AWS stacks — not a separate tool, not a separate repository.
- Container images are identical across both stages. What differs is only the target the Pulumi program deploys them to, preserving ADR-004's requirement that environments differ in size and target, not in shape, as far as a genuinely different substrate allows.
- Secrets for Stage 0 are managed by whatever mechanism already secures the founder's existing VPS deployment — never committed, and never shared with the portfolio site's own secrets.
- The Stage 0 container set is network-isolated from the portfolio site's own containers (separate Docker network, no shared volumes, no shared database), so a compromise of one cannot trivially reach the other.
- Ephemeral per-pull-request preview environments (an ADR-004 requirement) are deferred to Stage 1. A single VPS has real, shared resource limits a scalable AWS account does not, and previews are a convenience, not a correctness requirement, at solo-founder scale.

## Alternatives considered

### Stay on ADR-004's AWS-from-day-one plan — rejected

The strongest argument for it is consistency: one topology, and a migration never has to happen. Rejected anyway, because "spend like a startup" (constitution, Additional Engineering Constraints) is a real requirement, not a slogan, and a NAT gateway billing hourly whether or not a single request arrives is the opposite of that. Provisioning the full topology before the trigger that justifies it is exactly the pattern the constitution's cost principle names and forbids.

### VPS all the way, including real production — rejected

Rejected on Principle VI, not cost. A single VPS shared with an unrelated public site is a materially different risk profile from an isolated cloud VPC with KMS-backed encryption, a WAF, and network isolation, the moment it holds one real family's sensitive data. Saving infrastructure spend at the expense of a NON-NEGOTIABLE principle is not a trade available here, and no revenue figure changes that.

### A managed PaaS (Render, Railway, Fly.io) instead of the existing VPS — rejected for now

Genuinely closer to zero-ops than either option above, and worth reconsidering on its own merits later. Rejected for Stage 0 specifically because it adds a new, unevaluated vendor and a new deployment mechanism for a stage whose entire point is minimising new commitments, when a working, already-paid-for, already-understood VPS exists. Not rejected forever: if the VPS becomes a maintenance burden before Stage 1's trigger fires, a PaaS is a smaller change to reconsider than reopening this ADR, and does not require revisiting the AWS decision.

### A second Terraform/CDK program just for the VPS stage — rejected

Would reopen ADR-004's tool decision for one stage only, reintroducing the two-toolchain cost that decision exists to avoid, for a saving Pulumi's own `command` and `docker` providers already cover.

## Consequences

### Positive

- Zero new paid, always-on infrastructure exists until the trigger that actually justifies it — revenue is not required for the founder to build and demo against a real, deployed environment.
- The tool, language and program structure ADR-004 chose carry over unchanged; nothing here reopens that decision.
- The line between "safe to be casual with" (Stage 0, synthetic data) and "must be treated as production-grade" (Stage 1, real data) is drawn once, explicitly, rather than left to be inferred later under time pressure when a first real user is ready to onboard.

### Negative

- **Two deploy targets to maintain**, even if both run from the same container images. Mitigation: the Pulumi program's provider-specific code is intentionally the only thing that differs; application code and images never branch on which stage they're deployed to.
- **The VPS is a single point of failure with no autoscaling**, acceptable only because Stage 0 explicitly excludes real users depending on it. Mitigation: this constraint is the whole point of drawing the stage boundary where it is drawn, not a gap to close.
- **A second, real migration must happen at Stage 1**, unlike ADR-004's original plan where "staging" and "production" were the same topology at different sizes. Mitigation: identical container images and the shared Pulumi program structure mean the migration is a new stack pointed at AWS, not a rewrite.
- **Discipline-dependent boundary.** Nothing at the infrastructure layer technically prevents someone from loading real data into Stage 0 by mistake; the guarantee is procedural, not enforced by a database constraint the way row-level security is. Mitigation: Stage 0's documentation states this explicitly, and the Stage 1 trigger is deliberately data-based rather than revenue-based, so the temptation to "just add one real early user first" is named directly rather than left implicit.

### Revisit this decision when

- The product is about to hold any real family's actual personal data, even a single unpaid beta user — migrate to Stage 1 (AWS) before that data is entered, not after.
- The VPS's spare capacity is exhausted by Stage 0 traffic or build load, independent of the data-sensitivity trigger above.
- Revenue or committed funding exists — a reasonable moment to move to Stage 1 proactively even without a real user yet queued, since the cost objection this ADR exists to satisfy no longer applies.
