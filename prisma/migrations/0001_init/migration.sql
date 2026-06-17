-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "raw_status" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "raw" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "title" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "raw" JSONB NOT NULL,
    "ingested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursor" (
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "cursor" TEXT,
    "last_full_sync_at" TIMESTAMPTZ(6),
    "last_full_attempt_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sync_cursor_pkey" PRIMARY KEY ("source","entity")
);

-- CreateTable
CREATE TABLE "ingest_outbox" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "run_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ingest_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dlq_log" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "external_id" TEXT,
    "payload" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL,
    "run_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dlq_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_reports" (
    "run_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6),
    "cursor_before" TEXT,
    "cursor_after" TEXT,
    "stale_cursor_detected" BOOLEAN NOT NULL DEFAULT false,
    "full_backfill_triggered" BOOLEAN NOT NULL DEFAULT false,
    "full_backfill_reason" TEXT,
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_fetched" INTEGER NOT NULL DEFAULT 0,
    "records_upserted" INTEGER NOT NULL DEFAULT 0,
    "records_deduped" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "failed_records" JSONB NOT NULL DEFAULT '[]',
    "batches" JSONB NOT NULL DEFAULT '[]',
    "unmapped_statuses_seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'running',
    "notified_at" TIMESTAMPTZ(6),

    CONSTRAINT "run_reports_pkey" PRIMARY KEY ("run_id")
);

-- CreateTable
CREATE TABLE "api_idempotency" (
    "key" TEXT NOT NULL,
    "route_key" TEXT NOT NULL,
    "response_body" JSONB NOT NULL,
    "status_code" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("key")
);

-- Indexes
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");
CREATE INDEX "payments_occurred_at_idx" ON "payments"("occurred_at");
CREATE INDEX "payments_status_occurred_at_idx" ON "payments"("status", "occurred_at");
CREATE INDEX "payments_source_occurred_at_idx" ON "payments"("source", "occurred_at");
CREATE UNIQUE INDEX "payments_source_external_id_key" ON "payments"("source", "external_id");

CREATE UNIQUE INDEX "contacts_idempotency_key_key" ON "contacts"("idempotency_key");
CREATE UNIQUE INDEX "contacts_source_external_id_key" ON "contacts"("source", "external_id");

CREATE UNIQUE INDEX "events_idempotency_key_key" ON "events"("idempotency_key");
CREATE INDEX "events_starts_at_idx" ON "events"("starts_at");
CREATE UNIQUE INDEX "events_source_external_id_key" ON "events"("source", "external_id");

CREATE UNIQUE INDEX "ingest_outbox_source_entity_external_id_run_id_key" ON "ingest_outbox"("source", "entity", "external_id", "run_id");
CREATE INDEX "ingest_outbox_status_created_at_idx" ON "ingest_outbox"("status", "created_at");

CREATE INDEX "dlq_log_source_created_at_idx" ON "dlq_log"("source", "created_at");

CREATE INDEX "run_reports_source_started_at_idx" ON "run_reports"("source", "started_at");

CREATE INDEX "api_idempotency_expires_at_idx" ON "api_idempotency"("expires_at");
