---

description: "Task list template for feature implementation"
---

# Tasks: Identity and Access

**Input**: Design documents from `/specs/006-identity-access/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/identity-api.md](contracts/identity-api.md),
[quickstart.md](quickstart.md) — all present. [ADR-007](../../adr/ADR-007-authentication.md) and the
`ARCHITECTURE.md` §8 correction are merged, closing plan.md's two gating items.

**Tests**: Included throughout, not optional here. The constitution requires it directly: "the
majority of tests MUST be fast unit tests over pure domain logic," "integration tests MUST run
against a real database," and "authorization MUST have dedicated tests per route" — the last of
those is also spec 006's own closure of the constitution's open merge-gate row (research.md §9).

**Organization**: Grouped by user story (spec.md's P1–P4), so each is independently implementable
and testable. This feature also has to stand up the package skeleton (`kernel`, `core`, `contracts`,
`platform`, `apps/worker`) every later bounded context will reuse — that work is Setup and
Foundational, and it is the reason this feature is larger than four user stories suggest (plan.md's
Summary says so directly).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4, mapped to spec.md's priorities (P1–P4)
- Every task names an exact file path

## Path Conventions

Paths follow plan.md's Project Structure exactly:

- `packages/kernel/src/` — pure, dependency-free primitives
- `packages/core/identity/{domain,application}/` — the bounded context itself
- `packages/contracts/src/v1/identity.contract.ts` — the wire boundary (ADR-006)
- `packages/platform/src/` — infrastructure adapters
- `packages/persistence/{prisma,src/repositories/identity}/` — schema and repository implementations
- `apps/api/src/identity/` — controllers, the session guard, DI wiring
- `apps/worker/src/sweeps/` — retention sweeps only (research.md §5)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the five workspace packages this feature must create before any code can be
written, and register them everywhere `scripts/verify-workspace-packages.ts` requires (Dockerfile,
Compose, `.dependency-cruiser.cjs`) — ADR-014's own rule that a required duplication must be guarded
by a check, not a comment.

- [ ] T001 [P] Create `packages/kernel` (`package.json` name `@fp/kernel`, `tsconfig.json`,
      `tsconfig.build.json`, `eslint.config.js`), mirroring `packages/persistence`'s non-Prisma parts.
      No runtime dependencies — pure and dependency-free per research.md §6.
- [ ] T002 [P] Create `packages/core` (`package.json` name `@fp/core`, depending on `@fp/kernel` via
      `workspace:*`, `tsconfig.json`, `eslint.config.js`). This single package will hold every
      bounded context, `identity` first, per `ARCHITECTURE.md` §8.
- [ ] T003 [P] Create `packages/contracts` (`package.json` name `@fp/contracts`, dependencies `zod`
      and `@ts-rest/core`, `tsconfig.json`, `eslint.config.js`).
- [ ] T004 [P] Create `packages/platform` (`package.json` name `@fp/platform`, dependencies
      `@node-rs/argon2` and an SMTP client, depending on `@fp/kernel` via `workspace:*`,
      `tsconfig.json`, `eslint.config.js`).
- [ ] T005 [P] Create `apps/worker` (`package.json` name `@fp/worker`, `@nestjs/common` +
      `@nestjs/core` matching `apps/api`'s versions, workspace dependencies on `@fp/persistence`,
      `@fp/core`, `@fp/kernel`, `@fp/platform`; `tsconfig.json`, `eslint.config.js`) with a minimal
      `apps/worker/src/main.ts` bootstrapping a standalone NestJS application context (no HTTP
      listener — ADR-002 scopes this host to queue consumers and scheduled sweeps).
- [ ] T006 Register `packages/kernel`, `packages/core`, `packages/contracts`, `packages/platform`,
      and `apps/worker` in `.dependency-cruiser.cjs`'s `WORKSPACE_GRAPH`, per `ARCHITECTURE.md` §6's
      layer rules: `kernel: []`; `core: ['packages/kernel']`; `contracts: []` (contracts doc: "imports
      nothing from domain/ or application/"); `platform: ['packages/kernel']`; `apps/worker:
      ['packages']` (a composition root, like `apps/api`).
- [ ] T007 Add a `COPY <pkg>/package.json` line for each of the five new packages to
      `apps/api/Dockerfile`'s `deps` stage, alongside the existing five.
- [ ] T008 Add a named `node_modules` volume for each new package to `docker-compose.yml`'s
      `volumes:` block, mount them on a new `worker` service (`build.dockerfile:
      apps/worker/Dockerfile`, `target: development`, bind-mounted source, `depends_on.migrate:
      condition: service_completed_successfully`), matching the `api` service's pattern.
- [ ] T009 Create `apps/worker/Dockerfile`, mirroring `apps/api/Dockerfile`'s `base` → `deps` →
      `development` → `build` → `runtime` stages (no `migrator` target — `apps/api`'s already owns
      migrations).
- [ ] T010 Add a `mailpit` service to `docker-compose.yml` (image `axllent/mailpit`, SMTP on `1025`,
      web UI on `8025`), the Stage 0 mail sink per research.md §4. No environment variables yet —
      those are wired in T021 alongside the adapter that actually uses them.
- [ ] T011 Run `pnpm install` to lock the five new workspace packages, then run
      `pnpm verify:workspace` and confirm it passes.

**Checkpoint**: Five empty-but-wired packages exist, pass the workspace-declaration check, and build
under Docker Compose. No identity code yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The primitives, schema, adapters and scaffolding every user story needs. Nothing here
is identity-specific business logic — it is what makes writing that logic possible.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T012 [P] Implement `Result<T, E>` (ok/err constructors and combinators) in
      `packages/kernel/src/result.ts`.
- [ ] T013 [P] Implement branded-id helpers and `UserId`, `SessionId`, `DeviceId` in
      `packages/kernel/src/branded-id.ts`.
- [ ] T014 [P] Implement the domain error taxonomy in `packages/kernel/src/errors.ts` — a base
      `DomainError` plus the specific errors later commands raise (`EmailAlreadyRegistered`,
      `WeakPassword`, `InvalidCredentials`, `AccountNotVerified`, `SessionInvalid`,
      `VerificationInvalid`).
- [ ] T015 [P] Define the `Clock` port (`now(): Date`, no implementation) in
      `packages/kernel/src/clock.port.ts`.
- [ ] T016 [P] Export the public surface from `packages/kernel/src/index.ts` and add
      `packages/kernel/src/result.spec.ts` asserting `Result`'s ok/err behaviour.
- [ ] T017 Author `User`, `Session`, `Device`, `EmailVerification`, and `OutboxEvent` in
      `packages/persistence/prisma/schema.prisma` exactly per data-model.md (citext email with a
      unique index on the normalised form; `token_hash`/`previous_token_hash` as indexed `bytea`;
      `outbox_event` with no foreign key to `user`), then run
      `pnpm --filter @fp/persistence exec prisma migrate dev` to generate the migration.
- [ ] T018 Implement `packages/platform/src/argon2-password-hasher.ts` (a `PasswordHasherPort`
      implementation via `@node-rs/argon2`) and `packages/platform/src/argon2-password-hasher.spec.ts`.
      Parameters are placeholders here — T090 tunes and records them against the real VPS.
- [ ] T019 [P] Implement `packages/platform/src/random-token-generator.ts` — a `TokenGeneratorPort`
      producing a 256-bit opaque token plus a SHA-256 hash helper, used for both session and
      verification tokens (research.md §3) — and its spec.
- [ ] T020 [P] Implement `packages/platform/src/system-clock.ts` (the `Clock` port's real
      implementation) and its spec.
- [ ] T021 Implement `packages/platform/src/smtp-mailer.ts` (a `MailerPort` implementation against
      Mailpit's SMTP endpoint) and its spec (fake transport, no real network). Add `MAIL_HOST` /
      `MAIL_PORT` to `.env.example` and `apps/api/src/config/env.schema.ts`, and confirm
      `pnpm verify:env` passes.
- [ ] T022 Define the application-layer ports in `packages/core/identity/application/ports/`:
      `user.repository.ts`, `session.repository.ts`, `device.repository.ts`,
      `email-verification.repository.ts`, `password-hasher.port.ts`, `token-generator.port.ts`,
      `mailer.port.ts`, `outbox.port.ts` — interfaces only.
- [ ] T023 Implement `packages/persistence/src/repositories/identity/outbox.repository.ts` (writes an
      `OutboxEvent` row inside the caller's own Prisma transaction, satisfying `OutboxPort`) and
      `outbox.repository.integration.spec.ts` against real PostgreSQL.
- [ ] T024 Scaffold `packages/contracts/src/v1/identity.contract.ts`: the shared `email` schema
      (trimmed, lowercased — FR-022) and `password` schema (minimum-strength refinement — FR-004),
      the machine-readable problem/error schema carrying a stable `type`, and an empty ts-rest router.
- [ ] T025 Scaffold `apps/api/src/identity/identity.module.ts` and an empty
      `apps/api/src/identity/identity.controller.ts`, wired into `apps/api/src/app.module.ts`, with DI
      providers for the kernel `Clock` and the platform adapters (hasher, token generator, mailer,
      outbox) built in T018–T021 and T023.
- [ ] T026 Implement story-agnostic rate-limiting infrastructure (a reusable guard/interceptor
      factory taking a key strategy and a limit) in `apps/api/src/common/rate-limit.guard.ts`, per
      contracts/identity-api.md's Rate limiting table. Each story wires its own routes to it later.
- [ ] T027 Run `pnpm boundaries`, `pnpm lint`, and `pnpm typecheck` across the five new packages now
      that they contain real files and real imports, and fix any `WORKSPACE_GRAPH` or
      `boundaries.js` gap the Setup phase's declarations missed.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Create an account (Priority: P1) 🎯 MVP

**Goal**: FR-001–FR-005, FR-003a, FR-020, and the `UserRegistered` slice of FR-017/FR-018/FR-022 —
register, verify, resend, and the retention sweep for a registration that never completes.

**Independent Test**: Submit a new email and password; confirm an account exists in
`pending_verification`, a `UserRegistered` row lands in `outbox_event`, and a verification message
appears in Mailpit. Verify it, then confirm re-registering the same email (any casing) is rejected
without revealing why.

### Tests for User Story 1

- [ ] T028 [P] [US1] Unit test for the shared `email`/`password` Zod schemas (normalisation,
      strength refinement) in `packages/contracts/src/v1/identity.contract.spec.ts`.
- [ ] T029 [P] [US1] Integration test for `POST /v1/identity/registrations` — happy path, duplicate
      email (any status) rejected without disclosing why, weak password rejected with a specific
      reason — in `apps/api/src/identity/registration.integration.spec.ts`.
- [ ] T030 [P] [US1] Integration test for `POST /v1/identity/verifications` and
      `.../verifications/resend` — resend invalidates the prior link (FR-003a), authentication before
      verification is rejected — in `apps/api/src/identity/verification.integration.spec.ts`.
- [ ] T031 [P] [US1] Unit test for the `User` aggregate's registration/verification state machine in
      `packages/core/identity/domain/user.aggregate.spec.ts`.
- [ ] T032 [P] [US1] Integration test for the `erase-unverified` sweep — deletes a registration past
      30 days unverified, is a no-op on rerun — in
      `apps/worker/src/sweeps/erase-unverified.sweep.integration.spec.ts`.

### Implementation for User Story 1

- [ ] T033 [P] [US1] Implement the `EmailAddress` value object (case-insensitive normalisation,
      FR-022) in `packages/core/identity/domain/email-address.vo.ts`.
- [ ] T034 [US1] Implement the `User` aggregate (register, verify, status enum) in
      `packages/core/identity/domain/user.aggregate.ts` (depends on T033).
- [ ] T035 [P] [US1] Implement the `EmailVerification` entity (token hash, expiry, consumed/superseded)
      in `packages/core/identity/domain/email-verification.entity.ts`.
- [ ] T036 [US1] Define `UserRegistered` in `packages/core/identity/domain/events.ts`.
- [ ] T037 [US1] Implement the `RegisterUser` command handler in
      `packages/core/identity/application/commands/register-user.command.ts`: checks uniqueness
      across every status (FR-002), hashes the password, creates `User` + `EmailVerification`, writes
      `UserRegistered` to the outbox, and sends the verification email — one transaction.
- [ ] T038 [P] [US1] Implement `VerifyEmail` in
      `packages/core/identity/application/commands/verify-email.command.ts`.
- [ ] T039 [P] [US1] Implement `ResendVerification` (supersedes the previous token, FR-003a) in
      `packages/core/identity/application/commands/resend-verification.command.ts`.
- [ ] T040 [US1] Implement `packages/persistence/src/repositories/identity/user.repository.ts` and
      `email-verification.repository.ts` against the T017 schema.
- [ ] T041 [US1] Register `POST /v1/identity/registrations`, `POST /v1/identity/verifications`, and
      `POST /v1/identity/verifications/resend` in `identity.contract.ts`, with the
      `identity/email_unavailable`, `identity/weak_password`, and `identity/verification_invalid`
      error types.
- [ ] T042 [US1] Implement the three route handlers in `identity.controller.ts`, honouring the
      `Idempotency-Key` header on registration (Principle IX).
- [ ] T043 [US1] Wire T026's rate limiter: per-source on registration, per-account on resend.
- [ ] T044 [US1] Add structured logging (UserId + correlation id, never the email) for registration
      and verification outcomes.
- [ ] T045 [US1] Implement `apps/worker/src/sweeps/erase-unverified.sweep.ts` (FR-020, 30 days,
      idempotent, driven by the injected `Clock`).

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Authenticate and start a session (Priority: P2)

**Goal**: FR-006–FR-009, the `UserAuthenticated` slice of FR-017, and FR-023's guard — login, device
association, throttling, and the first authenticated route (`GET /v1/identity/sessions`), which is
also this story's proof that a session is actually usable.

**Independent Test**: Register (US1), authenticate with the same credentials, confirm a session is
issued and a `UserAuthenticated` row lands in the outbox, then use that session to call
`GET /v1/identity/sessions` successfully.

### Tests for User Story 2

- [ ] T046 [P] [US2] Integration test for `POST /v1/identity/sessions` — happy path; wrong password
      and unknown email produce an identical status/type/body (FR-007, SC-003); repeated failures
      throttle regardless of a later attempt's correctness (FR-008); an unverified account is
      rejected — in `apps/api/src/identity/sessions.integration.spec.ts`.
- [ ] T047 [P] [US2] Integration test for `GET /v1/identity/sessions` — a user sees only their own
      sessions (authorization matrix) — in the same file.
- [ ] T048 [P] [US2] Unit test for `Session` issuance and its `Device` association in
      `packages/core/identity/domain/session.aggregate.spec.ts`.

### Implementation for User Story 2

- [ ] T049 [P] [US2] Implement the `Session` aggregate (issue, stable `SessionId`, token hash,
      absolute expiry) in `packages/core/identity/domain/session.aggregate.ts`.
- [ ] T050 [P] [US2] Implement the `Device` entity (label, first/last seen — deliberately minimal per
      FR-009) in `packages/core/identity/domain/device.ts`.
- [ ] T051 [US2] Define `UserAuthenticated` in `events.ts`.
- [ ] T052 [US2] Implement `AuthenticateUser` in
      `packages/core/identity/application/commands/authenticate-user.command.ts`: runs the hasher's
      verify step even for an unknown email to close the timing side channel (SC-003), enforces
      FR-008's throttle, creates/associates a `Device`, issues a `Session`, writes `UserAuthenticated`
      to the outbox.
- [ ] T053 [P] [US2] Implement `ListSessions` in
      `packages/core/identity/application/queries/list-sessions.query.ts`.
- [ ] T054 [US2] Implement `packages/persistence/src/repositories/identity/session.repository.ts` and
      `device.repository.ts`.
- [ ] T055 [US2] Implement `apps/api/src/identity/session.guard.ts` — the FR-023 check: hash the
      presented bearer token, look up the session, reject if revoked, expired, or the owning
      account is deleted, as a single indexed lookup (research.md §8's <5ms budget).
- [ ] T056 [US2] Register `POST /v1/identity/sessions` and `GET /v1/identity/sessions` in
      `identity.contract.ts`, with `identity/invalid_credentials`, `identity/not_verified`, and
      `identity/throttled`.
- [ ] T057 [US2] Implement the two route handlers in `identity.controller.ts`, applying
      `session.guard.ts` to the `GET` route.
- [ ] T058 [US2] Wire T026's rate limiter on login: per-source and per-account, the strictest limit
      in the table.
- [ ] T059 [US2] Add structured logging and metrics for authentication success/failure rate and
      throttle activations.

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - Stay signed in without re-entering credentials (Priority: P3)

**Goal**: FR-010–FR-013 — renewal (rotation), replay detection, per-session revocation, and the
absolute session lifetime.

**Independent Test**: Authenticate (US2), renew to get a fresh credential, confirm the prior one is
dead; separately, revoke one of two active sessions and confirm only that one stops working.

### Tests for User Story 3

- [ ] T060 [P] [US3] Integration test: renewal issues a fresh credential and invalidates the prior
      one, in `apps/api/src/identity/renewal.integration.spec.ts`.
- [ ] T061 [P] [US3] Integration test: presenting a superseded credential is rejected AND revokes the
      whole session lineage, asserting `revoked_reason = replay_detected` (FR-011, quickstart
      Scenario 3) — in `apps/api/src/identity/replay-detection.integration.spec.ts`.
- [ ] T062 [P] [US3] Integration test: revoking one session by its stable id leaves the user's other
      sessions working, and the same id still revokes correctly after further rotations (spec.md
      clarification 2) — in `apps/api/src/identity/revocation.integration.spec.ts`.
- [ ] T063 [P] [US3] Integration test: revoking another user's session id returns 404, not 403
      (identity-api.md's Authorization matrix) — in the same file.
- [ ] T064 [P] [US3] Integration test: a session past its absolute lifetime cannot be renewed
      (FR-013) — in `renewal.integration.spec.ts`.
- [ ] T065 [P] [US3] Unit test for `Session`'s `rotate`/`revoke`/replay-detection state machine,
      extending `session.aggregate.spec.ts`.

### Implementation for User Story 3

- [ ] T066 [US3] Extend the `Session` aggregate with `rotate()`, `revoke(reason)`, and replay
      detection against `previous_token_hash`, in `session.aggregate.ts`.
- [ ] T067 [US3] Implement `RenewSession` (FR-010, FR-013's absolute-lifetime check) in
      `packages/core/identity/application/commands/renew-session.command.ts`.
- [ ] T068 [US3] Implement `RevokeSession` (FR-012, ownership check returns not-found rather than
      forbidden) in `packages/core/identity/application/commands/revoke-session.command.ts`.
- [ ] T069 [US3] Extend `session.repository.ts` with the lookups and atomic updates rotation and
      revocation need (by current hash, by previous hash, revoke-lineage).
- [ ] T070 [US3] Register `POST /v1/identity/sessions/current/renewal` and
      `DELETE /v1/identity/sessions/{sessionId}` in `identity.contract.ts` — no idempotency key on
      renewal, per contracts/identity-api.md — sharing `identity/session_invalid`.
- [ ] T071 [US3] Implement the two route handlers in `identity.controller.ts`, applying
      `session.guard.ts` to the `DELETE` route.
- [ ] T072 [US3] Wire T026's rate limiter on renewal, per session.
- [ ] T073 [US3] Add a replay-detection alert distinct from an ordinary revocation (contracts doc's
      Observability section).

**Checkpoint**: User Stories 1, 2, and 3 all work independently.

---

## Phase 6: User Story 4 - Delete an account (Priority: P4)

**Goal**: FR-014–FR-016, FR-019, FR-021, the `UserDeletionRequested` slice of FR-017, and the
retention sweeps that make deletion actually disappear on schedule.

**Independent Test**: Register (US1), request deletion, confirm every session dies on its very next
use with no grace window, and that a data export was available before deletion completed.

### Tests for User Story 4

- [ ] T074 [P] [US4] Integration test: deletion revokes every active session immediately — back-to-back
      calls, no grace window (FR-015, FR-023, SC-007, quickstart Scenario 5) — in
      `apps/api/src/identity/deletion.integration.spec.ts`.
- [ ] T075 [P] [US4] Integration test: re-registering the same email is blocked until erasure
      completes (FR-002, spec.md clarification 4) — in the same file.
- [ ] T076 [P] [US4] Integration test: `GET /v1/identity/account/export` returns only the caller's own
      data and never a password hash or any token — in
      `apps/api/src/identity/export.integration.spec.ts`.
- [ ] T077 [P] [US4] Unit test for the `User` aggregate's deletion-request transition and terminal
      state, extending `user.aggregate.spec.ts`.
- [ ] T078 [P] [US4] Integration test: `erase-deleted-accounts` and `erase-stale-sessions` sweeps
      delete the right rows, leave `outbox_event` rows intact, and are no-ops on rerun (quickstart
      Scenario 7) — in `apps/worker/src/sweeps/erase-deleted-accounts.sweep.integration.spec.ts` and
      a sibling `erase-stale-sessions.sweep.integration.spec.ts`.

### Implementation for User Story 4

- [ ] T079 [US4] Extend the `User` aggregate with `requestDeletion()` (status →
      `deletion_requested`, terminal, per data-model.md's state diagram).
- [ ] T080 [US4] Define `UserDeletionRequested` in `events.ts`.
- [ ] T081 [US4] Implement `RequestAccountDeletion` in
      `packages/core/identity/application/commands/request-account-deletion.command.ts`: marks the
      user, revokes every active session, writes `UserDeletionRequested` to the outbox — one
      transaction.
- [ ] T082 [US4] Implement `ExportAccountData` (FR-021's exact field list — never `password_hash` or
      any token hash) in `packages/core/identity/application/queries/export-account-data.query.ts`.
- [ ] T083 [US4] Register `DELETE /v1/identity/account` and `GET /v1/identity/account/export` in
      `identity.contract.ts`, honouring `Idempotency-Key` on delete.
- [ ] T084 [US4] Implement the two route handlers in `identity.controller.ts`, applying
      `session.guard.ts` to both.
- [ ] T085 [P] [US4] Implement `apps/worker/src/sweeps/erase-deleted-accounts.sweep.ts` (FR-019, 30
      days after `deletion_requested_at`, idempotent).
- [ ] T086 [P] [US4] Implement `apps/worker/src/sweeps/erase-stale-sessions.sweep.ts` (90 days after
      revocation or expiry).
- [ ] T087 [US4] Wire a `sweep:retention` script in `apps/worker` running all three sweeps
      (T045, T085, T086) with an optional `--as-of` clock override for testability (quickstart.md),
      plus a scheduled invocation for real operation.

**Checkpoint**: All four user stories work independently. Feature-complete against spec.md.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T088 [P] Run quickstart.md's seven scenarios end to end against `docker compose up` (SC-001,
      SC-002) and record results in the pull request description.
- [ ] T089 Confirm `pnpm lint`, `pnpm typecheck`, `pnpm boundaries`, `pnpm test`, and
      `pnpm test:integration` all pass repository-wide with every new package included.
- [ ] T090 [P] Measure argon2id parameters against the Stage 0 VPS (research.md §8: auth p95 <300ms,
      session-guard lookup <5ms) and record the chosen parameters and measurement in
      `packages/platform/src/argon2-password-hasher.ts`.
- [ ] T091 [P] Add the Mailpit service to the `vps-staging` Pulumi stack in `infrastructure/`
      (research.md §4), reusing the same container image `docker-compose.yml` already runs.
- [ ] T092 [P] Add a regression test asserting no plaintext password, session token, or verification
      token ever appears in a log line or an export response, across `apps/api/src/identity/**` and
      `packages/core/identity/**` (SC-005).
- [ ] T093 [P] Add a regression test asserting `packages/core/identity` contains no family, role, or
      capability reference anywhere in its domain or application layers (FR-018).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001–T005 (package scaffolds) run in parallel; T006–T010
  (shared repo-root files) run after them, in the order listed, since several touch the same files.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every user story.
- **User Stories (Phases 3–6)**: All depend on Foundational. Written and numbered in priority order
  (P1→P4), and each is independently testable per its own Independent Test above — but see the note
  on realistic sequencing below.
- **Polish (Phase 7)**: Depends on all four user stories.

### User Story Dependencies

Each story is independently *testable*, per spec.md's own Independent Test criteria, but they are
not independently *useful* in isolation the way spec-kit's default template assumes, because they
build one continuous capability (an account that can prove who it is):

- **US1** has no dependency on another story.
- **US2** needs US1's `User`/registration to exist to authenticate against.
- **US3** needs US2's `Session` issuance to have something to renew or revoke.
- **US4** needs US1's `User` to delete, and reuses US3's revocation path to kill every session at
  once.

This is a chain, not a fan-out — unlike a typical spec-kit feature where P2/P3 stories are optional
extras, here P2–P4 are sequential refinements of P1's aggregate, which is why plan.md's Summary calls
this "the platform's first real bounded context" rather than one feature among several independent
ones.

### Within Each User Story

- Tests are written first and MUST fail before implementation (constitution: testing is not
  optional here).
- Domain (aggregates/entities/events) before application (commands/queries) before persistence
  before contract before controller — the dependency-inversion order ADR-007's port boundary
  requires.

### Parallel Opportunities

- Setup: T001–T005 (five distinct package scaffolds).
- Foundational: T012–T016 (kernel primitives, one file each); T019–T020 (independent adapters).
- Within any story's test block, every test task before its implementation block.
- US4's two sweeps (T085, T086) are independent of each other.

---

## Parallel Example: User Story 1

```bash
# Tests, launched together:
Task: "Unit test for shared email/password Zod schemas in packages/contracts/src/v1/identity.contract.spec.ts"
Task: "Integration test for POST /v1/identity/registrations in apps/api/src/identity/registration.integration.spec.ts"
Task: "Integration test for verification + resend in apps/api/src/identity/verification.integration.spec.ts"
Task: "Unit test for the User aggregate in packages/core/identity/domain/user.aggregate.spec.ts"

# Independent domain pieces, launched together:
Task: "Implement EmailAddress value object in packages/core/identity/domain/email-address.vo.ts"
Task: "Implement EmailVerification entity in packages/core/identity/domain/email-verification.entity.ts"
```

---

## Implementation Strategy

### Realistic MVP: User Stories 1 and 2 together

Spec-kit's default guidance is "MVP = User Story 1 only." That does not quite fit here: US1 alone
creates an account nobody can use yet — its own Independent Test says the account must be "one that
can be authenticated against," and full authentication (session issuance) is US2's scope. The
smallest slice that is actually demonstrable end to end is **US1 + US2**: register, verify, log in,
reach an authenticated endpoint.

1. Complete Phase 1 (Setup) and Phase 2 (Foundational).
2. Complete Phase 3 (US1) and Phase 4 (US2). **STOP and VALIDATE**: run quickstart.md Scenario 1.
3. Add Phase 5 (US3) → validate quickstart Scenario 3 and 4.
4. Add Phase 6 (US4) → validate quickstart Scenario 5, 6, and 7.
5. Phase 7 (Polish), then the full quickstart run (T088).

### Incremental Delivery

Each phase after Foundational is a complete, reviewable pull request: US1, then US2, then US3, then
US4, then Polish — five PRs, each independently mergeable once its own tests pass, matching this
session's established pattern of small, reviewable changes rather than one feature-sized PR.
