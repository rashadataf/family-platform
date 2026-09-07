# Architecture Decision Records

An ADR records a decision that is expensive to reverse, together with the alternatives that were rejected and why. It captures the reasoning at the moment of choosing, so that a future engineer or AI agent can tell the difference between a deliberate constraint and an accident.

## Index

| ADR | Title | Status | Date |
|---|---|---|---|
| [001](ADR-001-monorepo-tooling.md) | Monorepo tooling: pnpm workspaces + Turborepo | Accepted | 2026-09-08 |
| [002](ADR-002-modular-monolith.md) | Modular monolith with a separate asynchronous worker | Accepted | 2026-09-08 |
| [003](ADR-003-database-orm.md) | PostgreSQL with Prisma, and the query-builder escape hatch | Accepted | 2026-09-08 |
| [004](ADR-004-infrastructure-as-code.md) | Infrastructure as Code with Pulumi | Accepted | 2026-09-08 |
| [005](ADR-005-event-system.md) | Domain events, transactional outbox, SQS | Accepted | 2026-09-08 |
| [006](ADR-006-api-style-and-type-safety.md) | REST API with ts-rest and Zod contracts | Accepted | 2026-09-08 |

## Planned

| ADR | Title |
|---|---|
| 007 | Authentication: managed identity provider versus self-hosted |
| 008 | AI provider abstraction, prompt management and evaluation |
| 009 | Mobile state, offline behaviour and cache strategy |
| 010 | Feature flags and remote configuration |
| 011 | Observability stack |
| 012 | Mobile end-to-end testing: Maestro versus Detox |

## Rules

**An ADR is required when** a decision is hard to reverse, affects more than one bounded context, introduces or removes a foundational dependency, changes a security or privacy control, or contradicts an existing ADR.

**An ADR is not required for** library choices confined to one module, refactors that preserve boundaries, or anything a pull request description covers adequately.

**Accepted ADRs are immutable.** Superseding one means writing a new ADR that states what it supersedes, and updating the old one's status to `Superseded by ADR-NNN`. Never edit the reasoning of an accepted ADR, because the record of why we believed something at the time is the entire value.

**Every ADR must contain** the decision, the alternatives actually considered with the reason each was rejected, the consequences including the negative ones, and the conditions under which the decision should be revisited. An ADR with no downsides listed has not been thought through.

## Status values

`Proposed` → `Accepted` → `Superseded by ADR-NNN` | `Deprecated`
