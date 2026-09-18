-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('open', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "task_priority" AS ENUM ('low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "task_category" AS ENUM ('household', 'school', 'health', 'finance', 'admin', 'other');

-- CreateEnum
CREATE TYPE "task_due_kind" AS ENUM ('none', 'date', 'date_time');

-- CreateTable
CREATE TABLE "task" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "priority" "task_priority" NOT NULL DEFAULT 'normal',
    "category" "task_category",
    "status" "task_status" NOT NULL DEFAULT 'open',
    "due_kind" "task_due_kind" NOT NULL DEFAULT 'none',
    "due_date" DATE,
    "due_local_time" TIME(0),
    "time_zone" TEXT,
    "due_at" TIMESTAMPTZ(3),
    "recurrence_rule" TEXT,
    "recurrence_anchor" TIMESTAMP(0),
    "series_id" TEXT,
    "predecessor_id" TEXT,
    "is_series_head" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_member_id" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_member_id" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "overdue_reported_for" TIMESTAMPTZ(3),
    "created_by_member_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignment" (
    "task_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_member_id" TEXT,

    CONSTRAINT "task_assignment_pkey" PRIMARY KEY ("task_id","member_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_predecessor_id_key" ON "task"("predecessor_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_id_family_id_key" ON "task"("id", "family_id");

-- CreateIndex
CREATE INDEX "task_assignment_member_id_idx" ON "task_assignment"("member_id");

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task" ADD CONSTRAINT "task_predecessor_id_fkey" FOREIGN KEY ("predecessor_id") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_task_id_family_id_fkey" FOREIGN KEY ("task_id", "family_id") REFERENCES "task"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "family_member"("id", "family_id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ===========================================================================
-- Everything below this line is hand-written: spec 010 applying ADR-017 to two
-- more tables, unchanged, plus the invariants the successor rule and the
-- overdue sweep rest on. Prisma's schema language cannot express grants,
-- row-level security, CHECK constraints or partial indexes, and each one here
-- is load-bearing rather than incidental. The composite foreign keys and the
-- `predecessor_id` uniqueness above ARE expressible in Prisma, so they live in
-- schema.prisma where `migrate diff` can see them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Grants. No new role: `family_platform_app` is inherited from spec 008.
-- Explicit per table, never ALTER DEFAULT PRIVILEGES (ADR-017).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "task", "task_assignment" TO family_platform_app;

-- ---------------------------------------------------------------------------
-- Row-level security, ENABLE *and* FORCE, on both. Fails closed exactly as
-- specs 008 and 009's policies do: an unset `app.family_id` reads as NULL and
-- NULL is not TRUE, so a forgotten `withTasksFamilyContext` returns nothing.
-- No Tasks table is outside the policy set.
-- ---------------------------------------------------------------------------
ALTER TABLE "task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_isolation ON "task"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

ALTER TABLE "task_assignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_assignment" FORCE ROW LEVEL SECURITY;
CREATE POLICY task_assignment_isolation ON "task_assignment"
  USING ("family_id" = current_setting('app.family_id', true))
  WITH CHECK ("family_id" = current_setting('app.family_id', true));

-- ---------------------------------------------------------------------------
-- The overdue sweep's discovery read (research.md §5): genuinely
-- cross-family, SELECT only, gated on the existing `app.is_sweep` flag. Every
-- write the sweep makes runs under `app.family_id`, one task per transaction.
-- ---------------------------------------------------------------------------
CREATE POLICY task_sweep_select ON "task"
  FOR SELECT
  USING (current_setting('app.is_sweep', true) = 'true');

-- ---------------------------------------------------------------------------
-- `eraseTasksForMember(memberId)` has a member id and no family: discovery
-- behind the existing `app.is_erasure` flag, deletes under the family scope.
-- ---------------------------------------------------------------------------
CREATE POLICY task_assignment_erasure_select ON "task_assignment"
  FOR SELECT
  USING (current_setting('app.is_erasure', true) = 'true');

-- ---------------------------------------------------------------------------
-- The discriminated unions, in the database as well as the domain
-- (data-model.md). A time without a zone, a rule without a due date, or a
-- completed task with a cancellation time are unrepresentable against a raw
-- query as well.
-- ---------------------------------------------------------------------------
ALTER TABLE "task" ADD CONSTRAINT "task_due_shape" CHECK (
  ("due_kind" = 'none'      AND "due_date" IS NULL     AND "due_local_time" IS NULL
                            AND "time_zone" IS NULL    AND "due_at" IS NULL)
  OR ("due_kind" = 'date'      AND "due_date" IS NOT NULL AND "due_local_time" IS NULL
                            AND "time_zone" IS NOT NULL AND "due_at" IS NOT NULL)
  OR ("due_kind" = 'date_time' AND "due_date" IS NOT NULL AND "due_local_time" IS NOT NULL
                            AND "time_zone" IS NOT NULL AND "due_at" IS NOT NULL)
);

ALTER TABLE "task" ADD CONSTRAINT "task_recurrence_shape" CHECK (
  ("recurrence_rule" IS NULL AND "recurrence_anchor" IS NULL)
  OR ("recurrence_rule" IS NOT NULL AND "recurrence_anchor" IS NOT NULL
      AND "series_id" IS NOT NULL AND "due_kind" <> 'none')
);

ALTER TABLE "task" ADD CONSTRAINT "task_status_shape" CHECK (
  ("status" = 'open'         AND "completed_at" IS NULL     AND "cancelled_at" IS NULL)
  OR ("status" = 'completed' AND "completed_at" IS NOT NULL AND "cancelled_at" IS NULL)
  OR ("status" = 'cancelled' AND "cancelled_at" IS NOT NULL AND "completed_at" IS NULL)
);

-- `closed_at` is a plain column rather than a generated one so that
-- schema.prisma can describe it without drifting; this keeps it honest.
ALTER TABLE "task" ADD CONSTRAINT "task_closed_at_consistent" CHECK (
  "closed_at" IS NOT DISTINCT FROM COALESCE("completed_at", "cancelled_at")
);

ALTER TABLE "task" ADD CONSTRAINT "task_head_is_in_a_series" CHECK (
  NOT "is_series_head" OR "series_id" IS NOT NULL
);

ALTER TABLE "task" ADD CONSTRAINT "task_title_present" CHECK (length(trim("title")) > 0);
ALTER TABLE "task" ADD CONSTRAINT "task_version_positive" CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------
-- Indexes Prisma cannot express.
-- ---------------------------------------------------------------------------

-- FR-019, SC-006: exactly one head per series. Clearing the old head's flag
-- and inserting the successor happen in that order in one transaction
-- (research.md §3), because a partial unique index is checked per statement.
CREATE UNIQUE INDEX "task_one_head_per_series" ON "task" ("series_id")
  WHERE "is_series_head";

-- The open list, keyset-paginated over (due_at NULLS LAST, id).
CREATE INDEX "task_open_list_idx" ON "task" ("family_id", "due_at" ASC NULLS LAST, "id")
  WHERE "status" = 'open';

-- History over closure time.
CREATE INDEX "task_history_idx" ON "task" ("family_id", "closed_at")
  WHERE "status" <> 'open';

-- The overdue sweep (research.md §5). A reported task drops out of the index,
-- so years of history cost the sweep nothing.
CREATE INDEX "task_overdue_unreported_idx" ON "task" ("due_at")
  WHERE "status" = 'open'
    AND "due_at" IS NOT NULL
    AND "overdue_reported_for" IS DISTINCT FROM "due_at";
