-- ADR-006, Constitution Principle IX: `Idempotency-Key` on every creating
-- route. `POST /v1/families` is the first to need real storage for it — see
-- the schema comment on `IdempotencyKey` for why registration's own
-- duplicate-request handling (a unique constraint) does not generalise here.
--
-- Deliberately no row-level security: this table has no tenant to scope to
-- (it exists to protect the one call — creating a family — that runs before
-- any tenant exists), the same reasoning `audit_log` already uses for why it
-- sits outside the policy set (ADR-017).

CREATE TABLE "idempotency_key" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_key_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_key_user_id_key_key" ON "idempotency_key"("user_id", "key");

-- Owned by family_platform_owner like every other table in this schema
-- (ADR-017); handed the same grant shape as the operational tables — the
-- application role both checks for an existing record and writes a new one.
GRANT SELECT, INSERT ON "idempotency_key" TO family_platform_app;
