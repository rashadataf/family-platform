---

description: "Task list template for feature implementation"
---

# Tasks: Family and Membership

**Input**: Design documents from `/specs/008-family-membership/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/family-api.md](contracts/family-api.md),
[quickstart.md](quickstart.md) — all present.

> **⚠️ One gating item is NOT yet closed.** plan.md's Constitution Check gates this feature on
> **ADR-017** (tenant isolation at the database), which is not written. It is T001 below, and it
> blocks every other task in the list — not as ceremony, but because [research.md §1](research.md)
> found that row-level security cannot work as the platform connects today, and T008 onwards create
> the tables that depend on the answer. The constitution is explicit: "an agent that identifies a
> needed ADR MUST stop and say so rather than implement around it."

**Tests**: Included throughout, not optional. The constitution requires it directly — "integration
tests MUST run against a real database, because row-level security and constraints are the thing
being verified" and "authorization MUST have dedicated tests per route." This is the feature those
two sentences were written about.

**Organization**: Grouped by user story (spec.md's P1–P5), so each is independently implementable
and testable. Foundational is unusually large for the same reason plan.md's Summary gives: the first
family-scoped table is where ARCHITECTURE §9's layers 4 and 5 acquire something to attach to, and
the tenant machinery built once here is inherited by every context that follows.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, mapped to spec.md's priorities (P1–P5)
- Every task names an exact file path

## Path Conventions

Paths follow plan.md's Project Structure exactly:

- `packages/kernel/src/` — branded ids, shared value objects, error taxonomy
- `packages/core/src/family/{domain,application}/` — the bounded context
- `packages/core/src/compliance/{domain,application}/` — the audit sink, minimum viable
- `packages/contracts/src/v1/family.contract.ts` — the wire boundary (ADR-006)
- `packages/persistence/{prisma,src/repositories/family,src/repositories/compliance}/`
- `apps/api/src/family/` — controller, the two guards, DI wiring
- `apps/worker/src/sweeps/` — invitation expiry and guardian coverage

---

## Phase 1: Setup (the gate, and the boundary rules that outlive it)

**Purpose**: close the ADR gate, and put the boundary enforcement in place *before* the code it
governs exists — the same fail-closed discipline `.dependency-cruiser.cjs` already uses for packages
that do not exist yet.

- [X] T001 **BLOCKING** Write `adr/ADR-017-tenant-isolation-at-the-database.md` and merge it before
      any other task starts. Input is [research.md §1](research.md). It must decide: the role names
      and their grant sets; whether migrations keep running as the table owner or gain a third role;
      how the application role's password reaches the container at Stage 0 and at Stage 1
      ([ADR-013](../../adr/ADR-013-staged-hosting-model.md)); and the revisit trigger. Status
      `Accepted`; set [ADR-003](../../adr/ADR-003-database-orm.md)'s status to `Amended by ADR-017`
      with a scope note naming its row-level-security section, per `adr/README.md`'s partial-
      replacement rule. Add both to `adr/README.md`'s index.
- [X] T002 [P] Create the context scaffolds `packages/core/src/family/index.ts` and
      `packages/core/src/compliance/index.ts` (empty barrels for now) and re-export them from
      `packages/core/src/index.ts` as namespaces alongside `identity`, so consumers write
      `import { family } from '@fp/core'` and never reach into the file layout.
- [X] T003 Add a `family-repositories-are-private` rule to `.dependency-cruiser.cjs`, forbidding
      anything outside `packages/persistence/src/` from importing
      `packages/persistence/src/repositories/family/**`. FR-020 says no code outside this context
      may read family data directly; `persistence-client-is-private` already does the equivalent for
      the Prisma client, and this is the same argument one level down. The package's narrow factory
      exports remain the only door.

**Checkpoint**: ADR-017 merged, the two context namespaces exist and build, and the boundary rule is
in force before there is anything for it to catch.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the tenant machinery. Every user story depends on all of it.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Kernel and shared primitives

- [X] T004 [P] Add `FamilyId`, `FamilyMemberId`, `InvitationId`, `GuardianshipId` and their `as*`
      constructors to `packages/kernel/src/branded-id.ts`, and export them from
      `packages/kernel/src/index.ts`.
- [X] T005 [P] Move `EmailAddress` from `packages/core/src/identity/domain/email-address.vo.ts` to
      `packages/kernel/src/email-address.vo.ts`, re-export it from
      `packages/core/src/identity/index.js` so spec 006's public surface is unchanged, and move
      `email-address.vo.spec.ts` alongside it. [research.md §8](research.md): invitation acceptance
      and account lookup must normalise through one implementation, because a divergence between two
      is a case-sensitivity leak in the invitation path.
- [X] T006 [P] Add the family error kinds to `packages/kernel/src/errors.ts`'s `DomainError` union:
      `CapabilityRequired`, `GuardianshipRequired`, `GuardianIneligible`, `LastGuardian`,
      `OwnerRequired`, `OwnerIneligible`, `AlreadyMember`, `InvitationInvalid`,
      `InvitationEmailMismatch`. One per error type in
      [contracts/family-api.md](contracts/family-api.md), so the controller's mapping is exhaustive
      by the compiler rather than by review.
- [X] T007 [P] Implement the role-to-capability map in
      `packages/core/src/family/domain/capabilities.ts` — the `Capability` union, the `MemberRole`
      union, and a pure `capabilitiesFor(role)` — exactly as tabulated in
      [data-model.md](data-model.md). With
      `packages/core/src/family/domain/capabilities.spec.ts` asserting every cell of that table,
      including that `viewer` holds no `*:write` capability and that only `owner` holds
      `billing:manage`.

### Schema, and making row-level security real (ADR-017)

- [ ] T008 Add the `family`, `familyMember`, `invitation` and `guardianship` models plus the
      `member_kind`, `member_role` and `invitation_status` enums to
      `packages/persistence/prisma/schema.prisma`, per [data-model.md](data-model.md). UUIDv7 via
      `@default(uuid(7))` ([research.md §9](research.md)). `family_member.user_id` carries **no**
      foreign key — cross-context references are to published stable ids only.
- [ ] T009 Add the `auditLog` model and the `audit_result` enum to
      `packages/persistence/prisma/schema.prisma`, in its own
      commented block marking it **owned by Audit and Compliance, deliberately not family-scoped**
      ([research.md §7](research.md)) so the next reader does not "fix" it.
- [ ] T010 Generate the migration as `packages/persistence/prisma/migrations/<timestamp>_family_and_membership/migration.sql`,
      then hand-write into it the creation of the
      `family_platform_app` login role with `NOBYPASSRLS`, and its grants: full DML on the four
      family-scoped tables, `INSERT` **only** on `audit_log`. Prisma cannot express roles or grants,
      so this is raw SQL in the generated migration directory, which ADR-003 permits and reviews.
- [ ] T011 Hand-write into `packages/persistence/prisma/migrations/<timestamp>_family_and_membership/migration.sql`
      the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` **and**
      `FORCE ROW LEVEL SECURITY` for `family`, `family_member`, `invitation` and `guardianship`,
      plus one policy each: `USING (family_id = current_setting('app.family_id', true)::uuid)` —
      and `id = …` for `family` itself, whose own primary key is the family id. The second argument
      `true` is what makes an unset context return `NULL` and the policy fail closed
      ([research.md §2](research.md)).
- [ ] T012 Hand-write the constraints Prisma's schema language cannot express, into
      `packages/persistence/prisma/migrations/<timestamp>_family_and_membership/migration.sql`: the partial unique indexes (`family_one_owner`, one membership per user per
      family, one pending invitation per family and email, one active guardianship per pair) and the
      three `CHECK` constraints on `family_member` from [data-model.md](data-model.md). These are
      not belt-and-braces — `family_one_owner` is the whole of SC-007's guarantee, and the checks
      are what stop a raw query creating a child with a login path.
- [ ] T013 Split the connection strings: `DATABASE_URL` becomes the application role's, a new
      `MIGRATOR_DATABASE_URL` carries the owner's. Update `docker-compose.yml` (api, worker and
      migrate services), `docker-compose.staging.yml`, `.env.example`, and
      `apps/api/src/config/env.schema.ts`. A process that boots with the wrong one must fail at
      boot, not at the first query (Principle II).
- [ ] T014 Add the application role's credential to the `infrastructure/` vps-staging Pulumi stack,
      resolved at runtime from the secret store — never committed, never a build argument
      (Principle X).

### The scoped unit of work

- [ ] T015 [P] Declare `FamilyUnitOfWork` and `FamilyUnitOfWorkPort` in
      `packages/core/src/family/application/ports/family-unit-of-work.port.ts`, mirroring
      identity's, with `families`, `members`, `invitations`, `guardianships`, `audit` and `outbox`
      added as the stories that need them land.
- [ ] T016 Implement `withFamilyContext(familyId, work)` in
      `packages/persistence/src/family-context.ts`: one `$transaction`, `SELECT set_config(
      'app.family_id', $1, true)` as its first statement, every family repository constructed
      against that transaction client. Delete the now-answered `TODO(ADR-003-rls)` in
      `packages/persistence/src/client.ts` and replace it with a pointer here. No repository method
      may take a family parameter — ARCHITECTURE §9 layer 4 is enforced by the absence of the
      argument, not by remembering to pass it.
- [ ] T017 Integration test `packages/persistence/src/family-context.integration.spec.ts`:
      connected as the application role with no context set, each family-scoped table returns zero
      rows while rows plainly exist; inside `withFamilyContext` only that family's rows appear; and
      connected as the **owner** role, `FORCE ROW LEVEL SECURITY` still filters. Without this last
      assertion [research.md §1](research.md)'s failure mode is invisible — the policy exists, CI is
      green, and every row is readable.
- [ ] T018 Integration test in `packages/persistence/src/family-context.integration.spec.ts`:
      `set_config(..., true)` does not survive its
      transaction. Open a scoped transaction, commit, then query on the same pooled connection with
      no context and assert zero rows. Losing the third argument would leak one family's scope into
      the next request on that connection, which is the single worst failure this mechanism can
      have and the one a functional test would never notice.

### The audit sink (minimum of Audit and Compliance)

- [ ] T019 [P] Create `packages/core/src/compliance/domain/audit-entry.ts` (the entry shape:
      actor, subject, action, purpose, result, reason, correlation id) and
      `packages/core/src/compliance/application/ports/audit-log.port.ts` declaring
      `AuditLogPort.append(entry)`. Owned by Compliance from its first row, so it never has to be
      moved later — moving it would be "changing which context owns a table" and would need its own
      ADR ([research.md §7](research.md)).
- [ ] T020 [P] Implement `packages/persistence/src/repositories/compliance/audit-log.repository.ts`,
      exported through one narrow factory. It must accept an optional transaction client, so a
      granted read is audited inside the same transaction it records while a denial — which has no
      transaction — is a single insert.
- [ ] T021 Integration test
      `packages/persistence/src/repositories/compliance/audit-log.integration.spec.ts`: the
      application role can `INSERT`, and `SELECT`, `UPDATE` and `DELETE` are all refused by the
      database. §5.12's "append-only, no update or delete grants" is a grant, not a convention, and
      this is what proves it.

### Ports and events

- [ ] T022 [P] Declare the open host service in
      `packages/core/src/family/application/ports/family-context.port.ts`: the `FamilyContext` DTO
      (`memberId`, `role`, `capabilities[]`) and `FamilyContextPort.resolve`. This file is the
      entirety of what another bounded context may ever import from `core/family` — no domain type
      appears in its signature (ARCHITECTURE §7.1).
- [ ] T023 [P] Declare `ErasurePort.eraseForFamily(familyId)` and `eraseForMember(memberId)` in
      `packages/core/src/family/application/ports/erasure.port.ts`. Declared now, implemented in
      T092 — Principle XI: "a new context is not complete without them."
- [ ] T024 [P] Implement the six versioned event builders in
      `packages/core/src/family/domain/events.ts` (`family.FamilyCreated.v1` and the rest), with
      `events.spec.ts` asserting each payload against [data-model.md](data-model.md) and — the
      assertion that matters — that no payload contains a name, a date of birth or an email
      address.

### Layers 2 and 3

- [ ] T025 Implement the standing lookup in
      `packages/persistence/src/repositories/family/membership.repository.ts`, exported as a single
      narrow factory `createMembershipRepository()` and constructed against the base client,
      **outside** `withFamilyContext`. [research.md §3](research.md) is the argument for why this
      one read has to be unscoped and why it cannot leak; put that reasoning in the file's doc
      comment, not only in the spec.
- [ ] T026 Implement `resolveFamilyContext` in
      `packages/core/src/family/application/queries/resolve-family-context.query.ts` — the standing
      lookup composed with `capabilitiesFor` — returning `null` for no membership, a removed
      membership, a family pending deletion, or a family that does not exist. With
      `resolve-family-context.query.spec.ts` asserting all four collapse to the same `null`.
- [ ] T027 Implement `FamilyMembershipGuard` in `apps/api/src/family/family-membership.guard.ts`:
      resolve, attach `request.familyContext` on success, and on `null` throw `404
      family/not_found` **and** write an audit entry recording the real reason. Never 403 — a 403
      confirms the family exists and is an enumeration oracle (Principle V, FR-021).
- [ ] T028 Implement `CapabilityGuard` in `apps/api/src/family/capability.guard.ts`, driven by a
      `@RequiresCapability('members:manage')` decorator, checking membership in
      `familyContext.capabilities`. The string `'owner'` must appear in no authorization decision
      anywhere in `apps/api` — FR-015, and a lint-visible grep in T094.
- [ ] T029 Create `packages/contracts/src/v1/family.contract.ts` with the `/v1` router skeleton and
      the shared shapes (`MemberRole`, `Capability`, `FamilyContextResponse`, the problem-format
      error types from [contracts/family-api.md](contracts/family-api.md)), exported from
      `packages/contracts/src/index.ts`. Routes are added by the story that owns them.
- [ ] T030 Create `apps/api/src/family/family.module.ts` and `family.tokens.ts`, wiring the clock,
      the membership repository, the audit log, `withFamilyContext` and both guards, mirroring
      `identity.module.ts`.
- [ ] T031 Add family factories to `packages/testing` (a family with an owner, an adult, a child
      with a guardian, and an extended member) and an `expectNotFoundAcrossFamilies(routes)` helper
      that drives the parameterised cross-family sweep T087 runs.

**Checkpoint**: row-level security is provably in force, the audit sink accepts entries and refuses
reads, and layers 2 and 3 exist. User story implementation can now begin.

---

## Phase 3: User Story 1 - Create a family and become its owner (Priority: P1) 🎯 MVP

**Goal**: a registered person creates a family and is immediately its sole owner, holding the owner
capability set.

**Independent test**: create a family as a registered user; confirm a `Family` exists with that user
as its owner and the owner capabilities resolved, with no other feature required.

### Tests for User Story 1

- [ ] T032 [P] [US1] Unit test `packages/core/src/family/domain/family.aggregate.spec.ts`: name
      required, trimmed and length-bounded; household profile optional and independently updatable.
- [ ] T033 [P] [US1] Unit test `packages/core/src/family/domain/family-member.aggregate.spec.ts`:
      the three `kind` × `role` invariants from [data-model.md](data-model.md), each asserted in
      both directions.
- [ ] T034 [P] [US1] Integration test `apps/api/src/family/create-family.integration.spec.ts`:
      `POST /v1/families` returns 201, creates exactly one owner member linked to the caller, writes
      a `family.FamilyCreated.v1` outbox row **in the same transaction**, and rejects a missing name
      with `422 family/name_required`.
- [ ] T035 [P] [US1] Integration test `apps/api/src/family/list-families.integration.spec.ts`:
      `GET /v1/families` returns only the caller's memberships with capabilities present and role
      names not load-bearing; a user in two families sees both and not a third (FR-024).
- [ ] T036 [P] [US1] Integration test `apps/api/src/family/read-family.integration.spec.ts`:
      `GET /v1/families/:familyId` succeeds for a member, returns `404` for a member of another
      family, and `PATCH` requires `family:manage`.

### Implementation for User Story 1

- [ ] T037 [US1] Implement the `Family` aggregate in
      `packages/core/src/family/domain/family.aggregate.ts` and the `HouseholdProfile` value object
      in `household-profile.vo.ts` — postcode normalised, local authority held as an identifier
      never a name (the UK-first-not-UK-welded constraint).
- [ ] T038 [US1] Implement the `FamilyMember` aggregate in
      `packages/core/src/family/domain/family-member.aggregate.ts`, carrying `kind` and `role` as
      separate discriminants ([research.md §5](research.md)) with the invariants enforced in the
      constructor, not only by the database.
- [ ] T039 [US1] Implement `family.repository.ts` and `family-member.repository.ts` in
      `packages/persistence/src/repositories/family/`, constructed from the transaction
      `withFamilyContext` opens. No method takes a family id.
- [ ] T040 [US1] Implement `createFamily` in
      `packages/core/src/family/application/commands/create-family.command.ts`: family, owner
      member and outbox row in one transaction. This is the one command that cannot run inside
      `withFamilyContext` for its own family, because the family does not exist until it commits —
      document that in the file, and set the context immediately after insert so the rest of the
      transaction is scoped.
- [ ] T041 [P] [US1] Implement `listFamilies` in
      `packages/core/src/family/application/queries/list-families.query.ts`, returning
      `FamilyContextResponse[]` — capabilities, not roles, are what the client branches on.
- [ ] T042 [P] [US1] Implement `getFamily` and `updateFamily` (name and household profile, FR-002)
      in `packages/core/src/family/application/`.
- [ ] T043 [US1] Add the four routes to `packages/contracts/src/v1/family.contract.ts`:
      `POST /v1/families`, `GET /v1/families`, `GET /v1/families/:familyId`,
      `PATCH /v1/families/:familyId`, with `Idempotency-Key` honoured on the first.
- [ ] T044 [US1] Implement `apps/api/src/family/family.controller.ts` binding those four routes,
      with `FamilyMembershipGuard` and `CapabilityGuard` applied to the two that carry a
      `:familyId` and to neither of the two that do not.

**Checkpoint**: quickstart Scenario 1 passes. A family exists, it has exactly one owner, and that
owner's capabilities resolve.

---

## Phase 4: User Story 2 - Add a child and become their guardian (Priority: P2)

**Goal**: an owner or adult adds a child with no account and becomes their guardian in the same
action; nobody without a guardianship relationship can read that child's details.

**Independent test**: add a child as the owner; confirm no linked account, the adder is a guardian,
and a second adult member with no guardianship cannot read the child's details.

### Tests for User Story 2

- [ ] T045 [P] [US2] Unit test `packages/core/src/family/domain/guardianship.spec.ts`: eligibility
      is `owner`/`adult` and `kind = adult` only (FR-006); the last-guardian rule refuses all three
      routes to zero guardians (FR-008).
- [ ] T046 [P] [US2] Integration test `apps/api/src/family/add-child.integration.spec.ts`: the
      created member has no `user_id`, no credential and no verification email; the adder is a
      guardian; both `MemberAdded` and `GuardianshipEstablished` outbox rows are written in the same
      transaction.
- [ ] T047 [P] [US2] Integration test `apps/api/src/family/child-access.integration.spec.ts` — the
      test this whole feature exists for. **An `owner` who is not a guardian is denied; a `viewer`
      who is a guardian is allowed.** Both directions, because either alone would still pass with
      role-based logic and the point is that guardianship is not a capability.
- [ ] T048 [P] [US2] Integration test in `apps/api/src/family/child-access.integration.spec.ts`:
      `GET …/members` omits `dateOfBirth` for
      every child the caller does not guard — the key absent, not null, so the response shape
      carries no oracle.
- [ ] T049 [P] [US2] Integration test `apps/api/src/family/child-audit.integration.spec.ts`: a
      granted read and a denied read each write exactly one `audit_log` row carrying actor, subject,
      purpose and result. A missing denial row is a failure even when the API behaved correctly —
      Principle VI logs reads, not only mutations.

### Implementation for User Story 2

- [ ] T050 [US2] Implement the guardianship entity and eligibility policy in
      `packages/core/src/family/domain/guardianship.ts`, and the `assertGuardianCoverage` rule the
      three mutating paths share.
- [ ] T051 [US2] Implement `guardianship.repository.ts` in
      `packages/persistence/src/repositories/family/`.
- [ ] T052 [US2] Implement `addMember` (child path) in
      `packages/core/src/family/application/commands/add-member.command.ts`: member, guardianship
      and both outbox rows in one transaction (FR-005).
- [ ] T053 [US2] Implement `readMember` in
      `packages/core/src/family/application/queries/read-member.query.ts`: the guardianship gate for
      a child subject, and an audit append on **both** outcomes, inside the transaction on the
      granted path.
- [ ] T054 [US2] Implement `listMembers` in
      `packages/core/src/family/application/queries/list-members.query.ts` with per-row field
      omission for unguarded children. Omission happens in the query, not the controller — a
      serialization-layer filter is one refactor away from being forgotten.
- [ ] T055 [US2] Implement `grantGuardianship` and `endGuardianship` in
      `packages/core/src/family/application/commands/`, both publishing
      `GuardianshipEstablished` / enforcing FR-008 respectively.
- [ ] T056 [US2] Add, to `packages/contracts/src/v1/family.contract.ts` and
      `apps/api/src/family/family.controller.ts`: `POST /v1/families/:familyId/members`, `GET …/members`,
      `GET …/members/:memberId`, `POST …/members/:memberId/guardians` and
      `DELETE …/guardians/:guardianMemberId` to the contract and the controller, with
      `AddMemberRequest`'s `kind` union deliberately omitting `'adult'`.

**Checkpoint**: quickstart Scenario 2 passes, audit rows included. The platform's core privacy
promise is enforced and tested.

---

## Phase 5: User Story 3 - Invite another adult to join the family (Priority: P3)

**Goal**: the owner invites an adult by email; the recipient, with or without an existing account,
accepts and becomes a linked adult member.

**Independent test**: send an invitation, accept it from that email, confirm a linked
`FamilyMember` exists with the invited role.

### Tests for User Story 3

- [ ] T057 [P] [US3] Unit test `packages/core/src/family/domain/invitation.aggregate.spec.ts`:
      status transitions, expiry against an injected clock, and `proposed_role` never `owner`.
- [ ] T058 [P] [US3] Integration test `apps/api/src/family/invitation.integration.spec.ts`: invite
      `GRACE@example.com`, accept as the account registered at `grace@example.com`, confirm the
      case-insensitive match and the linked member.
- [ ] T059 [P] [US3] Integration test in `apps/api/src/family/invitation.integration.spec.ts`:
      invite an address with **no** account, then
      register and verify through spec 006's routes, then accept. The outcome must be identical to
      T058's (US3 Scenario 3).
- [ ] T060 [P] [US3] Integration test in `apps/api/src/family/invitation.integration.spec.ts`,
      the four negatives: a second acceptance
      returns the same membership rather than a duplicate; another account presenting the token gets
      `403 family/invitation_email_mismatch` **and creates nothing**; a redundant invitation gets
      `409 family/already_member`; a revoked or expired token gets
      `422 family/invitation_invalid`.

### Implementation for User Story 3

- [ ] T061 [US3] Implement the `Invitation` aggregate in
      `packages/core/src/family/domain/invitation.aggregate.ts` — token hashed, never stored raw,
      the same handling spec 006 gives verification tokens.
- [ ] T062 [US3] Implement `invitation.repository.ts`, plus the token-keyed lookup exported as one
      narrow factory outside `withFamilyContext`. This is the second and last unscoped read in the
      feature; [data-model.md](data-model.md) explains why acceptance cannot be family-scoped, and
      that explanation belongs in the file.
- [ ] T063 [US3] Implement `createInvitation` in
      `packages/core/src/family/application/commands/create-invitation.command.ts`, reusing
      `MailerPort` from `@fp/kernel`. The email carries a link and no family detail beyond its
      name.
- [ ] T064 [US3] Implement `acceptInvitation` in
      `packages/core/src/family/application/commands/accept-invitation.command.ts`: resolve by token, verify the authenticated account's
      email matches, then open `withFamilyContext` for the family the invitation names and create
      the linked member plus a `MemberAdded` row.
- [ ] T065 [P] [US3] Implement `revokeInvitation` and `listInvitations` in
      `packages/core/src/family/application/`.
- [ ] T066 [US3] Add, to `packages/contracts/src/v1/family.contract.ts` and
      `apps/api/src/family/family.controller.ts`: `POST /v1/families/:familyId/invitations`, `GET …/invitations`,
      `DELETE …/invitations/:invitationId` and `POST /v1/invitations/accept` to the contract and
      controller. The accept route takes a token and no `:familyId` — a caller cannot name the
      family, only present evidence.
- [ ] T067 [P] [US3] Implement `apps/worker/src/sweeps/expire-invitations.sweep.ts` (FR-012), with
      an integration test. Acceptance must also check expiry against the clock, so a token that
      expired a minute ago is dead before the sweep runs.
- [ ] T068 [US3] Apply, in `apps/api/src/family/family.module.ts` via the existing
      `apps/api/src/common/rate-limit.guard.ts`, the rate limits from [contracts/family-api.md](contracts/family-api.md) —
      10 invitations per family per hour is the feature's outbound-abuse surface and the strictest
      limit here.

**Checkpoint**: quickstart Scenario 3 passes, both the has-an-account and the no-account-yet paths.

---

## Phase 6: User Story 4 - Add an extended family member without an account (Priority: P4)

**Goal**: add an extended member directly, with no invitation and no login path, carrying the
extended capability set.

**Independent test**: add an extended member as the owner; confirm the extended capability set and
that no login path was created.

### Tests for User Story 4

- [ ] T069 [P] [US4] Integration test `apps/api/src/family/extended-member.integration.spec.ts`:
      the created member has no linked account, and resolves the extended capability set —
      containing `documents:write` but **not** `documents:write:sensitive`.
- [ ] T070 [P] [US4] Integration test in `apps/api/src/family/extended-member.integration.spec.ts`:
      promoting that unlinked member to `owner`
      returns `422 family/owner_ineligible` (US4 Scenario 2), and granting them guardianship
      returns `422 family/guardian_ineligible` (FR-006).

### Implementation for User Story 4

- [ ] T071 [US4] Extend `add-member.command.ts` with the `extended` path — no guardianship
      established, unlike the child path (FR-005 applies to children only).
- [ ] T072 [US4] Extend `AddMemberRequest` in `packages/contracts/src/v1/family.contract.ts` and the
      handler in `apps/api/src/family/family.controller.ts`. No new route:
      the wire type distinguishes the two, which is why `kind` is a discriminant rather than a
      flag.

**Checkpoint**: quickstart Scenario 4 passes.

---

## Phase 7: User Story 5 - Manage roles and remove access (Priority: P5)

**Goal**: the owner changes roles, transfers ownership and removes members, with every capability
check reflecting the change immediately.

**Independent test**: change one member's role and remove another; confirm both members' resolved
standing reflects the change on the next request.

### Tests for User Story 5

- [ ] T073 [P] [US5] Integration test `apps/api/src/family/role-management.integration.spec.ts`: a
      demotion to `viewer` is visible in the very next request's capability set — no cache, no
      delay (FR-016, SC-005).
- [ ] T074 [P] [US5] Integration test in `apps/api/src/family/role-management.integration.spec.ts`:
      the sole owner cannot leave, be removed, or
      be demoted — `409 family/owner_required` in all three cases (FR-018).
- [ ] T075 [P] [US5] Integration test `apps/api/src/family/ownership-transfer.integration.spec.ts`:
      after transfer exactly one owner exists, the previous owner is `adult`, and the child's
      guardianship is untouched (spec.md Edge Cases). Plus a concurrent-promotion test proving
      `family_one_owner` rejects the second rather than interleaving.
- [ ] T076 [P] [US5] Integration test `apps/api/src/family/last-guardian.integration.spec.ts`:
      removing a child's only guardian, and demoting them to `viewer`, both return
      `409 family/last_guardian` (FR-008, SC-006).

### Implementation for User Story 5

- [ ] T077 [US5] Implement `changeMemberRole` in
      `packages/core/src/family/application/commands/change-member-role.command.ts` —
      `MemberRoleChanged` row, and the guardian-coverage
      assertion before the write.
- [ ] T078 [US5] Implement `removeMember` in
      `packages/core/src/family/application/commands/remove-member.command.ts` — tombstone (`removed_at` set, personal fields nulled),
      guardianships ended, `MemberRemoved` row carrying `hadUserId` as a boolean and not the id
      ([data-model.md](data-model.md)).
- [ ] T079 [US5] Implement `transferOwnership` in
      `packages/core/src/family/application/commands/transfer-ownership.command.ts` — demotion and promotion in one transaction, never
      two calls, so the partial unique index can never see two owners.
- [ ] T080 [US5] Add, to `packages/contracts/src/v1/family.contract.ts` and
      `apps/api/src/family/family.controller.ts`: `PATCH …/members/:memberId/role`, `DELETE …/members/:memberId` and
      `POST …/ownership-transfer` to the contract and controller, all behind `members:manage`.

**Checkpoint**: all five user stories work independently. Feature-complete against spec.md's user
stories; the requirements below are not covered by any of them.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T081 Implement `requestFamilyDeletion` in
      `packages/core/src/family/application/commands/request-family-deletion.command.ts`
      (FR-023, FR-025) — sets `deletion_requested_at`, voids
      every pending invitation in the same transaction (§7.2: same context, so no queue), publishes
      `family.FamilyDeletionRequested.v1`, and revokes access immediately by making
      `resolveFamilyContext` return `null` for the family. Add `DELETE /v1/families/:familyId`
      behind `family:delete`. **No user story covers this**, which is why it is here rather than
      lost — it is required by FR-023 and FR-025 and by Principle XI's insistence that deletion is
      designed, not retrofitted.
- [ ] T082 Integration test `apps/api/src/family/family-deletion.integration.spec.ts`: quickstart
      Scenario 8 — 202, pending invitation now unacceptable, every family-scoped route 404 for
      every member, outbox row present, and the rows themselves still there because erasure is the
      saga's job.
- [ ] T083 Implement `ErasurePort.eraseForFamily` and `eraseForMember` in
      `packages/persistence/src/repositories/family/erasure.ts`, with an integration test asserting
      that after `eraseForMember` no personal field survives on the tombstone and no guardianship
      row references the member, and that after `eraseForFamily` no row in any of the four tables
      references the family (Principle XI's end-to-end assertion, scoped to this context).
- [ ] T084 [P] Implement `apps/worker/src/sweeps/guardian-coverage.sweep.ts` and the
      `family_children_without_guardian` gauge, alerting on any value above zero. This is what makes
      SC-006 *measured* rather than merely asserted at the moment of each mutation
      ([research.md §6](research.md)).
- [ ] T085 [P] Implement, in `apps/api/src/family/` and `packages/platform/src/`, the remaining four
      observability signals from
      [contracts/family-api.md](contracts/family-api.md): `family_context_resolve_duration`,
      `family_authorization_denied_total{reason}`, `family_rls_empty_result_total` (an alert, per
      ARCHITECTURE §9 — an empty result under RLS should be unreachable) and
      `family_child_record_read_total{result}`.
- [ ] T086 [P] Add `apps/api/src/family/no-personal-data-in-telemetry.integration.spec.ts`,
      mirroring spec 006's `no-secrets-in-logs.integration.spec.ts`: exercise every route and assert
      no `displayName`, `dateOfBirth`, `postcode` or email value appears in any log line, metric
      label, span attribute or outbox payload (Principle VI).
- [ ] T087 Run the parameterised cross-family sweep from T031, in
      `apps/api/src/family/cross-family-access.integration.spec.ts`, over **every** route in
      [contracts/family-api.md](contracts/family-api.md)'s family-scoped table, asserting `404` with
      an identical body to a genuinely missing family id, and assert the route list in the test
      matches the router's own registered routes — so a route added later without a test fails by
      being absent rather than passing by being unnoticed (SC-004).
- [ ] T088 Verify, in `apps/api/src/family/idempotency.integration.spec.ts`, that `Idempotency-Key`
      is honoured on `POST /v1/families`, `POST …/members`,
      `POST …/invitations` and `POST /v1/invitations/accept`, with a test replaying each (Principle
      IX — a duplicated child record is a defect a user cannot clean up themselves).
- [ ] T089 Add `packages/core/src/family/family-owns-the-relationship.spec.ts`, the mirror of
      identity's existing `no-family-references.spec.ts`: assert `core/identity` still contains no
      family, role or capability identifier after T005's `EmailAddress` move (FR-022,
      ARCHITECTURE §5.1).
- [ ] T090 Assert the capability discipline mechanically: a test that no file under
      `apps/api/src/` compares against a role string literal, walking the TypeScript AST rather than
      grepping, the way `no-family-references.spec.ts` does — the same reason applies, since this
      file and several doc comments legitimately mention the words while explaining them (FR-015).
- [ ] T091 [P] Update `docs/` with a runbook note for the two database roles and what to do when a
      query returns unexpectedly empty (the RLS-empty alert's first response), and update
      `README.md`'s environment table for `MIGRATOR_DATABASE_URL`.
- [ ] T092 Run `pnpm verify` — typecheck, lint, boundaries, unit, integration, format, build — and
      then the full [quickstart.md](quickstart.md), all eight scenarios, against a fresh
      `docker compose up`. Scenario 7 is the one that cannot be inferred from a green pipeline.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks everything, including the rest of Setup. T002 and T003 are
  parallel once it merges.
- **Foundational (Phase 2)**: depends on Setup. Blocks every user story. Within it, T008–T012 are
  one migration and must land in order; T013–T014 depend on T010; T016 depends on T011 and T013;
  T017–T018 depend on T016; T025–T028 depend on T007, T016 and T020.
- **User Stories (Phases 3–7)**: all depend on Foundational, and are written in priority order.
- **Polish (Phase 8)**: depends on all five stories. T087 depends on every route existing, which is
  the point of running it last.

### User Story Dependencies

Unlike spec 006's chain, these fan out from a common root:

- **US1** has no dependency on another story. Everything else needs a family to exist.
- **US2** needs US1's `Family` and `FamilyMember`. It is independent of US3, US4 and US5.
- **US3** needs US1. Independent of US2 — an adult can be invited into a family with no children.
- **US4** needs US1 and reuses US2's `addMember` command, which is why it is only two tasks.
- **US5** needs US1, and its last-guardian tests need US2's guardianships to exist.

So US2, US3 and US4 are genuinely parallelisable across three people or three branches once
Foundational lands; only US5's guardianship tests reach back into US2.

### Within Each User Story

- Tests are written first and MUST fail before implementation.
- Domain → application → persistence → contract → controller, the dependency-inversion order the
  port boundary requires.

### Parallel Opportunities

- Foundational: T004–T007 (kernel and the capability map, one file each); T019–T020 (compliance);
  T022–T024 (ports and events). The migration block T008–T012 is strictly sequential.
- Every story's test block is fully parallel within itself.
- US2, US3 and US4 in parallel after Foundational (see above).
- Polish: T084–T086 and T091 are independent of each other.

---

## Parallel Example: Foundational

```bash
# Kernel and the capability map, launched together:
Task: "Add family branded ids in packages/kernel/src/branded-id.ts"
Task: "Move EmailAddress to packages/kernel/src/email-address.vo.ts"
Task: "Add family error kinds in packages/kernel/src/errors.ts"
Task: "Implement capabilitiesFor in packages/core/src/family/domain/capabilities.ts"

# Ports and events, launched together:
Task: "Declare FamilyContextPort in packages/core/src/family/application/ports/family-context.port.ts"
Task: "Declare ErasurePort in packages/core/src/family/application/ports/erasure.port.ts"
Task: "Implement the six event builders in packages/core/src/family/domain/events.ts"
```

---

## Implementation Strategy

### MVP: User Story 1 alone

Unlike spec 006, the default guidance fits here. US1 is demonstrable on its own — a family exists,
it has exactly one owner, and that owner's capabilities resolve through the port every later context
will consume. That is the tenant root, and it is worth reviewing before anything is built on it.

1. T001 (ADR-017) merges. Nothing else starts first.
2. Phase 2 (Foundational). **STOP and VALIDATE**: quickstart Scenario 7 — the RLS check. If that
   scenario does not behave as written, nothing built afterwards is isolated, and finding out later
   means re-doing the schema.
3. Phase 3 (US1) → quickstart Scenario 1.
4. Phase 4 (US2) → quickstart Scenario 2, audit rows included. This is the privacy promise; treat
   its review as the most consequential of the feature.
5. Phases 5–7 (US3, US4, US5) → quickstart Scenarios 3, 4, 5.
6. Phase 8 (Polish) → quickstart Scenario 6 and 8, then the full run (T092).

### Incremental Delivery

Seven reviewable pull requests: ADR-017; Foundational; then one per user story; then Polish. The
Foundational PR is the large one and the one worth the most review attention — it decides how every
future bounded context reaches the database.
