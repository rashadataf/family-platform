# ADR-006: REST API with ts-rest and Zod contracts

- **Status:** Accepted
- **Date:** 2026-09-08
- **Deciders:** Principal Engineer

## Context

Two coupled decisions: the API style (REST or GraphQL), and the mechanism that keeps the Expo client and the NestJS server in agreement about types.

The stated preference is REST unless there is a strong reason otherwise, and the stated principle is "define once, validate at boundaries, share types safely", with OpenAPI-generated clients, Zod, ts-rest, NestJS Swagger and shared domain contracts listed as candidates.

The API style decision is straightforward and REST is correct. The type-safety decision is not straightforward, and the conventional NestJS answer is rejected.

Requirements that should decide it:

1. **Mobile clients live in the wild for months.** A user on version 1.2 must keep working against a server that has moved on. The wire contract must be explicitly versioned, not inferred.
2. **Family isolation is the top security risk.** Every authorization surface must be small and auditable ([ARCHITECTURE.md §9](../ARCHITECTURE.md)).
3. **No duplicated request and response interfaces.** Stated directly in the blueprint.
4. **Runtime validation plus compile-time safety at every boundary.** Also stated directly.
5. **The dashboard needs one round trip.** A home screen assembled from six requests over a poor mobile connection is a worse product.
6. **Third parties may consume this later**, so machine-readable API documentation must be producible.

## Decision

**REST over HTTP/JSON. Contracts defined once as Zod schemas in `packages/contracts`, bound with ts-rest, consumed by both the NestJS server and the Expo client. OpenAPI is generated from those contracts for documentation, not used as the source of truth.**

- Path versioning at `/v1`. Contracts are versioned per namespace.
- Additive-only changes within a version. Anything breaking is `/v2`, running alongside until client telemetry shows the old version is drained.
- Clients send `X-Client-Version`; the server can degrade or refuse deliberately, and the field appears in telemetry.
- `@ts-rest/nest` on the server, so a controller that returns a shape the contract does not allow is a compile error.
- `@ts-rest/react-query` on the client, giving typed TanStack Query hooks with no code generation step.
- `@ts-rest/open-api` emits an OpenAPI 3.1 document in CI, published for documentation and future external consumers.
- **`packages/contracts` never imports `packages/core`.** The wire language and the domain language are allowed to differ, and the domain must never leak to the wire by accident.

## Why REST, and specifically why not GraphQL

GraphQL is not rejected out of preference. It is rejected on one product-specific argument that outweighs its genuine advantages here.

### The deciding argument: authorization surface

GraphQL's value is that a client can traverse the graph and request arbitrary shapes. In a product whose primary security risk is one family reaching another family's data, that flexibility is a direct cost. Every edge in the schema is a path a client can take, so authorization must be enforced at every resolver on every edge, and the auditable surface is the set of all traversable paths rather than the set of endpoints.

Consider `family → members → child → documents → extractionResults`. In REST that is a small number of endpoints, each with an explicit guard, each individually testable, and the complete set enumerable by reading the router. In GraphQL, an extended family member restricted from a child's records must be blocked at the `child.documents` resolver, and if a new edge is added anywhere that reaches documents by another route, the restriction has to be re-established there too. Field-level authorization is a solved problem in the sense that patterns exist, and it is unsolved in the sense that it is very easy to get wrong once and leak everything.

[ARCHITECTURE.md §9](../ARCHITECTURE.md) builds five layers of defence against exactly this. GraphQL would widen the surface those layers must cover, for benefits obtainable another way.

### Supporting arguments

**The strongest case for GraphQL here is the dashboard, and one endpoint solves it.** Aggregating today's events, upcoming items, urgent tasks, expiring documents and alerts is a textbook over-fetching problem. `GET /v1/families/:id/dashboard` returns exactly that in one round trip, is trivially cacheable, has one authorization check, and has predictable performance. Requirement 5 is satisfied without adopting a query language.

**Predictable performance.** Server-defined responses mean query cost is known at development time. GraphQL requires DataLoader for N+1, depth and complexity limiting to prevent denial of service, and persisted queries to make either of those tractable, and all three become mandatory once the API is public.

**HTTP semantics work.** Caching, conditional requests, status codes, CDN behaviour, WAF rules and rate limiting per route all function normally. GraphQL routes everything through one `POST /graphql`, so per-operation rate limiting must be rebuilt in application code, which matters given the abuse-prevention requirement.

**Client complexity.** TanStack Query over REST is a cache keyed by URL. Apollo or urql with a normalised cache is significantly more machinery, and normalised-cache invalidation bugs on mobile are unpleasant to diagnose.

**Where GraphQL would win, and does not here.** Many heterogeneous clients with divergent data needs, a public API for third-party developers, or a federation across many teams' services. We have one client, one team and one service.

**If a web app arrives later**, it will have similar needs to the mobile app and the same contract serves it. That does not change the calculus.

## Why not the conventional NestJS type-safety stack

The default NestJS approach is class-validator DTOs decorated with `@ApiProperty`, an OpenAPI document generated from those decorators, and a client generated from the OpenAPI document. This is rejected, and it is the main thing this ADR argues against.

**It maintains two type systems that drift.** A class-validator DTO expresses validation in decorators and types in TypeScript annotations, and nothing connects them. `@IsString() name: number` compiles. There is no inference from validators to types, so the runtime and compile-time halves of requirement 4 are asserted separately and can disagree silently.

**Discriminated unions are barely expressible.** The blueprint's TypeScript philosophy calls for discriminated unions and exhaustive checking. class-validator handles them poorly, requiring `@ValidateNested` with type-discriminator plumbing that is verbose and easy to get wrong. Zod expresses `z.discriminatedUnion` natively and infers the union type exactly.

**The OpenAPI document is derived from decorators, so it is a lossy reflection.** `@ApiProperty` is annotation on top of annotation, is routinely forgotten, and drifts from actual behaviour. Generating a client from a lossy document produces types that are confidently wrong, which is worse than no types.

**Codegen adds a step that goes stale.** A generation step means a moment when someone forgets to run it, or runs it against a stale server. ts-rest has no generation step for the client: the contract is a TypeScript value that both sides import, so a mismatch is a compile error in the same pull request.

**Generated types lose refinements.** OpenAPI cannot express "a UK postcode matching this pattern", "an ISO 8601 date in the future", or "at most 20 items, each unique". Zod can, and those refinements run on both sides, so the client can validate before making a request.

## Alternatives considered

### tRPC — rejected, and requirement 1 is the reason

tRPC has the best developer experience of the candidates. It is rejected on a specific structural point.

tRPC's model is that types flow from the server implementation to the client by inference. That is exactly right when the client is deployed with the server, as in a Next.js application. It is wrong when the client is an app installed on a phone that the user may not update for six months. There is no versioned artefact, only "whatever the server's types are right now", so the contract that version 1.2 of the app was built against no longer exists anywhere once the server moves on. Maintaining two supported versions means maintaining two router trees with no explicit contract distinguishing them.

Secondary: tRPC is RPC over HTTP with no meaningful OpenAPI story, which fails requirement 6, and its procedure-based batching interacts awkwardly with per-route rate limiting and WAF rules.

ts-rest keeps tRPC's core benefit, a shared TypeScript contract with no code generation, while making the contract an explicit, versionable artefact rather than an inference from the current implementation.

### OpenAPI-first with generated clients — rejected as the source of truth, retained as an output

Writing an OpenAPI YAML file first and generating both server stubs and clients is a legitimate and well-supported approach, and it is the right one for a multi-language, multi-team API.

Rejected here because both sides are TypeScript, so translating through a lowest-common-denominator schema language loses expressiveness (requirement 4's refinements) and adds a generation step to every change, for a portability benefit we do not need. Generating OpenAPI *from* the Zod contracts keeps requirement 6 satisfied without paying that cost.

### Zod alone, with hand-written client functions — rejected

Zod schemas in a shared package with hand-written fetch wrappers is the minimal option and it works. Rejected because the binding between route, method, path parameters, query, body and response is then maintained by hand on both sides, which is exactly the duplication requirement 3 prohibits. ts-rest is a thin layer that makes that binding a single typed object.

### Risk of ts-rest specifically

ts-rest is a smaller project than NestJS or tRPC, so maintenance risk is real and should be recorded.

The mitigation is structural rather than optimistic. The valuable artefact is the set of Zod schemas, which are plain data with no ts-rest dependency. ts-rest contributes the route binding, the Nest decorator and the client wrapper, which together are a small surface. If it were abandoned, the schemas survive unchanged and the replacement work is the route binding, measured in days. This is why the contract is defined as Zod schemas composed into a ts-rest contract, rather than as ts-rest-native definitions.

## API conventions this fixes

- **Errors.** RFC 9457 `application/problem+json`, with a stable machine-readable `type` per error class. Typed error unions in `packages/contracts`, so client code can exhaustively handle them.
- **404 rather than 403 for cross-family access**, so resource existence is not disclosed. The audit log records the real reason ([ARCHITECTURE.md §9](../ARCHITECTURE.md)).
- **Pagination.** Cursor-based for anything time-ordered or unbounded. Offset pagination is permitted only for small bounded admin lists.
- **Idempotency.** `Idempotency-Key` required on all non-GET mutations. The key, request hash and response are stored, and a replay returns the original response. This matters specifically because mobile clients retry aggressively on flaky connections, and a duplicated task or a double-uploaded document is a visible defect.
- **Rate limiting.** Per route and per user, stricter on authentication, document upload and AI endpoints. Enforced at the ALB and WAF where possible, and in application middleware where the decision needs identity.
- **Response validation.** Enforced in development and staging, sampled in production. Catching a contract violation in CI is the point; validating every production response is a cost with diminishing returns.
- **No domain leakage.** Contracts never import `packages/core`. The mapping from application DTOs to wire shapes is explicit in `apps/api`. This is deliberate boilerplate: it is what allows an aggregate to be refactored without breaking an app already installed on a phone.

## Consequences

### Positive

- One definition per endpoint produces the server types, the client types, the runtime validation on both sides, and the OpenAPI document.
- A contract violation is a compile error in the same pull request, not a runtime failure in a mobile session.
- Zod refinements run on the client, so obvious invalid input never reaches the network.
- The complete API surface is enumerable by reading one package, which makes the security review of requirement 2 tractable.
- No code generation step to forget.

### Negative

- **Explicit mapping between wire contracts and application DTOs is boilerplate.** Accepted deliberately, as the price of being able to change the domain without breaking deployed clients.
- **ts-rest ecosystem risk.** Mitigated structurally, as described above.
- **Zod schemas have a bundle-size cost on mobile.** Real but modest. Mitigation: contracts are tree-shakeable per namespace, and this is measured in the mobile bundle-size CI check rather than assumed.
- **Aggregate endpoints can proliferate.** The dashboard endpoint is a deliberate exception to resource REST, and exceptions breed. Mitigation: any additional aggregate endpoint requires explicit justification in the pull request.
- **Versioning discipline is now manual.** No tool will tell us a change is breaking. Mitigation: a CI check diffing the generated OpenAPI document against the previous release and failing on a breaking change without a version bump.

### Revisit this decision when

- A public third-party API is planned, where GraphQL or a formally specified OpenAPI-first contract becomes worth reconsidering, or
- More than three materially different client types exist with divergent data needs, or
- Dashboard-style aggregate endpoints exceed roughly five, which would indicate the client genuinely needs to shape its own queries.
