# Buffalo — Unified Ingestion + Revenue Metrics

A resilient, drift-free unified ingestion pipeline (Problem 1) and revenue metrics service (Problem 2) built using NestJS/Express, Prisma, and PostgreSQL.

---

## 🏛️ System Architecture

```
                    ┌─────────────────────────────────────────────────┐
                    │ Render cron jobs                                │
                    │  cron-fetch    (*/15 * * * *)                   │
                    │  cron-process  (*/5 * * * *)                    │
                    │  cron-daily-summary  (0 9 * * *)                │
                    └─────────────────────────────────────────────────┘
                                       │
                                       ▼
    ┌────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
    │ ConnectorFactory   │──▶│ ProducerJob     │──▶│ ingest_outbox    │
    │ Stripe / HubSpot / │   │  fetch → enqueue│   │ (Postgres)       │
    │ GCal               │   │  cursor advance │   └──────────────────┘
    └────────────────────┘   └─────────────────┘            │
               ▲                       │                    ▼
               │           ┌───────────┴────────┐   ┌──────────────────┐
    StaleCursor│           │                    │   │ OutboxProcessor  │
    recovery   │           ▼                    │   │  normalize       │
               │      CursorService             │   │  upsert          │
               │      RunReportService          │   │  → DLQ on poison │
               │      NotifierService           │   └──────────────────┘
               │                                            │
               │                                            ▼
               │                                  ┌──────────────────┐
               │                                  │ payments         │
               └──────────────────────────────────│ contacts         │
                                                  │ events           │
                                                  │ (Supabase pg)    │
                                                  └──────────────────┘
                                                             │
                                                             ▼
                               ┌─────────────────────────────────────┐
                               │ Express HTTP API                    │
                               │  POST /trigger/:source/:mode (admin)│
                               │  POST /webhooks/stripe              │
                               │  GET  /runs, GET /runs/:runId       │
                               │  GET  /metrics/revenue/summary      │
                               │  GET  /metrics/revenue/daily        │
                               │  GET  /metrics/revenue/weekly       │
                               │  GET  /healthz, /readyz             │
                               └─────────────────────────────────────┘
```

---

## 🧠 Critical Things No One Thinks Of (Resilience Gems)

### 1. In-Memory Aggregation for Zero-Drift Checks
Instead of running database-level date groupings (like `DATE_TRUNC` which varies across PostgreSQL, SQLite, and MySQL and is highly timezone-sensitive), we fetch:
* The absolute total sum and count from the database using aggregate tools (`_sum` and `_count`).
* The individual payment rows matching the exact filters.
* We perform the grouping (daily/weekly) **in-memory** in TypeScript, and assert that the sum of the breakdown buckets **exactly matches** the database aggregate total.
* If any drift is detected (e.g. concurrent inserts altering stats during querying), the service throws a `Critical Metric Drift Detected` error instead of returning mismatched numbers.

### 2. Transactional Outbox Pattern for API Isolation
Fetching from external APIs (Stripe/Hubspot/GCal) is slow and network-unstable. We never publish straight to message queues or final entities during a fetch loop. Instead, we write raw payloads directly to the database in a `sync_ingest_outbox` table first. Even if RabbitMQ or the downstream networks are completely down, the ingestion succeeds, and the processing is retried safely.

### 3. Safe Cursor Advancement
We advance sync cursors **only after** the outbox enqueue transaction successfully resolves in PostgreSQL. If the process crashes during a fetch, the cursor is not advanced, and the restart will fetch the page again. Duplicates are filtered at the outbox insert layer using `skipDuplicates: true` on a unique index.

### 4. Non-Blocking Readiness Probes (`/readyz`)
If external APIs fail or are rate-limited, the system status is reported as degraded, but the HTTP server's `/readyz` endpoint still returns `200 OK` as long as the core database is accessible. Returning a `503` for external sync errors causes deployment platforms (like Render or Kubernetes) to restart the container, converting a third-party API outage into local API downtime.

---

## 📥 Postman Integration & Live Testing

To run live API checks using Postman:
1. **Import the Collection**: Import the JSON file located at [postman/buffalo.postman_collection.json](./postman/buffalo.postman_collection.json) into Postman (in Postman, click **Import**, select this file from your cloned project directory, or drag-and-drop it).
2. **Configure Variables**:
   Under the Collection settings (Variables tab), set the following variables:
   * `BASE_URL`: Server endpoint (e.g. `http://localhost:3000` for local or your Render live URL).
   * `API_KEY`: Set to `f5d96a7ebcd7fbe4f691c28c894d0a1b` (or your production API key).
   * `ADMIN_API_KEY`: Set to `9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a` (or your production Admin key).
3. **Run Requests**: You can run individual routes or use the Collection Runner to sequentially test liveness, readiness, sync triggers, and drift-free revenue views.

---

## ⚡ Setup & Installation

### Prerequisites
* **Node.js**: `v20.x` or higher
* **pnpm**: `v9.x` (preferred) or npm
* **PostgreSQL**: Local Docker instance or Supabase database URL

### Local Setup Steps
1. **Clone the repository and install dependencies**:
   ```bash
   pnpm install
   ```
2. **Configure environment variables**:
   Create a `.env` file by copying the template:
   ```bash
   cp .env.example .env
   ```
   Open `.env` and fill in the PostgreSQL connection string, Stripe keys, and API tokens.
3. **Generate Prisma client bindings**:
   ```bash
   pnpm db:generate
   ```
4. **Deploy database migrations**:
   ```bash
   pnpm db:migrate:dev
   ```
5. **Start PostgreSQL database (Optional)**:
   If you don't have an external Postgres database, start one via Docker:
   ```bash
   docker compose up -d
   ```

---

## ⚙️ How to Run & Test

### Development Commands
* **Run in development mode (watcher)**:
   ```bash
   pnpm dev
   ```
* **Build TypeScript source to javascript**:
   ```bash
   pnpm build
   ```
* **Start production build locally**:
   ```bash
   pnpm start
   ```

### Verification & Test Suites
* **Run all tests (Unit & Integration)**:
   ```bash
   pnpm test
   ```
* **Run integration tests specifically**:
   ```bash
   pnpm test:integration
   ```
* **Run the automated curl test script (verifies live endpoints sequential)**:
   ```bash
   npx tsx run-curl-tests.ts
   ```
* **Run the E2E verification scenario (runs full happy-path + mock syncs)**:
   ```bash
   npx tsx run-e2e-scenario.ts
   ```
* **Run brutal chaos scenarios (simulates DB disconnects, double locks, and DLQ drops)**:
   ```bash
   npx tsx run-brutal-scenarios.ts
   ```
* **Enforce Single Source of Truth static analysis check**:
   ```bash
   pnpm check:single-revenue
   ```

---

## 📡 API Endpoints & Server Endpoints

All endpoints (except `/healthz` and `/readyz`) require authentication headers:
* **Admin endpoints** require: `X-Admin-Api-Key: <ADMIN_API_KEY>`
* **General endpoints** require: `X-Api-Key: <API_KEY>`
* **Mutating POST requests** require: `Idempotency-Key: <ANY_UNIQUE_STRING>`

### 📊 Revenue Metrics APIs

All three revenue views always agree. The daily and weekly responses return the global `totalRevenueCents` aggregate so the client always has a single source of truth.

#### 1. `GET /metrics/revenue/summary`
Returns the total accumulated revenue sum and count of collected payments.
* **Query Params**:
  * `startDate` (optional, YYYY-MM-DD)
  * `endDate` (optional, YYYY-MM-DD)
  * `source` (optional, e.g. `stripe` or `hubspot`)
* **Request**:
  ```bash
  curl "http://localhost:3000/metrics/revenue/summary?startDate=2026-06-15&endDate=2026-06-18" \
    -H "X-Api-Key: f5d96a7ebcd7fbe4f691c28c894d0a1b"
  ```
* **Response**:
  ```json
  {
    "totalRevenueCents": "82800",
    "currency": "USD",
    "count": 9,
    "startDate": "2026-06-15",
    "endDate": "2026-06-18",
    "source": null
  }
  ```

#### 2. `GET /metrics/revenue/daily`
Returns daily aggregated revenue buckets alongside the global aggregate total.
* **Request**:
  ```bash
  curl "http://localhost:3000/metrics/revenue/daily" \
    -H "X-Api-Key: f5d96a7ebcd7fbe4f691c28c894d0a1b"
  ```
* **Response**:
  ```json
  {
    "totalRevenueCents": "82800",
    "currency": "USD",
    "breakdown": [
      { "date": "2026-06-15", "amountCents": "54900", "count": 2 },
      { "date": "2026-06-16", "amountCents": "9900", "count": 1 },
      { "date": "2026-06-17", "amountCents": "18000", "count": 6 }
    ],
    "startDate": null,
    "endDate": null,
    "source": null
  }
  ```

#### 3. `GET /metrics/revenue/weekly`
Returns weekly aggregated revenue buckets (grouped by the start of the week, Monday) alongside the global aggregate total.
* **Request**:
  ```bash
  curl "http://localhost:3000/metrics/revenue/weekly" \
    -H "X-Api-Key: f5d96a7ebcd7fbe4f691c28c894d0a1b"
  ```
* **Response**:
  ```json
  {
    "totalRevenueCents": "82800",
    "currency": "USD",
    "breakdown": [
      { "weekStartDate": "2026-06-15", "amountCents": "82800", "count": 9 }
    ],
    "startDate": null,
    "endDate": null,
    "source": null
  }
  ```

---

### 🏥 System Status APIs

#### 1. `GET /healthz` (Liveness)
Indicates if the Node.js process is alive.
* **Response**:
  ```json
  { "status": "ok", "uptimeS": 120 }
  ```

#### 2. `GET /readyz` (Readiness)
Verifies database health and logs the status of the sync run history.
* **Response**:
  ```json
  {
    "status": "ok",
    "syncStatus": "healthy",
    "checks": {
      "db": { "ok": true, "latencyMs": 14 },
      "stripe": { "ok": true, "lastSync": "2026-06-17T16:08:00Z" }
    },
    "uptimeS": 120
  }
  ```

---

### ⚙️ Pipeline Control APIs

#### 1. `POST /trigger/:source/:mode` (Advisory trigger)
Triggers a background ingest job for a specific source (`stripe`, `hubspot`, `gcal`). Mode can be `incremental` or `full`.
* **Request**:
  ```bash
  curl -X POST "http://localhost:3000/trigger/stripe/incremental" \
    -H "X-Admin-Api-Key: 9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a" \
    -H "Idempotency-Key: my-unique-uuid-key"
  ```
* **Response**:
  ```json
  {
    "runId": "7bc36996-fc4d-499e-80d3-ab9527efd92e",
    "source": "stripe",
    "mode": "incremental",
    "status": "accepted"
  }
  ```

---

## 🛡️ Edge Cases Handled

### 1. Stale Cursor / Expired Sync Tokens
If a cursor becomes stale (e.g. Stripe API credentials change, Google Calendar Sync Channel expires with a `410 Gone`, or HubSpot cursor formatting changes), the connector throws a `StaleCursorError`. The producer catches this, marks the sync report as stale, resets the cursor state, and executes a full backfill sync immediately to restore data consistency.

### 2. Cron Job Double-Firing
Advisory locks via PostgreSQL `pg_try_advisory_xact_lock` are acquired on a per-source, per-entity level inside the transaction. If two cron instances or API calls fire simultaneously, the second one fails to acquire the advisory lock and immediately exits gracefully, preventing duplicate database writes and CPU spikes.

### 3. Database Connection Flapping
Prisma queries are wrapped in a retry handler (`withDbRetry`) that intercepts transient errors (like `P1001` target database connection timeout, socket hang-ups, or database pools saturated) and retries them up to 5 times with exponential backoff before failing the job.

### 4. Poison Pill Dead Letter Queue (DLQ)
If an individual raw payload fails to normalize repeatedly (e.g. because HubSpot returned a contact payload with corrupted phone formats that fail Zod validation), the processor increments its attempt counter. Once it hits **5 failures**, it shifts the payload to `sync_dlq_log` along with the exact validation error message, and marks the outbox status as `FAILED`, unblocking the rest of the queue.

### 5. Allow-List Payment Status Mapping
All raw status names from external systems (such as `requires_capture`, `partially_refunded`, etc.) default to `UNKNOWN` if they are not explicitly present in the mapped status allow-list. Mappings must be updated inside the code to count them as collected revenue, ensuring no accidental numbers contaminate the metric aggregates.
---

## 💀 Brutal Failure Mode & Recovery Analysis

### 1. What Happens if the Consumer Crashes Mid-Execution?

When `job:process` is processing a batch of records:
1. **Advisory Claiming**: The script claims rows using `SELECT ... FOR UPDATE SKIP LOCKED` inside a PostgreSQL transaction.
2. **Crash Scenario (SIGKILL, Out-of-Memory, Server Panic)**:
   * **State in Outbox**: If the process crashes mid-batch, the database connection is abruptly severed. PostgreSQL detects the dead session and **automatically releases the row locks**. Since the rows were never marked `consumed` (which only happens at the very end of the batch transaction), their statuses remain `pending`.
   * **State in Target Tables**: Some destination rows (e.g. `payments`) might have already been updated in the DB before the crash.
   * **Re-run Behavior**: When the consumer script runs again, it claims the exact same `pending` rows.
   * **Idempotency Guarantee**: Because all database writes are implemented as **Idempotent Upserts** (e.g., `ON CONFLICT (source, externalId) DO UPDATE`), reprocessing a partially written batch simply overwrites the records with the exact same data, avoiding double-insertions or duplicate revenue tracking.

---

### 2. What Happens if the Ingest Producer Crashes Mid-Page?

When `job:fetch` is fetching paginated records from Stripe, HubSpot, or Google Calendar:
1. **Paging Mechanics**: The job fetches page `N` from the external API, enqueues the records to `sync_ingest_outbox`, and **then** saves the `next_cursor` to the `sync_cursor` table.
2. **Crash Scenario**: The job crashes mid-way through fetching a page (e.g., local server loses internet connection).
   * **State in Database**: The database rolls back the active transaction. The cursor is **not** advanced to `next_cursor`.
   * **Re-run Behavior**: Upon restart, the producer reads the old cursor and re-requests page `N`.
   * **Outbox Deduping**: Since the outbox has a unique index on `(source, entity, external_id)`, the `insertMany` query uses `skipDuplicates: true` and ignores the records that were already enqueued. No duplicate payloads accumulate in the outbox.

---

### 3. Absolute Worst-Case Failures & Recovery

#### **Worst Case A: DB Connection Flapping / Flapping Outage**
* **The Failure**: The database connection drops in the middle of a transaction, comes back for 2 seconds, and drops again.
* **System Behavior**: Instead of failing immediately, the system wraps all database operations in a retry runner `withDbRetry` that handles transient Prisma errors (`P1001`, `P2024`, `ECONNRESET`). It retries up to 5 times using exponential backoff with jitter. If the database remains offline after 5 retries, the job terminates cleanly, preserving transaction boundaries.

#### **Worst Case B: Upstream API Floods Pipeline with Poison Pill Payloads**
* **The Failure**: Stripe or HubSpot changes its payload schema unexpectedly, or sends corrupted data that fails Zod validation inside our normalizers.
* **System Behavior**: 
  1. The consumer process attempts to process the item.
  2. The normalizer throws a Zod validation error, and the transaction rolls back.
  3. The consumer increments the `attempts` counter for that specific outbox row in the database.
  4. On retry, if it fails again, it repeats.
  5. Once the attempt counter hits **5**, the processor automatically catches the error, writes a detailed error report to the `sync_dlq_log` (Dead Letter Queue) table along with the full raw payload, and marks the outbox status as `FAILED`.
  6. The queue remains unblocked, and subsequent healthy payloads are processed.

#### **Worst Case C: Complete Storage Exhaustion (Disk Full)**
* **The Failure**: The database server runs out of disk space, making all inserts fail.
* **System Behavior**: Both the ingestion (`job:fetch`) and processing (`job:process`) scripts crash immediately because they cannot write cursors or outbox statuses.
* **Recovery**: Since all writes are transaction-safe, no partial or corrupted states are saved. Once disk space is freed, running the scripts resumes work from the last healthy cursors without any manual data cleaning required.

---

## 🛡️ Component Downtime & Fault Tolerance Matrix

What happens when parts of the system go down?

| Down Component | Ingestion Sync Impact | Revenue Metrics Impact | Recovery Mechanism |
| :--- | :--- | :--- | :--- |
| **Upstream APIs** (Stripe, HubSpot, GCal) | **Isolated Failure**: Failed sync reports are created. Healthy APIs continue running. | **None**: Cached and existing database metrics are still fully readable. | Cursors are NOT advanced. The pipeline retries on the next cron run using the last successful cursor state. |
| **Database** (PostgreSQL/Supabase) | **Paused Sync**: Ingestion and Outbox processing pause safely. | **Service Outage**: HTTP metrics API calls fail with a `500` error. | `withDbRetry` retries queries with exponential backoff. Ingestion resumes from last cursors when DB recovers. |
| **Outbox Consumer** (Processor Job) | **Data Buffered**: Fetches write raw events to `sync_ingest_outbox` successfully but final tables don't update. | **Stale Metrics**: Metrics remain accessible but do not reflect newly ingested data. | Queue drains sequentially on processor restart. Atomic transactions ensure no lost messages. |
| **Express HTTP Server** (Web App Container) | **None**: Scheduled ingestion fetches and processing jobs run via CLI cron tasks (`job:fetch` / `job:process`) independently. | **API Outage**: Clients cannot retrieve metrics via HTTP requests. | Cron scripts continue running in isolated processes; HTTP server auto-restarts via Render health check. |

---

## 🧩 Reliability, Flexibility & Fault Tolerance (Per Task)

### 📈 Task 1: Ingestion Sync Pipeline
* **Reliability**: Decouples network API requests from database processing using the **Transactional Outbox Pattern**. This completely eliminates the "dual-write" problem where a database update succeeds but queue publication fails.
* **Code Flexibility**: Employs the **Strategy Pattern** via `ConnectorFactory` and `BaseConnector`. Integrating a new payment provider (e.g. PayPal) only requires subclassing `BaseConnector` and adding its custom schema mapper.
* **Fault Tolerance**: Automatic fallback to **Full Backfill** if a cursor is invalidated (e.g. `StaleCursorError`). Bad/malformed payloads are automatically isolated in `sync_dlq_log` after 5 failed attempts, preventing queue blocks.

### 📊 Task 2: Revenue Metrics Service
* **Reliability**: Exposes a unified query builder (`computeRevenue`) as the **Single Source of Truth (SSOT)**. Daily, weekly, and summary metrics run the same query constraints, ensuring they never drift.
* **Code Flexibility**: Aggregations are calculated in-memory rather than relying on complex SQL functions. This keeps the service database-engine agnostic (run testing on SQLite, production on PostgreSQL/Supabase).
* **Fault Tolerance**: Unmapped payment statuses default to `UNKNOWN` instead of throwing errors. They are logged as warnings and omitted from revenue calculations until explicitly mapped, preventing accounting leakages.

---

## 🧪 Comprehensive Testing Strategy & Production Simulation

We maintain a rigorous multi-tier testing strategy ensuring system reliability under brutal workloads:

### 1. Common Reasons for System Crashes
* **Memory Exhaustion (OOM)**: Pulling massive datasets from upstream APIs into large in-memory arrays during deep sync backfills.
* **Network & Connection Flapping**: Socket timeouts, rate limit blocks, or transient TCP packet drops while connecting to Stripe, HubSpot, Google Calendar, or the Supabase database.
* **Concurrency Lockups & Race Conditions**: Multiple workers writing/updating the same entity tables concurrently, leading to database deadlocks.
* **Validation Failures & Schema Drift**: Upstream APIs releasing unexpected payload shifts, causing JSON schema validations (Zod) to crash standard processors.

### 2. Active Crash & Failure Injection Tests (`run-brutal-scenarios.ts`)
We run automated scripts that intentionally trigger crashes and verify recovery:
* **Database Connection Flapping Check**: Simulates packet loss during database queries. Asserts that `withDbRetry` intercepts the exception, executes exponential backoff, and resolves the query successfully on the 3rd attempt without crashing.
* **Advisory Lock Double-Firing Check**: Simulates two concurrent transactions attempting to acquire the same Postgres advisory lock for `stripe:payments`. Asserts that the second transaction fails to acquire the lock immediately, preventing double syncs.
* **Poison Pill Ingestion Check**: Inserts an invalid payment payload (unsupported currency 'EUR') with attempts set to 4. Asserts that the consumer catches the failure on the 5th attempt, writes a detailed error report to the `sync_dlq_log` (DLQ) table, and marks the outbox status as `FAILED` to unblock other messages.

### 3. Load Testing & High-Volume Strategy
* **Batching and Pagination**: We implement pagination with a page size of 50 to prevent OOM errors when processing millions of Stripe/Hubspot rows.
* **Outbox Claim Limits**: The Outbox consumer claims entries in batches of `OUTBOX_BATCH_SIZE = 50` inside a loop instead of loading all pending rows, keeping the memory footprint constant.
* **Database Connection Pooling**: Prisma Client is configured with direct connection limits (`connection_limit=5`) to prevent connection exhaustion.
* **Throttling**: We implement Bottleneck rate-limiting queues to stay compliant with upstream API thresholds.

### 4. Uncertain Situations Where Things Can Go Wrong
* **Precision Loss on Large Integers**: If HubSpot deal values or Stripe charge amounts exceed JavaScript's max safe integer, precision loss occurs. We use `BigInt` (mapped to Postgres `bigint` and serialized safely as strings in API JSON) to keep exact cents accuracy.
* **Timezone discrepancies**: If a third-party source sends timestamps without explicit offsets or local timezone formatting, daily/weekly aggregations could result in a 1-day metric shift. The system parses all ISO dates using strict UTC bounds (`toISOString().split('T')[0]`) to maintain timezone coherence across machines.

---

## 🧠 Critical Engineering Decisions

* **PostgreSQL Outbox instead of RabbitMQ**: RabbitMQ introduces broker downtime, message lost on unacknowledged connections, and out-of-order writes. Implementing an outbox table in Postgres allows the ingestion queue to share the same atomic transaction context as target tables.
* **Static Analysis CI Guard (`check-single-revenue-impl.sh`)**: We built a custom shell scanner script that runs in CI. It fails the build if developer code attempts to duplicate status-based revenue queries outside of the canonical `RevenueService.ts`, enforcing the SSOT property automatically.
* **Advisory Locks**: The cron jobs acquire database-level advisory transaction locks (`pg_try_advisory_xact_lock`). If multiple instances run simultaneously, they skip without throwing errors or locking table rows.

---

## Sources & references

- Stripe Node SDK — https://docs.stripe.com/api?lang=node
- HubSpot CRM API v3 — https://developers.hubspot.com/docs/api/crm/deals
- Google Calendar API — https://developers.google.com/calendar/api/v3/reference/events/list
- Prisma migrations — https://www.prisma.io/docs/concepts/components/prisma-migrate
- Postgres advisory locks — https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS
- Outbox pattern — https://microservices.io/patterns/data/transactional-outbox.html
- Render free tier specifics — https://render.com/docs/free
- Supabase pgbouncer config — https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler

## AI usage

This project was built collaboratively with Claude (Anthropic). Chat share link: `<add before submission>`.
