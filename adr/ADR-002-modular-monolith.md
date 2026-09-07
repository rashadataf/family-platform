# ADR-002: Modular monolith with a separate asynchronous worker

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

The blueprint states a preference for starting as a modular monolith with bounded contexts extractable later, and explicitly warns against introducing microservices merely because the system is meant to scale. That preference is correct, and this ADR does not exist to agree with it. It exists to decide the two things the preference leaves open, both of which determine whether "extractable later" is true or merely aspirational:

1. **How many processes does a modular monolith run?** The term is routinely read as "one deployable", which is not what it means and would be wrong here.
2. **What makes extraction actually possible?** Every failed modular monolith was described as extractable by the people who built it.

There is also a real counter-pressure worth taking seriously. The workload has genuinely heterogeneous characteristics: sub-100ms authenticated CRUD for the dashboard, and multi-minute OCR plus LLM extraction over uploaded documents. That heterogeneity is the standard argument for splitting services.

## Decision

**A modular monolith, deployed as two processes from one codebase, with pre-agreed extraction seams.**

- `apps/api` — NestJS HTTP host. Synchronous, latency-sensitive, scaled on request rate.
- `apps/worker` — NestJS standalone host. Queue consumers, scheduled sweeps, the outbox relay. Scaled on queue depth.

Both are thin composition roots over the same `packages/core`. They share the domain, the application layer, the repositories and the database. They differ only in what they wire up and what triggers them.

Three properties make extraction real rather than claimed, and all three are enforced in CI:

1. **No cross-context imports except through published application ports.** Enforced by `dependency-cruiser` and `eslint-plugin-boundaries`.
2. **No cross-context foreign keys except to published stable ids.** A context may reference `family_id`; it may not reference another context's internal entity.
3. **Every cross-context side effect goes through the outbox**, never a direct in-process write. See [ADR-005](ADR-005-event-system.md).

## Alternatives considered

### Single process for everything

**Rejected.** This is the reading of "modular monolith" that would have been wrong for this product specifically.

Document processing is minutes-long, memory-heavy, and bursty. A family that uploads fifteen documents from a folder of school letters produces fifteen concurrent OCR and LLM jobs. In a single process, those compete with HTTP request handling for CPU, memory and, critically, the database connection pool. A dashboard request queuing behind an OCR job is a visible product failure caused entirely by a deployment decision.

It also breaks scaling. The API scales on request rate; the worker scales on queue depth. Fused together, the only scaling signal is the union of both, so we over-provision permanently.

And it breaks deployment safety. A memory leak or an OOM in a PDF parser should not restart the process serving user traffic.

The split costs almost nothing architecturally. Both hosts import the same packages. There is no new network hop in a user's path, no distributed transaction, and no new failure mode, because the queue between them was going to exist regardless. This is not a microservice; it is one application with two entry points.

### Microservices from the start

**Rejected**, and the reasoning is worth recording because "we will need it eventually" is the argument that produces it anyway.

**Service boundaries would be guesses.** The contexts in [ARCHITECTURE.md §5](../ARCHITECTURE.md) are hypotheses drawn from a blueprint, not from operating a product. Nobody has yet learned whether Calendar and Tasks are genuinely separate or whether they collapse under real usage, or whether Reminders should absorb parts of both. Wrong boundaries in a monolith are a refactor. Wrong boundaries in a distributed system are a migration involving two databases, a compatibility window and a data backfill.

**Conway's law has nothing to mirror.** Microservices pay for themselves by letting independent teams deploy independently. There is one developer. The organisational benefit is zero and the operational cost is immediate: per-service pipelines, per-service observability, service discovery, distributed tracing to answer questions a stack trace answers today.

**The domain has transactional invariants that cross candidate boundaries.** Creating a family with its first member, completing a recurring task and spawning its successor, confirming a document expiry and scheduling the resulting reminder set. In one database these are transactions. Across services they are sagas with compensating actions, and every one of them is a place where a family ends up with a document whose expiry was recorded but whose reminders were never created. For a product whose entire value proposition is "we will not let you forget", that failure mode is disqualifying.

**Cost.** Nine services on Fargate with load balancers and separate databases is a five-figure annual bill before a single user exists.

### Serverless-first: Lambda per endpoint

**Rejected for the API, deliberately left open for parts of the pipeline.**

Against it for the API:

- **Connection management.** Lambda's concurrency model is hostile to PostgreSQL. RDS Proxy solves it and adds roughly $15 per month per proxy plus a hop. Worse, the per-transaction `SET LOCAL app.family_id` that our row-level security depends on interacts badly with connection pinning in transaction-pooling mode, which is precisely the mode RDS Proxy uses. Our strongest isolation backstop becomes the thing hardest to run.
- **NestJS in Lambda is a compromise.** Running the whole Nest app per function wastes cold-start time bootstrapping a DI container; splitting it into handlers throws away the composition model.
- **Local development.** `pnpm dev` starting a real server is materially better than emulating an event-driven runtime, and developer experience is a stated priority.
- **Cost crossover.** Two small Fargate tasks cost roughly $30 to $60 per month and are cheaper than Lambda well before serious traffic, with entirely predictable billing.

Where Lambda is genuinely a good fit, and remains an open option: individual document-processing steps. OCR of a single page is stateless, bursty, parallel and time-boxed. If the shared worker becomes a bottleneck, moving the OCR fan-out step to Lambda is a contained change because it is already an idempotent queue consumer. That is recorded as a future option, not adopted now, because a second runtime is a real cost and the worker will handle MVP volume comfortably.

### Modular monolith without enforced boundaries

**Rejected.** This is the default outcome and the reason most "we will extract later" plans fail. Without mechanical enforcement, the first deadline produces a direct import of another context's repository, the second produces a cross-context foreign key, and within a year the contexts are a directory-naming convention over a fully connected graph. The enforcement described above is not optional tooling; it is the mechanism that makes this ADR's central claim true.

## Consequences

### Positive

- One database, so transactions and foreign keys still do their job.
- One codebase and one contract package, so a change spanning several contexts is one reviewable pull request.
- Debugging is a stack trace, not a distributed trace correlation exercise.
- Latency-sensitive and latency-tolerant work scale independently and fail independently.
- Extraction candidates in [ARCHITECTURE.md §12](../ARCHITECTURE.md) are already queue-driven and read-port-only, so extracting one is a contained change rather than a rewrite.

### Negative

- **Boundary enforcement must be maintained.** If the lint and dependency-cruiser configuration is allowed to rot, the architecture rots with it, silently. Mitigation: both are required CI checks and the configuration itself is covered by a test asserting that known-bad imports are rejected.
- **A shared database is a shared coupling.** A slow query in one context degrades all of them. Mitigation: statement timeouts, per-context slow-query attribution in telemetry, and a connection pool sized against RDS limits.
- **One deployment unit for synchronous code.** A bug anywhere in the API affects the whole API. Mitigation: rolling deploys with health checks, feature flags for anything new, and fast rollback.
- **Team growth will create contention.** Multiple engineers in one codebase need CODEOWNERS per context and short-lived branches. This is manageable well past ten engineers.

### Revisit this decision when

- A single context's resource profile cannot be isolated by scaling the worker, or
- Deployment coupling measurably slows delivery, meaning independent teams are blocked on each other's releases, or
- A regulatory requirement demands physical isolation of a data category, or
- A context needs a runtime the monolith cannot host.

Absent one of these, extraction is speculative and is refused in review.
