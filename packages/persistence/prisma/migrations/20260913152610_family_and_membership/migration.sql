-- CreateEnum
CREATE TYPE "member_kind" AS ENUM ('adult', 'child');

-- CreateEnum
CREATE TYPE "member_role" AS ENUM ('owner', 'adult', 'extended', 'viewer');

-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- CreateEnum
CREATE TYPE "audit_result" AS ENUM ('granted', 'denied');

-- CreateTable
CREATE TABLE "family" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "postcode" TEXT,
    "local_authority_code" TEXT,
    "composition" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deletion_requested_at" TIMESTAMP(3),

    CONSTRAINT "family_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_member" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "kind" "member_kind" NOT NULL,
    "role" "member_role" NOT NULL,
    "user_id" TEXT,
    "display_name" TEXT,
    "date_of_birth" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "removed_at" TIMESTAMP(3),

    CONSTRAINT "family_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "email" TEXT,
    "proposed_role" "member_role" NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invited_by_member_id" TEXT NOT NULL,
    "accepted_by_member_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardianship" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "guardian_member_id" TEXT NOT NULL,
    "child_member_id" TEXT NOT NULL,
    "established_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "guardianship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" TEXT,
    "actor_member_id" TEXT,
    "family_id" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "result" "audit_result" NOT NULL,
    "reason" TEXT,
    "correlation_id" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "family_member_user_id_idx" ON "family_member"("user_id");

-- CreateIndex
CREATE INDEX "family_member_family_id_idx" ON "family_member"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_token_hash_key" ON "invitation"("token_hash");

-- CreateIndex
CREATE INDEX "invitation_status_expires_at_idx" ON "invitation"("status", "expires_at");

-- CreateIndex
CREATE INDEX "invitation_family_id_idx" ON "invitation"("family_id");

-- CreateIndex
CREATE INDEX "guardianship_child_member_id_idx" ON "guardianship"("child_member_id");

-- CreateIndex
CREATE INDEX "guardianship_guardian_member_id_idx" ON "guardianship"("guardian_member_id");

-- CreateIndex
CREATE INDEX "audit_log_subject_id_occurred_at_idx" ON "audit_log"("subject_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_family_id_occurred_at_idx" ON "audit_log"("family_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_member_id_fkey" FOREIGN KEY ("invited_by_member_id") REFERENCES "family_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_member_id_fkey" FOREIGN KEY ("accepted_by_member_id") REFERENCES "family_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship" ADD CONSTRAINT "guardianship_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship" ADD CONSTRAINT "guardianship_guardian_member_id_fkey" FOREIGN KEY ("guardian_member_id") REFERENCES "family_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardianship" ADD CONSTRAINT "guardianship_child_member_id_fkey" FOREIGN KEY ("child_member_id") REFERENCES "family_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Everything below this line is hand-written and implements ADR-017.
-- Prisma's schema language cannot express roles, grants, row-level security,
-- partial indexes or check constraints, and every one of them here is
-- load-bearing rather than incidental.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- ADR-017 part 1: grants for the application role.
--
-- The ROLES themselves are not created here. They are created by
-- `provisionDatabaseRoles()` in packages/persistence, which runs as the
-- cluster superuser in one bootstrap step before `prisma migrate deploy` —
-- because creating a role needs privileges this migration deliberately does
-- not run with. This migration runs as `family_platform_owner`, which owns
-- every table and can therefore grant on them.
--
-- Why the owner is not the superuser: `FORCE ROW LEVEL SECURITY` lifts the
-- table OWNER's exemption from a policy. It does not lift a SUPERUSER's, which
-- is unconditional. With the superuser as owner — which is what
-- `POSTGRES_USER: postgres` gives you — the policies below would have been
-- created, listed in pg_policies, and enforced against nobody on that path.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO family_platform_app;

-- Identity's tables (spec 006). Granted explicitly rather than through
-- ALTER DEFAULT PRIVILEGES: a default would silently grant on every future
-- table, including the next one that turns out to need INSERT only, and the
-- point of this ADR is that grants are decided rather than inherited.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "user", "session", "device", "email_verification", "outbox_event"
  TO family_platform_app;

-- Family and Membership (spec 008).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "family", "family_member", "invitation", "guardianship"
  TO family_platform_app;

-- Audit and Compliance. INSERT only, and that is the whole isolation story
-- for this table: ARCHITECTURE.md §5.12's "append-only, no update or delete
-- grants" expressed as a grant rather than as a convention. It gets no
-- row-level security policy on purpose — see the schema comment and ADR-017.
GRANT INSERT ON "audit_log" TO family_platform_app;

-- ---------------------------------------------------------------------------
-- ADR-017 part 2: row-level security, ENABLE *and* FORCE.
--
-- ENABLE is what the application role needs, since it is not the owner.
-- FORCE covers the one legitimate owner-connected path — migrations, the seed
-- fixture, a maintenance script — so a query run as the owner is filtered too.
-- That is the layer that survives "a developer who bypasses the repository",
-- and a developer at a psql prompt is usually connected as the owner.
--
-- The policies fail CLOSED. `current_setting('app.family_id', true)` returns
-- NULL when unset rather than raising, and `family_id = NULL` is NULL, which
-- is not TRUE. Forgetting `withFamilyContext` yields an empty result, never an
-- unfiltered one.
-- ---------------------------------------------------------------------------

ALTER TABLE "family" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "family" FORCE ROW LEVEL SECURITY;
-- `family` is the one table whose own primary key is the tenant key.
CREATE POLICY family_isolation ON "family"
  USING ("id" = current_setting('app.family_id', true))
  WITH CHECK ("id" = current_setting('app.family_id', true));

ALTER TABLE "family_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "family_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY family_member_isolation ON "family_member"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

ALTER TABLE "invitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_isolation ON "invitation"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

ALTER TABLE "guardianship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardianship" FORCE ROW LEVEL SECURITY;
CREATE POLICY guardianship_isolation ON "guardianship"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
--
-- These are not belt-and-braces. `family_one_owner` is the ENTIRETY of
-- SC-007's guarantee, and the CHECK constraints are what stop a raw query
-- creating a child with a login path — the one thing Principle VI calls a
-- privacy requirement rather than an implementation detail.
-- ---------------------------------------------------------------------------

-- SC-007, FR-018: exactly one owner per family, at every point in time.
-- A partial unique index makes a concurrent second promotion fail rather than
-- interleave, which no amount of application-level checking can achieve.
CREATE UNIQUE INDEX "family_one_owner"
  ON "family_member" ("family_id")
  WHERE "role" = 'owner' AND "removed_at" IS NULL;

-- One membership per user per family. Says nothing across families: FR-024
-- allows a user to be a member of several.
CREATE UNIQUE INDEX "family_member_one_per_user"
  ON "family_member" ("family_id", "user_id")
  WHERE "user_id" IS NOT NULL AND "removed_at" IS NULL;

-- FR-013, including the concurrent case a domain check cannot catch.
CREATE UNIQUE INDEX "invitation_one_pending_per_email"
  ON "invitation" ("family_id", "email")
  WHERE "status" = 'pending';

-- One active guardianship per (guardian, child) pair.
CREATE UNIQUE INDEX "guardianship_one_active_per_pair"
  ON "guardianship" ("guardian_member_id", "child_member_id")
  WHERE "ended_at" IS NULL;

-- FR-003 and Principle VI: children are family member records with no UserId,
-- no credentials and no login path. Enforced here as well as in the domain
-- because the domain cannot see a raw query.
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_child_has_no_user"
  CHECK ("kind" <> 'child' OR "user_id" IS NULL);

-- research.md §5: a child's role is never resolved, because resolution needs a
-- linked user. The column is total rather than nullable, and least privilege
-- is the right value to hold if a future `linkUserToMember` promotes the
-- record — that command must then set a real role deliberately.
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_child_is_viewer"
  CHECK ("kind" <> 'child' OR "role" = 'viewer');

-- US4 Scenario 2: ownership carries `billing:manage` and `family:delete`, and
-- an unreachable owner is an unrecoverable family.
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_owner_is_linked_adult"
  CHECK ("role" <> 'owner' OR ("user_id" IS NOT NULL AND "kind" = 'adult'));

-- A live member has a name; an erased one does not. This is what lets
-- `eraseForMember` null the personal fields while keeping the tombstone that
-- stops later contexts' authorship references dangling (Principle XI).
ALTER TABLE "family_member" ADD CONSTRAINT "family_member_live_has_name"
  CHECK ("removed_at" IS NOT NULL OR "display_name" IS NOT NULL);

-- Ownership is transferred, never invited.
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_is_not_owner"
  CHECK ("proposed_role" <> 'owner');
