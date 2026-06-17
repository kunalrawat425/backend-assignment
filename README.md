# Buffalo — Unified Ingestion + Revenue Metrics

Backend assignment: a sync pipeline that doesn't lie or duplicate data (Problem 1) and a revenue metrics service that never drifts (Problem 2).

> **Status**: Task 1 (Ingestion) — Stripe end-to-end built. HubSpot + Google Calendar connectors, notifier, metrics service, OpenAPI docs land in subsequent sprints (see `Sprint plan` below).

---

## Architecture (one Express service, Postgres outbox for durability)

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
                              │ Express HTTP                        │
                              │  POST /trigger/:source/:mode (admin)│
                              │  POST /webhooks/stripe              │
                              │  GET  /runs, GET /runs/:runId       │
                              │  GET  /metrics/revenue (Task 2)     │
                              │  GET  /healthz, /readyz             │
                              └─────────────────────────────────────┘
```

## Key correctness properties

| Property | How |
|---|---|
| Idempotent writes | `payments_source_external_id_key` unique index + upsert; idempotency key = `sha256(source\|external_id)` (no timestamps, stable) |
| Same webhook fired twice | Webhook handler enqueues to outbox; outbox unique key `(source,entity,external_id,run_id)` dedupes; final upsert idempotent |
| Stale cursor → full backfill | `StaleCursorError` thrown by connector (e.g. Stripe `401`, GCal `410`, HubSpot expired token) → `CursorService.reset()` → producer switches to `fetchFull()`. Rate-limited to 1/hr per source. |
| One source down, others continue | `ProducerJob.runAll()` wraps each source in try/catch; failure logged in `run_reports`, others unaffected |
| Allow-list, NOT exclusion (Task 2) | `mapStatus()` returns `UNKNOWN` for any raw status not explicitly mapped — never silently counted as collected |
| Two views always agree (Task 2) | Single `RevenueService.computeCollected()` powers both endpoints. CI guard (`scripts/check-single-revenue-impl.sh`) rejects any second implementation |
| Cron double-fire | `pg_try_advisory_xact_lock(hashtext(source||':'||entity))` per run; second cron tick exits gracefully |
| API double-fire | `Idempotency-Key` header on all mutating POSTs; response cached 24h |
| Webhook replay | Stripe SDK `constructEvent` (5-min tolerance + HMAC); HubSpot timestamp + signature (Sprint 2) |
| DB up-flap | `withDbRetry(fn)` wraps every Prisma call; retries `P1001/P1017/P2024/ECONNRESET` with exponential backoff |
| PII never logged | `LoggerService` redacts `email/phone/card/address/token/...` at any nesting depth |

## API

All requests require `X-Api-Key` header (admin endpoints require `X-Admin-Api-Key`). Mutating POSTs require `Idempotency-Key` header (any UUID/string; replays return stored response within 24h).

### `GET /healthz` — liveness

```bash
curl https://buffalo.onrender.com/healthz
```
```json
{ "status": "ok", "uptimeS": 421 }
```

### `GET /readyz` — readiness

```bash
curl https://buffalo.onrender.com/readyz
```
```json
{
  "status": "ok",
  "checks": {
    "db":      { "ok": true,  "latencyMs": 12 },
    "stripe":  { "ok": true,  "lastSync": "2026-06-17T14:02:30Z" }
  },
  "uptimeS": 421
}
```
Returns `503 degraded` if any check fails.

### `POST /trigger/:source/:mode` — async sync trigger (admin)

Returns `202` immediately and runs work in background. Avoids Render's 30-s HTTP timeout on full backfills.

```bash
curl -X POST https://buffalo.onrender.com/trigger/stripe/incremental \
  -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```
```json
{ "runId": "5b3a...", "source": "stripe", "mode": "incremental", "status": "accepted" }
```

Modes:
- `incremental` — uses current cursor; falls back to full on stale cursor.
- `full` — resets cursor and runs full backfill.

### `POST /webhooks/stripe` — Stripe webhook ingress

Stripe sends, signed via `Stripe-Signature`. SDK `constructEvent` verifies; invalid sig returns `400`. Handlers enqueue charge / refund to outbox.

```
Subscribed events: charge.{succeeded,updated,failed,captured,pending,refunded}, refund.{created,updated}
```

### `GET /runs` — recent run reports

```bash
curl "https://buffalo.onrender.com/runs?source=stripe&limit=5" -H "X-Api-Key: $API_KEY"
```
```json
{
  "runs": [{
    "runId": "5b3a...",
    "source": "stripe",
    "mode": "incremental",
    "startedAt": "2026-06-17T14:02:11Z",
    "finishedAt": "2026-06-17T14:02:38Z",
    "staleCursorDetected": false,
    "fullBackfillTriggered": false,
    "counts": {
      "pagesFetched": 4,
      "recordsFetched": 187,
      "recordsUpserted": 181,
      "recordsDeduped": 4,
      "recordsFailed": 2
    },
    "failedRecords": [
      { "externalId": "pi_3Nx...", "stage": "normalize",
        "error": "status 'partial_capture' UNKNOWN",
        "rawPreview": "{\"id\":\"pi_3Nx...\",\"status\":\"partial_capture\",..." }
    ],
    "status": "partial"
  }]
}
```

### `GET /runs/:runId` — single run detail

Same shape, single object.

---

## Status mapping (Task 2 — allow-list)

Per-source maps under `src/normalizers/status/maps/`. Same raw word means different things across processors (e.g., Stripe `authorized` ≠ Adyen `Authorised`). Adding a new raw status to an existing source → `UNKNOWN` until explicitly mapped → NEVER silently counted as revenue.

| Source | Raw | Mapped |
|---|---|---|
| Stripe (charge) | `succeeded` / `paid` | COLLECTED |
| Stripe (charge) | `processing` / `requires_*` | PENDING |
| Stripe (charge) | `canceled` | VOIDED |
| Stripe (charge) | `failed` | FAILED |
| Stripe (refund) | `succeeded` | REFUNDED |
| Stripe (refund) | `failed` | FAILED |
| HubSpot deal | `closedwon` / `paid` / `completed` | COLLECTED |
| HubSpot deal | `closedlost` | FAILED |
| HubSpot deal | other pipeline stages | PENDING |
| **any unknown raw** | | **UNKNOWN** |

Full vocabulary table including PayPal/Square/Adyen/Braintree/QuickBooks/Xero in `docs/STATUS-MAP.md` (next sprint).

---

## Local development

### Prerequisites
- Node.js ≥ 20
- pnpm 9 (or npm)
- Docker (for local Postgres)

### Bootstrap
```bash
# 1. Install deps
pnpm install

# 2. Copy env, fill in Stripe test-mode key + Supabase URL
cp .env.example .env
# edit .env: DATABASE_URL, API_KEY (any 32-char), ADMIN_API_KEY, STRIPE_API_KEY=sk_test_xxx

# 3. Start local Postgres
docker compose up -d
# or use your Supabase URL directly

# 4. Apply migrations
pnpm db:migrate:dev

# 5. Run typecheck + tests
pnpm build
pnpm test

# 6. Start server (defaults to port 3000)
pnpm dev
```

### Run a manual fetch from your local terminal
```bash
# Stripe charges → outbox → payments table
pnpm job:fetch
pnpm job:process

# Or via API
curl -X POST http://localhost:3000/trigger/stripe/incremental \
  -H "X-Admin-Api-Key: $ADMIN_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)"
```

### Verify idempotency
```bash
# Run twice in a row
pnpm job:fetch && pnpm job:process
pnpm job:fetch && pnpm job:process

# Count payments — should be unchanged on second run
psql $DATABASE_URL -c 'SELECT count(*) FROM payments;'
```

---

## Test environment

- **Stripe test mode** — seeded via Stripe CLI:
  ```bash
  stripe trigger payment_intent.succeeded   # creates a real test charge
  stripe trigger charge.refunded
  ```
- **Postgres** — `docker compose up postgres` (local) or Supabase free project.

---

## Sprint plan (where we are)

| Sprint | Scope | Status |
|---|---|---|
| S0 | Repo, config, logger, db, retry, prisma init | ✅ done |
| S1 | Stripe connector + normalizer + outbox + producer + processor + base API | ✅ done |
| S2 | HubSpot + GCal connectors, isolation tests, webhook idempotency | ⏭ next |
| S3 | NotifierService + admin endpoints + edge-case integration tests | ⏭ |
| S4 | RevenueService (Task 2) + summary/breakdown endpoints + CI guard | ⏭ |
| S5 | OpenAPI + Swagger UI + Postman collections + README polish + Render deploy | ⏭ |

---

## Tradeoffs (assignment scope)

- **Single Express service, NO RabbitMQ** — Postgres outbox provides the same durability + idempotency guarantees with one less hosted dependency. Justified in plan-eng-review.
- **Single-currency USD** for the assignment — multi-currency would need `GROUP BY currency` everywhere; out of scope. Non-USD charges go to DLQ with explicit error.
- **Refunds as separate rows** — `status=REFUNDED`, positive `amount_cents`. `computeCollected()` sums COLLECTED only; refunds NOT subtracted (assignment defines "collected" as inflows). Optional `?net=true` endpoint deducts refunds.
- **API-key auth, not OAuth** — assignment spec: "auth gaurd just a security API KEY hardcoded".
- **No AI status classification** — spec demands allow-list; Gemini-classify would silently let new statuses through as revenue.

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
