-- CreateEnum
CREATE TYPE "event_kind" AS ENUM ('timed', 'all_day');

-- CreateEnum
CREATE TYPE "event_category" AS ENUM ('medical', 'school', 'nursery', 'activity', 'birthday', 'holiday', 'deadline', 'social', 'household', 'other');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('confirmed', 'cancelled');

-- CreateTable
CREATE TABLE "calendar_event" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "kind" "event_kind" NOT NULL,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "start_date" DATE,
    "end_date" DATE,
    "time_zone" TEXT NOT NULL,
    "category" "event_category",
    "recurrence_rule" TEXT,
    "attachment_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "event_status" NOT NULL DEFAULT 'confirmed',
    "materialised_through" TIMESTAMPTZ(3),
    "created_by_member_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "calendar_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_occurrence" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "event_occurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_participant" (
    "event_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_participant_pkey" PRIMARY KEY ("event_id","member_id")
);

-- CreateIndex
CREATE INDEX "calendar_event_materialised_through_idx" ON "calendar_event"("materialised_through");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_event_id_family_id_key" ON "calendar_event"("id", "family_id");

-- CreateIndex
CREATE INDEX "event_occurrence_family_id_starts_at_ends_at_idx" ON "event_occurrence"("family_id", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "event_occurrence_event_id_starts_at_key" ON "event_occurrence"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "event_participant_member_id_idx" ON "event_participant"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_member_id_family_id_key" ON "family_member"("id", "family_id");

-- AddForeignKey
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_occurrence" ADD CONSTRAINT "event_occurrence_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "calendar_event"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "calendar_event"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_participant" ADD CONSTRAINT "event_participant_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "family_member"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Everything below this line is hand-written: spec 009 applying ADR-017 to
-- three more tables, unchanged. Prisma's schema language cannot express
-- grants, row-level security or CHECK constraints, and each one here is
-- load-bearing rather than incidental. The composite foreign keys and the
-- `(event_id, starts_at)` identity above ARE expressible in Prisma, so they
-- live in schema.prisma where `migrate diff` can see them, rather than here
-- where it would propose dropping them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Grants. No new role: `family_platform_app` is inherited from spec 008.
-- Explicit per table, never ALTER DEFAULT PRIVILEGES, for ADR-017's reason —
-- a grant is decided, not inherited by whatever table comes next.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "calendar_event", "event_occurrence", "event_participant"
  TO family_platform_app;

-- ---------------------------------------------------------------------------
-- Row-level security, ENABLE *and* FORCE, on all three. FORCE is what makes
-- the owner role — migrations, the seed, a psql prompt — filtered too;
-- `calendar-context.integration.spec.ts` asserts that case separately, because
-- it is the one that proves FORCE is doing something.
--
-- Fails closed, exactly as spec 008's policies do: an unset `app.family_id`
-- reads as NULL, `family_id = NULL` is NULL, and NULL is not TRUE. A forgotten
-- `withCalendarFamilyContext` returns nothing rather than everything.
--
-- No Calendar table is outside the policy set. `audit_log` remains the
-- platform's one exception (ADR-017); this feature adds none.
-- ---------------------------------------------------------------------------
ALTER TABLE "calendar_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendar_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY calendar_event_isolation ON "calendar_event"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

ALTER TABLE "event_occurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_occurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY event_occurrence_isolation ON "event_occurrence"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

ALTER TABLE "event_participant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "event_participant" FORCE ROW LEVEL SECURITY;
CREATE POLICY event_participant_isolation ON "event_participant"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

-- ---------------------------------------------------------------------------
-- The materialisation sweep's discovery reads (research.md §8, FR-024).
--
-- Finding which events, across every family, have a horizon falling behind is
-- genuinely cross-family, and the worker runs as the same NOBYPASSRLS role the
-- API does. So: SELECT only, gated on `app.is_sweep` — the one flag
-- `20260913190000_invitation_sweep_policy` introduced for "this connection is a
-- background sweep", reused rather than multiplied. Unset for every other
-- connection this platform opens, so an ordinary request is widened by
-- nothing. Every WRITE the sweep then makes goes through the ordinary
-- `app.family_id` scope, one family-scoped transaction per event.
-- ---------------------------------------------------------------------------
CREATE POLICY calendar_event_sweep_select ON "calendar_event"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');

CREATE POLICY event_occurrence_sweep_select ON "event_occurrence"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');

-- ---------------------------------------------------------------------------
-- `eraseCalendarForMember(memberId)` has a member id and no family — the
-- shape `20260913200000_erasure_policy` already solved for Family, solved the
-- same way: enough visibility, behind `app.is_erasure`, to discover which
-- families hold this member's participant rows. The deletes that follow run
-- under the ordinary family scope.
-- ---------------------------------------------------------------------------
CREATE POLICY event_participant_erasure_select ON "event_participant"
  FOR SELECT
  USING (current_setting('app.is_erasure', true) = 'true');

-- ---------------------------------------------------------------------------
-- The timed | all-day discriminated union, in the database as well as the
-- domain (data-model.md). A nullable time plus a flag is the modelling
-- Principle I names specifically; these make "an all-day event with a start
-- time" unrepresentable against a raw query as well.
-- ---------------------------------------------------------------------------
ALTER TABLE "calendar_event" ADD CONSTRAINT "event_shape" CHECK (
  ("kind" = 'timed'   AND "starts_at" IS NOT NULL AND "ends_at" IS NOT NULL
                      AND "start_date" IS NULL AND "end_date" IS NULL)
  OR
  ("kind" = 'all_day' AND "start_date" IS NOT NULL AND "end_date" IS NOT NULL
                      AND "starts_at" IS NULL AND "ends_at" IS NULL)
);

-- FR-002 as a constraint, not only a domain check.
ALTER TABLE "calendar_event" ADD CONSTRAINT "event_order" CHECK (
  ("kind" = 'timed'   AND "ends_at" >= "starts_at") OR
  ("kind" = 'all_day' AND "end_date" >= "start_date")
);

ALTER TABLE "event_occurrence" ADD CONSTRAINT "occurrence_order" CHECK ("ends_at" >= "starts_at");

-- The authored zone is an identifier, never blank. Validity against the IANA
-- set is the domain's job (the database has no copy of the runtime's ICU).
ALTER TABLE "calendar_event" ADD CONSTRAINT "event_time_zone_present" CHECK (length(trim("time_zone")) > 0);
