-- ADR-005 Layer 3, spec 011: the consumer-side idempotency ledger
-- ARCHITECTURE.md §7.3 names `processed_events`, keyed on the queue as well
-- as the event.
--
-- Deliberately no row-level security: this table has no tenant to scope to —
-- it records delivery facts about the messaging mechanism, not anything
-- about a family — the same reasoning `idempotency_key` already uses
-- (ADR-017).

-- CreateTable
CREATE TABLE "processed_event" (
    "id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "processed_event_queue_name_event_id_key" ON "processed_event"("queue_name", "event_id");

-- Owned by family_platform_owner like every other table in this schema
-- (ADR-017). UPDATE is granted, not just SELECT/INSERT, because
-- `markProcessed`'s upsert compiles to a native `INSERT ... ON CONFLICT DO
-- UPDATE` even though that update is a no-op (T008, contracts/relay-
-- interfaces.md §2).
GRANT SELECT, INSERT, UPDATE ON "processed_event" TO family_platform_app;
