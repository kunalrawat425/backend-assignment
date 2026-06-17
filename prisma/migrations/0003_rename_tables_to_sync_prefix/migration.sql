-- Rename tables to have the sync_ prefix
ALTER TABLE "payments" RENAME TO "sync_payments";
ALTER TABLE "contacts" RENAME TO "sync_contacts";
ALTER TABLE "events" RENAME TO "sync_events";
ALTER TABLE "sync_cursor" RENAME TO "sync_sync_cursor";
ALTER TABLE "ingest_outbox" RENAME TO "sync_ingest_outbox";
ALTER TABLE "dlq_log" RENAME TO "sync_dlq_log";
ALTER TABLE "run_reports" RENAME TO "sync_run_reports";
ALTER TABLE "api_idempotency" RENAME TO "sync_api_idempotency";
