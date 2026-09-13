# Data Model: Family and Membership (spec 008)

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Phase 1 output. Four tables owned by this context, plus one owned by Audit and Compliance that this
feature establishes ([research.md §7](research.md)). Every identifier is UUIDv7
([research.md §9](research.md)); every timestamp is `timestamptz` in UTC.

**Every table in this document except `audit_log` is family-scoped**, and therefore carries
`family_id`, an RLS policy, and `FORCE ROW LEVEL SECURITY` ([research.md §1](research.md)).

---

## Branded identifiers

Added to `@fp/kernel` alongside `UserId`, `SessionId`, `DeviceId`:

```ts
export type FamilyId = Branded<string, 'FamilyId'>;
export type FamilyMemberId = Branded<string, 'FamilyMemberId'>;
export type InvitationId = Branded<string, 'InvitationId'>;
export type GuardianshipId = Branded<string, 'GuardianshipId'>;
```

`EmailAddress` moves from `core/identity/domain` to `@fp/kernel` and is re-exported by identity, so
that invitation acceptance and account lookup normalise identically rather than through two
implementations ([research.md §8](research.md)).

---

## Aggregates and their tables

### `Family` — aggregate root, tenant root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | UUIDv7. **This is `family_id`** — the RLS policy compares `id`, not a separate column |
| `name` | text not null | FR-001. Non-empty, trimmed, 1–120 characters |
| `postcode` | text null | FR-002. Stored as supplied, uppercased and space-normalised. Not validated against a real address — that is Reference and Locale (spec.md Assumptions) |
| `local_authority_code` | text null | FR-002. An **identifier**, never a council name: Additional Engineering Constraints, "no context outside the reference context may store a UK-shaped primitive" |
| `composition` | jsonb null | FR-002. Structured counts by member kind, derived and kept consistent with membership, not free text (spec.md Assumptions). Free text here would be personal data with no declared purpose |
| `created_at` | timestamptz not null | |
| `updated_at` | timestamptz not null | |
| `deletion_requested_at` | timestamptz null | Set when `FamilyDeletionRequested` is published. Non-null revokes access immediately; erasure follows the saga's grace period ([research.md §11](research.md)) |

**RLS**: `USING (id = current_setting('app.family_id', true)::uuid)`.

**Invariants**
- Exactly one member with `role = 'owner'` at all times (SC-007) — held by the partial unique index
  on `family_member` below, not by a column here. A denormalised `owner_member_id` was rejected: it
  is a second source of truth for a fact the index already guarantees.
- `deletion_requested_at` is write-once.

---

### `FamilyMember` — aggregate root

The most important table in the platform. A person the family tracks; **not** a `User`
(ARCHITECTURE §5.2).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | UUIDv7 |
| `family_id` | uuid not null fk → `family.id` | Cascade on delete. Present for RLS, not derived by join (§10) |
| `kind` | `member_kind` not null | `adult` \| `child`. The privacy discriminator ([research.md §5](research.md)) |
| `role` | `member_role` not null | `owner` \| `adult` \| `extended` \| `viewer`. The capability discriminator |
| `user_id` | uuid null | The link to Identity. **No foreign key** — cross-context references are to published stable ids only (§10), and a foreign key would let identity's erasure cascade a family's member row away |
| `display_name` | text not null | FR-003. The name the family uses for this person |
| `date_of_birth` | date null | Child records only in practice. Justified per Principle VI: it is what makes a person a child for the purposes of guardianship, and downstream contexts (school year, appointment eligibility) read it |
| `created_at` | timestamptz not null | |
| `updated_at` | timestamptz not null | |
| `removed_at` | timestamptz null | Tombstone. Set by `MemberRemoved` and by `eraseForMember`; a removed member resolves to no standing (FR-017) |

**RLS**: `USING (family_id = current_setting('app.family_id', true)::uuid)`.

**Indexes and constraints**

| | Purpose |
|---|---|
| `UNIQUE (family_id) WHERE role = 'owner' AND removed_at IS NULL` | SC-007, in the database ([research.md §6](research.md)) |
| `UNIQUE (family_id, user_id) WHERE user_id IS NOT NULL AND removed_at IS NULL` | One membership per user per family. Says nothing across families — FR-024 |
| `INDEX (user_id) WHERE user_id IS NOT NULL` | `FamilyContextPort.resolve` and "which families am I in" |
| `CHECK (kind <> 'child' OR user_id IS NULL)` | FR-003: no credentials, no login path, enforced where a raw query cannot get past it |
| `CHECK (kind <> 'child' OR role = 'viewer')` | [research.md §5](research.md) |
| `CHECK (role <> 'owner' OR (user_id IS NOT NULL AND kind = 'adult'))` | US4 Scenario 2 |

**Personal data on this row**: `display_name`, `date_of_birth`. Nothing else. A child's record
carries no address, no school, no medical field — those belong to contexts that do not exist yet,
and Principle VI forbids collecting them before a feature requires them.

---

### `Invitation` — aggregate root

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | UUIDv7 |
| `family_id` | uuid not null fk → `family.id` | Cascade |
| `email` | text not null | Normalised at construction by `EmailAddress` ([research.md §8](research.md)) |
| `proposed_role` | `member_role` not null | `adult` \| `extended` \| `viewer`. `CHECK (proposed_role <> 'owner')` — ownership is transferred, never invited |
| `token_hash` | bytea not null unique | The token itself is never stored, exactly as spec 006 handles verification tokens |
| `status` | `invitation_status` not null | `pending` \| `accepted` \| `revoked` \| `expired` |
| `expires_at` | timestamptz not null | Issued at +14 days ([research.md §8](research.md)) |
| `invited_by_member_id` | uuid not null fk → `family_member.id` | Who to name in the audit record |
| `created_at` / `accepted_at` / `revoked_at` | timestamptz | `accepted_at` and `revoked_at` mutually exclusive |
| `accepted_by_member_id` | uuid null fk → `family_member.id` | The member the acceptance created |

**RLS**: `USING (family_id = current_setting('app.family_id', true)::uuid)`.

**Acceptance is the exception that proves the rule.** The accepting user is, by definition, not yet
a member, so they cannot pass the membership guard for that family and `app.family_id` cannot be
set from their standing. Acceptance is therefore served by a narrow, token-keyed path that resolves
the invitation by `token_hash` outside `withFamilyContext`, verifies the authenticated caller's
email matches, and only then opens the scoped transaction using the family id the invitation names.
The token is the evidence; it is unguessable and single-use. This is the second and last unscoped
read in the feature, and like [research.md §3](research.md)'s it is exported as one narrow function.

**Indexes and constraints**

| | Purpose |
|---|---|
| `UNIQUE (family_id, email) WHERE status = 'pending'` | FR-013, including the concurrent case |
| `INDEX (status, expires_at)` | The expiry sweep |

**Expiry** is a status the sweep writes, and also a condition the acceptance path checks against
the clock — a token that expired one minute ago must not be acceptable merely because the sweep has
not run yet.

---

### `GuardianshipRelationship`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | UUIDv7 |
| `family_id` | uuid not null fk → `family.id` | Cascade. Denormalised for RLS even though it is derivable through either member (§10: "not derivable by join") |
| `guardian_member_id` | uuid not null fk → `family_member.id` | |
| `child_member_id` | uuid not null fk → `family_member.id` | |
| `established_at` | timestamptz not null | |
| `ended_at` | timestamptz null | |

**RLS**: `USING (family_id = current_setting('app.family_id', true)::uuid)`.

**Indexes and constraints**

| | Purpose |
|---|---|
| `UNIQUE (guardian_member_id, child_member_id) WHERE ended_at IS NULL` | One active relationship per pair |
| `INDEX (child_member_id) WHERE ended_at IS NULL` | The guardian-count check on every mutation, and the access check on every child read |
| `INDEX (guardian_member_id) WHERE ended_at IS NULL` | "Which children may I see" |

**Invariants enforced in the domain, not by a constraint** ([research.md §6](research.md)):
- The guardian's `role` ∈ {`owner`, `adult`} and `kind = 'adult'` (FR-006).
- The child's `kind = 'child'`.
- Both members belong to the family named by `family_id`.
- No action may leave a child with zero rows where `ended_at IS NULL` (FR-008, SC-006).

---

### `AuditLogEntry` — owned by Audit and Compliance, **not family-scoped**

Established here because Principle VI and FR-009 require it before any child record exists
([research.md §7](research.md)).

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | UUIDv7 |
| `occurred_at` | timestamptz not null | |
| `actor_user_id` | uuid null | Null for system actors (sweeps) |
| `actor_member_id` | uuid null | Null when the actor had no standing — which is itself the finding |
| `family_id` | uuid null | A column, not a scope |
| `subject_type` | text not null | `family_member`, `family`, `invitation`, `guardianship` |
| `subject_id` | uuid not null | |
| `action` | text not null | `child_record.read`, `member.role_changed`, `access.denied`, … |
| `purpose` | text not null | Principle VI names purpose explicitly as a required field |
| `result` | `audit_result` not null | `granted` \| `denied` |
| `reason` | text null | The *real* reason, including the one the caller was not told (FR-021) |
| `correlation_id` | text not null | Joins the entry to the request, the outbox row and the worker span |

**Grants**: the application role holds `INSERT` only — no `SELECT`, `UPDATE` or `DELETE`.
Append-only expressed as a grant rather than a convention (§5.12).

**No personal data.** Identifiers, action names and a purpose string. Never a name, a date of
birth, or an email — Principle VI applies to the audit log as much as to a log line, and an audit
trail that leaks what it protects is worse than none.

---

## Role-to-capability map

Fixed here, implemented as a pure function in `core/family/domain/capabilities.ts`, no ADR
([research.md §4](research.md)). `✓` means the role holds the capability.

| Capability | `owner` | `adult` | `extended` | `viewer` |
|---|:--:|:--:|:--:|:--:|
| `family:read` | ✓ | ✓ | ✓ | ✓ |
| `family:manage` | ✓ | ✓ | | |
| `family:delete` | ✓ | | | |
| `members:read` | ✓ | ✓ | ✓ | ✓ |
| `members:add` | ✓ | ✓ | | |
| `members:manage` | ✓ | | | |
| `guardianship:manage` | ✓ | | | |
| `billing:manage` | ✓ | | | |
| `documents:read` | ✓ | ✓ | ✓ | ✓ |
| `documents:write` | ✓ | ✓ | ✓ | |
| `documents:write:sensitive` | ✓ | ✓ | | |
| `calendar:read` | ✓ | ✓ | ✓ | ✓ |
| `calendar:write` | ✓ | ✓ | ✓ | |
| `tasks:read` | ✓ | ✓ | ✓ | ✓ |
| `tasks:write` | ✓ | ✓ | ✓ | |

**Reading the split that matters.** `members:add` (owner and adult) is adding a person who has no
login path — a child or an extended member, US2 and US4. `members:manage` (owner alone) is anything
that changes who can *reach* the family: inviting, revoking, changing a role, removing a member,
transferring ownership. Two capabilities rather than one because US2 lets an adult add a child while
US3 and US5 reserve access changes to the owner.

**Capabilities for contexts that do not exist.** `documents:*`, `calendar:*`, `tasks:*` and
`billing:manage` are issued now and consumed later, which is FR-015's requirement and ARCHITECTURE
§5.2's stated purpose. `documents:write:sensitive` marks the boundary an extended member does not
cross.

**A capability is never enough on its own for a child's record.** `members:read` lets a viewer see
that a child member exists. Reading that child's `date_of_birth` requires an active guardianship
row regardless of any capability held (FR-007, Principle VI). Guardianship is a relationship check,
not a capability, and conflating the two is the mistake this table is arranged to prevent.

---

## `FamilyContextPort` — the open host service

The only way any other context learns a user's standing (FR-019, FR-020, ARCHITECTURE §5.2).

```ts
// packages/core/family/application/ports/family-context.port.ts
export interface FamilyContext {
  readonly memberId: FamilyMemberId;
  readonly role: MemberRole;
  readonly capabilities: readonly Capability[];
}

export interface FamilyContextPort {
  resolve(userId: UserId, familyId: FamilyId): Promise<FamilyContext | null>;
}
```

`null` for: no membership, a removed membership, a family pending deletion, or a family that does
not exist. The four are indistinguishable to the caller by design (FR-021); the audit log holds
which one it was.

The returned object is this context's **published language**. It contains no `FamilyMember`, no
Prisma model, no domain type from `core/family/domain` — a consumer that needed one of those would
be importing internals §7.1 forbids by name.

---

## Relationships

```text
Family (tenant root)
 ├─1:N─ FamilyMember ──0..1── UserId  (no FK; Identity holds no reference back)
 │        ├─ kind: adult | child
 │        └─ role: owner | adult | extended | viewer
 ├─1:N─ Invitation ──(on acceptance)──> creates a linked FamilyMember
 └─1:N─ GuardianshipRelationship ── guardian(FamilyMember) ── child(FamilyMember)

AuditLogEntry ──references──> familyId, memberId   (owned by Compliance; no FK, no cascade)
OutboxEvent   ──references──> aggregateId          (owned by the outbox; no FK, per spec 006)
```

**The direction that must never reverse.** `FamilyMember.user_id` points at Identity. Nothing in
Identity points back (FR-022, ARCHITECTURE §5.1). `packages/core/src/identity/no-family-references.spec.ts`
already asserts this for spec 006; this feature must not make it fail, and the equivalent assertion
belongs in this feature's test set too.

---

## Domain events

All six as `outbox_event` rows in the same transaction as their state change
([research.md §10](research.md)). Identifiers only.

| Event type | Payload |
|---|---|
| `family.FamilyCreated.v1` | `familyId`, `ownerMemberId`, `ownerUserId` |
| `family.MemberAdded.v1` | `familyId`, `memberId`, `kind`, `role`, `userId?` |
| `family.MemberRoleChanged.v1` | `familyId`, `memberId`, `fromRole`, `toRole` |
| `family.MemberRemoved.v1` | `familyId`, `memberId`, `hadUserId` (boolean, not the id) |
| `family.GuardianshipEstablished.v1` | `familyId`, `guardianMemberId`, `childMemberId` |
| `family.FamilyDeletionRequested.v1` | `familyId`, `requestedByMemberId` |

Every payload also carries `correlationId`, per the existing `OutboxEventToAppend`.

`MemberRemoved` carries `hadUserId` as a boolean rather than the id itself: a consumer needing the
user id can ask through a port while the tombstone exists, and putting it in a queue body that
outlives erasure is precisely the "data the erasure saga cannot reach" Principle XI forbids.

---

## Retention and erasure

Answering Principle XI for this context; spec.md's Personal Data section states the same in
product terms.

| Data | Member deleted | Family erased | Retention without a request |
|---|---|---|---|
| `family_member.display_name`, `date_of_birth` | Nulled; row retained as a tombstone with `removed_at` | Row deleted | Indefinite while the family is active — this is the family's own record of its own people |
| `guardianship` rows for that member | Deleted | Deleted | — |
| `invitation` (pending) | Revoked if they sent it | Voided (FR-025) | Expired invitations deleted 90 days after expiry |
| `invitation` (accepted/revoked) | Retained; `email` nulled | Deleted | 90 days, then the row is deleted |
| `family` row | Unaffected | Deleted after the saga's grace period | — |
| `audit_log` | **Retained.** Erasing the record of who read a child's file would defeat the control | Retained | Separate retention from operational data (§5.12); the policy itself belongs to Compliance |

`ErasurePort.eraseForMember` and `ErasurePort.eraseForFamily` are implemented by this context from
the start ([research.md §11](research.md)).

---

## Export

A member's export from this context contains: the families they are a member of (`familyId`,
family name, their role and capability set, joined-at), their own `display_name` and
`date_of_birth`, the guardianships they hold, and invitations they sent or accepted with
timestamps and status.

It does **not** contain: another member's `date_of_birth`, a child's record they are not a guardian
of, any `token_hash`, or the audit log. A guardian's export includes the children they are
guardian of, because that is their own record of their own household; a non-guardian's does not,
which is FR-007 applied to export rather than to a read endpoint.
