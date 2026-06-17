-- Add phone to contacts
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "contacts" ALTER COLUMN "first_name" SET DEFAULT '';
ALTER TABLE "contacts" ALTER COLUMN "last_name" SET DEFAULT '';
ALTER TABLE "contacts" ALTER COLUMN "first_name" SET NOT NULL;
ALTER TABLE "contacts" ALTER COLUMN "last_name" SET NOT NULL;

-- Rebuild events table with new columns
-- (description, status, occurredAt; rename startsAt→startAt, endsAt→endAt, endAt nullable)
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMPTZ(6);

-- Rename starts_at → start_at (and make end_at nullable)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='starts_at') THEN
    ALTER TABLE "events" RENAME COLUMN "starts_at" TO "start_at";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='ends_at') THEN
    ALTER TABLE "events" RENAME COLUMN "ends_at" TO "end_at";
    ALTER TABLE "events" ALTER COLUMN "end_at" DROP NOT NULL;
  END IF;
END $$;

-- Fill occurred_at from start_at for existing rows, then set NOT NULL
UPDATE "events" SET "occurred_at" = "start_at" WHERE "occurred_at" IS NULL;
ALTER TABLE "events" ALTER COLUMN "occurred_at" SET NOT NULL;

-- title default
ALTER TABLE "events" ALTER COLUMN "title" SET DEFAULT '';
UPDATE "events" SET "title" = '' WHERE "title" IS NULL;
ALTER TABLE "events" ALTER COLUMN "title" SET NOT NULL;

-- Drop old index if it targeted starts_at; new index on start_at added below
DROP INDEX IF EXISTS "events_starts_at_idx";
CREATE INDEX IF NOT EXISTS "events_start_at_idx" ON "events"("start_at");
