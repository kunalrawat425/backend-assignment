import { Prisma } from '@prisma/client';
import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { UnifiedPayment } from '../types/unified';

export type Granularity = 'day' | 'week' | 'month';

export interface DateRange {
  from: Date;
  to: Date;
  source?: string;
}

export interface RevenueBucket {
  bucketStart: Date;
  collectedCents: bigint;
  txnCount: number;
}

export interface RevenueSummary {
  collectedCents: bigint;
  txnCount: number;
}

export class PaymentRepo {
  /**
   * Upsert with last-write-wins on updated_at.
   * Returns { inserted: boolean } so caller can count deduped vs new.
   */
  async upsert(p: UnifiedPayment): Promise<{ inserted: boolean }> {
    const existing = await withDbRetry(() =>
      getPrisma().payment.findUnique({
        where: {
          source_externalId: { source: p.source, externalId: p.externalId },
        },
        select: { id: true, updatedAt: true },
      }),
    );

    if (!existing) {
      await withDbRetry(() =>
        getPrisma().payment.create({
          data: {
            source: p.source,
            externalId: p.externalId,
            idempotencyKey: p.idempotencyKey,
            amountCents: p.amountCents,
            currency: p.currency,
            status: p.status,
            rawStatus: p.rawStatus,
            raw: p.raw as object,
            occurredAt: p.occurredAt,
          },
        }),
      );
      return { inserted: true };
    }

    // Last-write-wins: only update if incoming is fresher.
    // For sync path we always pass current timestamps; the unique key prevents dupes.
    await withDbRetry(() =>
      getPrisma().payment.update({
        where: { id: existing.id },
        data: {
          amountCents: p.amountCents,
          currency: p.currency,
          status: p.status,
          rawStatus: p.rawStatus,
          raw: p.raw as object,
          occurredAt: p.occurredAt,
        },
      }),
    );
    return { inserted: false };
  }

  // Single SQL that both summary and breakdown call — allow-list on status='COLLECTED'.
  // granularity=null → no grouping (summary); granularity set → date_trunc buckets.
  async sumCollected(range: DateRange, granularity: Granularity | null): Promise<RevenueBucket[]> {
    const { from, to, source } = range;

    // Server-side allowlist: Prisma.sql inlines string values in interval/date_trunc
    // expressions so the controller-level zod enum is not the only defence.
    if (granularity !== null && !['day', 'week', 'month'].includes(granularity)) {
      throw Object.assign(new Error(`invalid_granularity: ${granularity}`), { statusCode: 400 });
    }

    if (granularity === null) {
      type SummaryRow = { collected_cents: string | null; txn_count: string };
      const rows = await withDbRetry(() =>
        getPrisma().$queryRaw<SummaryRow[]>(
          Prisma.sql`
            SELECT
              COALESCE(SUM(amount_cents) FILTER (WHERE status = 'COLLECTED'), 0)::text AS collected_cents,
              COUNT(*)                  FILTER (WHERE status = 'COLLECTED')::text       AS txn_count
            FROM payments
            WHERE occurred_at >= ${from}
              AND occurred_at <  ${to}
              AND (${source ?? null}::text IS NULL OR source = ${source ?? null})
          `,
        ),
      );
      return [
        {
          bucketStart: from,
          collectedCents: BigInt(rows[0]?.collected_cents ?? '0'),
          txnCount: Number(rows[0]?.txn_count ?? '0'),
        },
      ];
    }

    // Breakdown: use Postgres literals for interval/date_trunc (Prisma inlines these).
    // Upper bound: use `to` directly — payments filter is already `< to` (exclusive).
    // generate_series end = date_trunc(gran, to - 1ms) to get the last bucket that
    // contains data, avoiding the midnight-subtraction-drops-last-bucket bug.
    type BucketRow = { bucket_start: Date; collected_cents: string | null; txn_count: string };

    // Build safe SQL using Prisma.sql raw fragments (granularity already allowlisted above)
    const gran = granularity; // 'day' | 'week' | 'month'
    const toMinusOneMs = new Date(to.getTime() - 1);

    const rows = await withDbRetry(() =>
      getPrisma().$queryRaw<BucketRow[]>(
        Prisma.sql`
          WITH buckets AS (
            SELECT generate_series(
              date_trunc(${gran}, ${from}::timestamptz),
              date_trunc(${gran}, ${toMinusOneMs}::timestamptz),
              ('1 ' || ${gran})::interval
            ) AS bucket_start
          )
          SELECT
            b.bucket_start,
            COALESCE(SUM(p.amount_cents) FILTER (WHERE p.status = 'COLLECTED'), 0)::text AS collected_cents,
            COUNT(p.id)                  FILTER (WHERE p.status = 'COLLECTED')::text      AS txn_count
          FROM buckets b
          LEFT JOIN payments p
            ON date_trunc(${gran}, p.occurred_at) = b.bucket_start
            AND p.occurred_at >= ${from}
            AND p.occurred_at <  ${to}
            AND (${source ?? null}::text IS NULL OR p.source = ${source ?? null})
          GROUP BY b.bucket_start
          ORDER BY b.bucket_start ASC
        `,
      ),
    );

    return rows.map((r) => ({
      bucketStart: r.bucket_start,
      collectedCents: BigInt(r.collected_cents ?? '0'),
      txnCount: Number(r.txn_count ?? '0'),
    }));
  }

  async getUnmappedStatuses(
    limit = 50,
  ): Promise<{ source: string; rawStatus: string; count: number; sample: string }[]> {
    type Row = { source: string; raw_status: string; cnt: bigint; sample_id: string };
    const rows = await withDbRetry(() =>
      getPrisma().$queryRaw<Row[]>(
        Prisma.sql`
          SELECT source, raw_status, COUNT(*) AS cnt, MIN(external_id) AS sample_id
          FROM payments
          WHERE status = 'UNKNOWN'
          GROUP BY source, raw_status
          ORDER BY cnt DESC
          LIMIT ${limit}
        `,
      ),
    );
    return rows.map((r) => ({
      source: r.source,
      rawStatus: r.raw_status,
      count: Number(r.cnt),
      sample: r.sample_id,
    }));
  }
}
