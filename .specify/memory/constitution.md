<!--
SYNC IMPACT REPORT
==================
Version change: [unset template] -> 1.0.0
Bump rationale: Initial ratification. The prior file was an unfilled scaffold with no
  adopted content, so this is a first adoption rather than an amendment.

Modified principles: none (no prior principles existed)

Added sections:
  - Foundational References
  - Core Principles I-XI
  - Additional Engineering Constraints (SECTION_2)
  - Development Workflow and Quality Gates (SECTION_3)
  - Governance

Removed sections: none

Placeholders resolved:
  [PROJECT_NAME]            -> Family Platform (working placeholder; see Foundational References)
  [PRINCIPLE_1..5_NAME]     -> expanded to eleven principles (I-XI)
  [SECTION_2_NAME]          -> Additional Engineering Constraints
  [SECTION_3_NAME]          -> Development Workflow and Quality Gates
  [GOVERNANCE_RULES]        -> Governance section
  [CONSTITUTION_VERSION]    -> 1.0.0
  [RATIFICATION_DATE]       -> 2026-09-08
  [LAST_AMENDED_DATE]       -> 2026-09-08

Deferred items / follow-up TODOs:
  - TODO(SECURITY_SCAN_TOOLING): The merge-gate table in "Development Workflow and Quality Gates"
    requires a security scan covering dependency vulnerabilities and secret scanning, but names
    no specific scanner. Resolve when the CI pipeline is specified. This requires no amendment,
    because this constitution deliberately does not own tool selection.
  - Principles VIII, IX and X cite ADR-005, ADR-006 and ADR-004 respectively. Those ADRs are
    Accepted. No placeholder citations remain.
  - Planned ADRs 007-012 (see adr/README.md) are not yet written. Principles that will
    eventually cite them state the behavioural requirement without a citation and are marked
    accordingly.
-->

# Family Platform Constitution

**Family Platform** is a working placeholder name for an unnamed UK-first, mobile-first family
life management platform. The name carries no branding intent and MUST NOT be treated as a product
decision.

## Foundational References

This constitution governs behaviour. It does not choose technologies. Every technology and
structural decision is owned by a document listed here, and this constitution defers to them.

| Source | Owns |
|---|---|
| [`/ARCHITECTURE.md`](../../ARCHITECTURE.md) | Bounded contexts, module boundaries, layering, dependency direction, cross-context communication, family isolation model, repository structure |
| [`/adr/`](../../adr/) | Every foundational technology and structural decision, with alternatives and rationale |
| [`/adr/README.md`](../../adr/README.md) | ADR index, required contents, immutability rules, status values |

Accepted ADRs at the time of ratification:

| ADR | Decision it owns |
|---|---|
| [ADR-001: Monorepo tooling: pnpm workspaces + Turborepo](../../adr/ADR-001-monorepo-tooling.md) | Workspace layout, dependency linking, task orchestration, boundary-enforcement tooling |
| [ADR-002: Modular monolith with a separate asynchronous worker](../../adr/ADR-002-modular-monolith.md) | Deployment topology, extraction seams, boundary-enforcement requirement |
| [ADR-003: PostgreSQL with Prisma, and the query-builder escape hatch](../../adr/ADR-003-database-orm.md) | Database engine, data-access library, migration mechanism, raw-query policy |
| [ADR-004: Infrastructure as Code with Pulumi](../../adr/ADR-004-infrastructure-as-code.md) | IaC tooling, environment topology, state management, apply and approval process |
| [ADR-005: Domain events, transactional outbox, SQS](../../adr/ADR-005-event-system.md) | Event layers, outbox requirement, queue mechanism, idempotency, scheduling model |
| [ADR-006: REST API with ts-rest and Zod contracts](../../adr/ADR-006-api-style-and-type-safety.md) | API style, contract definition, validation library, versioning approach, error format |

**Precedence.** Where this constitution and an ADR appear to conflict, the ADR wins on *what the
technology is* and this constitution wins on *what behaviour is required*. If they genuinely
conflict on the same question, that is a defect: stop, and resolve it by amending one of them
before writing code.

**Restatement is forbidden.** A principle here MUST NOT re-decide, duplicate or paraphrase a
decision owned by an ADR. It states the obligation and cites the owner. This keeps a single source
of truth and makes a technology change a one-document change.

## Core Principles

### I. Type Safety Is a Contract

TypeScript strict mode MUST be enabled across every package with no per-file or per-package
relaxation.

`any` MUST NOT appear in application, domain, contract, persistence, infrastructure or test code.
An exception MAY be granted only where an untyped third-party surface cannot be modelled, and only
in the form of a suppression comment stating the reason, the boundary being crossed, and the
validation that immediately follows it:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- <library> ships no types for
// <surface>; the value is parsed by <schema> on the next line before it escapes this function.
```

`unknown` followed by a schema parse is the correct construction and requires no exception.
Non-null assertions (`!`), unchecked type assertions (`as`) that widen or fabricate a type, and
`@ts-ignore` are subject to the same rule. `@ts-expect-error` is permitted only in tests that
assert a compile failure.

Domain identifiers MUST be branded types, so that passing one entity's identifier where another's
is expected is a compile error. Discriminated unions with exhaustive checking MUST be used in
preference to optional-field-plus-type-string modelling.

**Rationale.** The stated goal is runtime validation plus compile-time safety. A single `any`
silently disables the compile-time half for everything downstream of it, and the places where
people reach for `any` are exactly the boundaries where the data is least trustworthy.

**Enforced by:** CI typecheck; ESLint `no-explicit-any` and `no-unsafe-*` rules with
`--max-warnings 0`; review.

### II. Validate at Every Boundary

Every value entering the system from outside its own memory MUST be parsed by a schema before any
other code observes it. Parsed, not cast. This applies without exception to:

- **Inbound API requests**, using the contract schemas designated by
  [ADR-006](../../adr/ADR-006-api-style-and-type-safety.md).
- **Responses from external APIs**, including government data sources, OCR services and any
  third-party integration. A provider's published types are documentation, not a guarantee.
- **AI and LLM outputs**, before any use whatsoever. See Principle VII.
- **File uploads**, including declared content type, actual sniffed type, size, page or object
  count, and any parsed metadata.
- **Queue message payloads** consumed by the worker.
- **Raw database query results**, per Principle IV.
- **Environment variables and runtime configuration**, at process start. A process MUST fail to
  boot on invalid configuration rather than fail later on the first request that needs it.

Validation failure MUST produce a typed, logged error. It MUST NOT be swallowed, coerced to a
default, or allowed to proceed with partial data.

Schemas MUST be defined once and shared between producer and consumer where both are in this
repository. Duplicated request or response shapes are a defect.

**Rationale.** Every boundary is where an assumption about data shape can be wrong, and this
product's boundaries carry unusually consequential data: a mis-parsed document expiry becomes a
missed passport renewal.

**Enforced by:** contract binding rejects unvalidated handlers at compile time; ESLint rule
restricting raw `JSON.parse` and untyped `fetch` results outside adapter directories; integration
tests asserting malformed input is rejected; review.

### III. Architecture Boundaries Are Enforced, Not Suggested

Bounded contexts, layering and permitted dependency direction are defined by
[`/ARCHITECTURE.md` §5, §6 and §7](../../ARCHITECTURE.md). They are not restated here.

- Code MUST conform to the allowed-edge graph in `/ARCHITECTURE.md` §6.
- A context MUST NOT import another context's `domain/`, repositories, or persistence models.
  Cross-context reads go through a published application port; cross-context writes go through
  events. See `/ARCHITECTURE.md` §7.
- The domain layer MUST NOT import any framework, data-access library, cloud SDK, HTTP client,
  clock or source of randomness.
- Circular dependencies between packages or contexts MUST NOT exist.
- Nothing outside the AI subsystem may depend on the AI subsystem
  ([`/ARCHITECTURE.md` §5.8](../../ARCHITECTURE.md)).
- Changing a context boundary, moving an aggregate between contexts, or changing which context
  owns a table MUST have a new or amended ADR **merged before** the implementation pull request
  is opened. An implementation that arrives first is rejected regardless of quality.

**Rationale.** [ADR-002](../../adr/ADR-002-modular-monolith.md) makes a specific claim, that
contexts remain extractable later. That claim is only true while these rules hold. A modular
monolith degrades into a tangle one convenient import at a time, and each individual import always
looks harmless.

**Enforced by:** `dependency-cruiser` allowed-edge validation and cycle detection in CI;
`eslint-plugin-boundaries` import zones; absence of the relevant dependencies from a package's
`package.json` under the strict linking established by
[ADR-001](../../adr/ADR-001-monorepo-tooling.md); a CI job that builds the API with the AI module
excluded.

### IV. Persistence Goes Through the Data-Access Layer

All persistence MUST use the data-access library and repository layer designated by
[ADR-003: PostgreSQL with Prisma, and the query-builder escape hatch](../../adr/ADR-003-database-orm.md).

- The data-access client MUST NOT be imported, exported or referenced outside the persistence
  package. What that package exposes is repository implementations satisfying port interfaces
  declared in the application layer.
- Raw SQL MUST NOT appear outside the designated query directory inside the persistence package.
  Raw query results MUST be parsed by a schema before leaving that directory, because a raw query
  returns an unverified assertion rather than a checked type.
- Introducing a second data-access library, or exceeding the raw-query threshold defined in
  ADR-003, requires an ADR amendment before implementation.
- Repositories MUST be constructed scoped to a resolved family context. A repository method that
  accepts a tenant identifier as a caller-supplied parameter is a defect, because a parameter can
  be forgotten. See Principle V and `/ARCHITECTURE.md` §9.
- Schema changes MUST ship as reviewed migration files. Destructive changes MUST follow
  expand-and-contract across separate releases. A migration that removes a column in the same
  deployment that stops writing it MUST NOT be merged, because it cannot be rolled back.

**Rationale.** Families cannot re-obtain a lost tenancy agreement or a scanned passport. The
constraints above exist so that no single mistake, in a query or a migration, can destroy or
expose data.

**Enforced by:** `dependency-cruiser` rule restricting the data-access import; ESLint rule
restricting raw query calls by path; migration review as a required checklist item; integration
tests running against a real database.

### V. Every Resource Access Is Authorized at the Object Level (NON-NEGOTIABLE)

Access to any resource identified by an identifier MUST be authorized against the requesting
user's membership and capabilities for the family that owns it. Authentication answers who;
it never answers whether.

- A handler MUST NOT trust an identifier from a path, query, body, header or token claim as
  evidence of entitlement.
- Authorization MUST be applied at every layer defined in
  [`/ARCHITECTURE.md` §9](../../ARCHITECTURE.md). No layer may be treated as sufficient on its
  own, and no layer may be skipped because another one covers it.
- Row-level security MUST remain enabled on every family-scoped table. Disabling it, or adding a
  family-scoped table without it, MUST NOT be merged.
- Code MUST check capabilities, never role strings. Adding a role MUST NOT require editing
  authorization logic.
- Cross-family access attempts MUST return the not-found response, never a forbidden response,
  so that resource existence is not disclosed. The audit log records the real reason.
- Every denial MUST be audited.

**Rationale.** Broken object level authorization is the named top risk for this product. The
realistic failure is not a missing auth system, it is one forgotten condition in one query among
hundreds, which is why redundancy is mandatory rather than encouraged.

**Enforced by:** an API test suite that, for every route accepting an identifier, asserts a
member of another family receives not-found; database policies; review checklist; a CI check that
every family-scoped table has a row-level security policy.

### VI. Children and Family Data Are Sensitive by Default (NON-NEGOTIABLE)

- Personal data MUST NOT be collected unless a specified feature requires it. "It might be useful
  later" is not a purpose. Fields MUST be justified in the feature spec that introduces them.
- Children MUST NOT be modelled as user accounts. They are family member records with no
  credentials and no authentication path, per
  [`/ARCHITECTURE.md` §5.2](../../ARCHITECTURE.md). Granting a minor an account is a deliberate
  command with its own permission model, never a schema side effect.
- Access to a child's record MUST require an active guardianship relationship, not merely family
  membership. Family membership alone MUST NOT grant access to a child's records.
- Every read of a child's record MUST be written to the audit log with actor, subject, purpose
  and result. This is the one place where read access, not only mutation, is logged.
- Personal data MUST NOT be placed in log messages, error payloads, telemetry attributes,
  analytics events, queue message bodies, or exception-tracker context. Identifiers only. A
  consumer needing content fetches it through an authorized read port.
- Documents MUST be encrypted at rest, served only through short-lived scoped signed URLs, and
  every issuance of such a URL MUST be audited, because the URL is itself a bearer credential.
- Analytics MUST measure behaviour, not people. Event properties MUST NOT carry free text a user
  authored, document contents, names, addresses or dates of birth.

**Rationale.** The platform holds children's medical appointments, schools, and nursery
arrangements. That is among the most sensitive category of data a consumer product can hold, and
the default in most systems, where anyone in the tenant sees everything, is not acceptable here.

**Enforced by:** review against the data-minimisation checklist in the feature spec; a logging
adapter that rejects known personal-data field names; audit-log assertions in integration tests
covering child-record access; a CI check that queue payload schemas contain no free-text fields.

### VII. AI Proposes, the Domain Decides (NON-NEGOTIABLE)

The AI subsystem MUST NOT write to the database. There is no exception and no privileged path.

- Every AI output MUST be persisted as a `Proposal` in the AI context, and MUST pass, in order:
  schema validation, domain rules, and authorization, exactly as defined in
  [`/ARCHITECTURE.md` §5.8](../../ARCHITECTURE.md).
- A proposal MUST be applied through the same command handlers that serve HTTP requests. A
  separate write path for AI MUST NOT exist, because it would be a second, less-tested
  implementation of every business rule.
- User confirmation MUST be required for anything irreversible, anything that would be presented
  to the user as fact, anything affecting a child's record, and anything with a real-world
  deadline consequence.
- Extraction results MUST be stored as proposals with a confidence score and a citation to the
  source region. They MUST NOT be written into authoritative fields, and downstream systems,
  including reminder generation, MUST NOT read unconfirmed extractions.
- AI-derived statements presented to users MUST carry their source. Eligibility, entitlement or
  legal information MUST be phrased as something to investigate, never as a determination, and
  MUST link to the official source with its retrieval date. Deterministic rules over a curated
  catalogue, not a model, decide eligibility.
- Every AI action MUST be attributable in the audit log: actor recorded as the AI subsystem
  acting on behalf of a named user, with the proposal identifier, model identifier, prompt
  version and tool invocations.
- Prompts MUST be versioned files in the repository. A prompt change is a reviewable diff and
  MUST have an evaluation run attached.
- AI MUST access family data only through read-only ports scoped to the requesting user's family
  and capabilities. The AI subsystem holds no broader access than the user it acts for.
- Cost and rate limits MUST be enforced per family and per user.

**Rationale.** The product's value depends on families trusting what it tells them. One
hallucinated expiry date silently written into a passport record destroys that trust permanently,
and the family finds out at an airport.

**Enforced by:** the AI package has no dependency on the persistence package; evaluation suites
covering structured-output validity, tool selection, grounding and refusal behaviour, run in CI;
audit-log assertions; review.

### VIII. Asynchronous Work Goes Through the Event System

All background and asynchronous work MUST use the mechanism defined by
[ADR-005: Domain events, transactional outbox, SQS](../../adr/ADR-005-event-system.md).

- A side effect crossing a context or process boundary MUST be published through the transactional
  outbox, written in the same database transaction as the state change that caused it. Publishing
  directly from a request handler MUST NOT be merged.
- Every consumer MUST be idempotent, recording processing in the same transaction as its work. A
  consumer without idempotency is a defect, not a performance concern.
- Every queue MUST have a dead-letter queue, and a message arriving there MUST raise an alert. An
  unattended dead-letter queue is the same silent-loss failure the outbox exists to prevent.
- Event payloads MUST carry identifiers and correlation metadata only, never personal data or
  document content. See Principle VI.
- Scheduled work MUST be inspectable before it runs and explainable after. Fire-and-forget
  scheduling that cannot answer "why did this happen" MUST NOT be introduced.
- Long-running or resource-intensive work MUST NOT execute in the request path.

**Rationale.** The product promises that a family will not forget something. A lost message means
a document is never processed, no expiry is found, no reminder is created, and nothing anywhere
reports an error.

**Enforced by:** ESLint rule restricting queue-client imports to the outbox relay; a base consumer
class that performs the idempotency check by default; an alarm on outbox lag treated as
high-severity; integration tests asserting duplicate delivery is a no-op.

### IX. API Contracts Are Versioned, Shared Artefacts

API contracts MUST follow the style, definition mechanism and versioning approach defined by
[ADR-006: REST API with ts-rest and Zod contracts](../../adr/ADR-006-api-style-and-type-safety.md).

- A request or response shape MUST be defined once, in the contract package, and consumed by both
  server and client. Hand-written duplicates on either side MUST NOT be merged.
- The contract package MUST NOT import domain or application code. The wire language and the
  domain language are permitted to differ, and the domain MUST NOT reach the wire by accident.
- Changes within a published version MUST be additive. A breaking change requires a new version
  served alongside the old until client telemetry shows the old one is drained. Mobile clients
  remain installed for months and MUST keep working.
- Mutating endpoints MUST accept and honour an idempotency key, because mobile clients retry
  aggressively and a duplicated task or double-uploaded document is a visible defect.
- Errors MUST use the standard machine-readable problem format with stable error types, so client
  code can handle them exhaustively.
- Rate limiting MUST be applied per route and per user, with stricter limits on authentication,
  upload and AI endpoints.

**Rationale.** The single strongest reason this is a monorepo is that the contract and both of its
consumers change atomically in one pull request. That benefit is lost the moment a shape is
duplicated by hand.

**Enforced by:** compile failure when a handler returns a shape the contract disallows; a CI check
diffing the generated API document against the previous release and failing on a breaking change
without a version bump; review.

### X. Infrastructure Is Code

All infrastructure MUST be created and changed through the tooling defined by
[ADR-004: Infrastructure as Code with Pulumi](../../adr/ADR-004-infrastructure-as-code.md).

- Manual changes to shared environments, meaning development, staging and production, MUST NOT be
  made. This includes the cloud console, the CLI and any script that is not part of the
  infrastructure program. A manual change that has already happened MUST be reconciled into code
  and the drift reported, not left in place.
- Emergency manual intervention is permitted only during a declared incident, MUST be recorded in
  the incident log, and MUST be reconciled into code within one working day.
- Production applies MUST run in CI, with a preview posted to the pull request and a manual
  approval gate. Local applies to production MUST NOT be performed.
- Stateful resources MUST have deletion protection and MUST be protected against accidental
  replacement.
- Secrets MUST NOT be committed, logged, or passed as build arguments. They are resolved at
  runtime from the designated secret store.
- Environments MUST be isolated. A non-production environment MUST NOT hold real user data, and
  MUST NOT hold credentials that can reach production.
- Infrastructure values consumed by the application, such as queue and bucket identifiers, MUST
  flow from stack outputs, never be transcribed by hand.

**Rationale.** Reproducibility is the requirement. An environment that cannot be rebuilt from the
repository is an environment that cannot be recovered.

**Enforced by:** drift detection on a schedule, reported as a failure; branch protection requiring
approval on the infrastructure workflow; secret scanning in CI; infrastructure unit tests
asserting security invariants such as the document bucket denying public access.

### XI. Deletion and Export Are Designed, Not Retrofitted

Every feature specification MUST state, before implementation begins:

1. What personal data the feature stores, and the purpose that justifies each field.
2. What happens to that data when a family member's account is deleted.
3. What happens to that data when a whole family is erased.
4. How that data appears in a user's data export.
5. The retention period after which it is removed even without a deletion request.

A specification missing any of these five is incomplete and MUST NOT proceed to implementation.

- Every bounded context MUST implement the erasure ports described in
  [`/ARCHITECTURE.md` §5.12](../../ARCHITECTURE.md). A new context is not complete without them.
- A context MUST NOT hold personal data outside its own declared tables, because data the erasure
  saga cannot reach cannot be erased.
- Deletion of a member and erasure of a family are different operations with different outcomes
  and MUST NOT be conflated.
- An erasure that does not complete within its service level MUST raise an alert and MUST be
  treated as a compliance incident, not a failed job.
- Backup retention limits MUST be stated honestly in the privacy policy, and any restore MUST
  replay pending erasures.

**Rationale.** UK GDPR erasure is only real if every context can be reached. Retrofitting that
across a mature codebase is a large, error-prone change, and the failure is discovered at the
worst possible moment, which is when a user exercises the right.

**Enforced by:** a CI check that every registered context implements the erasure ports; the
feature spec template requiring these five answers; an end-to-end test asserting that after
erasure no row in any context references the erased subject.

## Additional Engineering Constraints

**UK-first without being UK-welded.** No context outside the reference context may store a
UK-shaped primitive. Councils, jurisdictions, holidays and government services are referenced by
identifier, not by name string. Money MUST be an amount in minor units with a currency code, never
a bare number. Timestamps MUST be stored in UTC with time zone, and anything a user sees a date
for MUST also record the time zone it was authored in.

**Observability is part of the feature, not a follow-up.** Structured logs with correlation
identifiers, metrics for anything with a service level, and traces across the request, outbox,
queue and worker path. A feature that cannot answer "what happened" for a specific user's specific
action is not finished. The oldest unpublished outbox row is the single most important operational
metric and MUST be alerted on.

**Testing weight follows risk.** The majority of tests MUST be fast unit tests over pure domain
logic, which is possible only because the domain layer has no I/O. Integration tests MUST run
against a real database, not a mock, because row-level security and constraints are the thing
being verified. Authorization MUST have dedicated tests per route. AI behaviour MUST have
evaluation suites, and a prompt change without one MUST NOT be merged. Tests MUST NOT be weakened,
skipped or deleted to make a pipeline pass.

**New external dependencies are decisions.** Adding a runtime dependency requires justification in
the pull request covering what it does, why it is not written in-house, its maintenance status and
its licence. Adding an external *service*, meaning anything that receives our data, requires an
ADR and a privacy review before use.

**Cost is a design constraint.** Prefer boring, predictable infrastructure. Design for scale, spend
like a startup. A component MUST NOT be provisioned before the trigger that justifies it, and the
triggers are recorded in the relevant ADR.

## Development Workflow and Quality Gates

**Merge gates.** Continuous integration MUST block merge on failure of any of:

| Gate | Blocks merge |
|---|---|
| Typecheck, strict mode, zero errors | Yes |
| Lint, zero warnings | Yes |
| Boundary and cycle validation | Yes |
| Unit tests | Yes |
| Integration tests against a real database | Yes |
| Contract and API tests, including cross-family authorization assertions | Yes |
| Security scan: dependency vulnerabilities and secret scanning | Yes |
| Infrastructure validation and preview | Yes |
| Build of all applications | Yes |

Gates MUST NOT be bypassed. If a gate is wrong, fix the gate in its own pull request.

**When an ADR is required.** Before implementation, an ADR MUST exist for any change that:

- alters a bounded context boundary, or moves an aggregate between contexts;
- changes which context owns a table or a category of data;
- introduces a new external dependency that receives our data;
- introduces or replaces a foundational technology;
- changes a security, privacy or authorization control;
- contradicts an existing ADR.

An ADR is not required for library choices confined to one module, or refactors that preserve
boundaries. When in doubt, the pull request author MUST ask rather than assume, and a reviewer MAY
require an ADR before further review.

**Definition of done.** A feature is done when its specification is written and includes the five
deletion and export answers from Principle XI; the architecture impact is reviewed and any required
ADR is merged; the implementation conforms to the boundaries in `/ARCHITECTURE.md`; types are
strict with no exceptions beyond those documented per Principle I; boundaries are validated; tests
exist at the layers the risk warrants; authorization is tested per route; observability is in
place; documentation and specifications are updated; and every gate above passes. A working user
interface is not a definition of done.

**AI coding agents.** Agents working in this repository MUST read this constitution, the relevant
specifications and `/ARCHITECTURE.md` before modifying code. Agents MUST NOT invent architecture,
bypass specifications, weaken or delete tests to make a pipeline pass, introduce `any`, modify
infrastructure without the review path in Principle X, or proceed past a change that requires an
ADR. An agent that identifies a needed ADR MUST stop and say so rather than implement around it.
The repository, not conversational history, is the source of truth, so an agent replaced by
another agent MUST be able to continue from these documents alone.

## Governance

**Authority.** This constitution supersedes team habit, individual preference and prior practice.
Where it is silent, `/ARCHITECTURE.md` and the ADRs govern. Where all three are silent, the
decision belongs in a pull request discussion and, if it meets the criteria above, an ADR.

**Amendment procedure.** An amendment MUST be proposed as a pull request that states the rationale,
the principles added, changed or removed, the resulting version, and the migration expectation for
existing code. Amendments MUST be reviewed by a maintainer. An amendment MUST NOT be bundled with
a feature change.

**Versioning policy.** Semantic versioning applies to this document:

- **MAJOR** for removing or redefining a principle in a way that makes previously compliant code
  non-compliant, or for a backward-incompatible governance change.
- **MINOR** for adding a principle or a section, or materially expanding an obligation.
- **PATCH** for clarification, wording and non-semantic refinement.

**Retroactivity.** An amendment does not retroactively invalidate specifications or features
already implemented under a previous version. It MUST instead flag them for review: the amending
pull request MUST list the specifications and modules affected, and each MUST be assessed and
either brought into compliance or granted a recorded, time-bound exception. An exception without an
expiry MUST NOT be granted.

**Compliance review.** Every pull request is reviewed against this constitution, and a reviewer MAY
block on a violation alone. Automated gates cover what they can, and their coverage is deliberately
incomplete: the gates catch the mechanical violations so that review attention goes to the
judgement-dependent ones, particularly Principles V, VI, VII and XI. Compliance is reviewed in full
at each phase boundary of the roadmap, and any principle that is routinely worked around is either
wrong and MUST be amended, or under-enforced and MUST gain a gate. A principle nobody follows and
nobody changes is worse than no principle.

**Version**: 1.0.0 | **Ratified**: 2026-09-08 | **Last Amended**: 2026-09-08
