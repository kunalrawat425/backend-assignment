/**
 * RevenueService — THE single authoritative source for "collected revenue".
 *
 * Both /metrics/revenue (summary) and /metrics/revenue/breakdown call
 * computeCollected(). They cannot drift from each other.
 *
 * CI guard (scripts/check-single-revenue-impl.sh) prevents any other file
 * from duplicating this logic.
 */
import { DateRange, Granularity, PaymentRepo, RevenueBucket } from '../repos/payment.repo';

const MAX_RANGE_DAYS = 366;

export interface RevenueQuery {
  from: Date;
  to: Date;
  source?: string;
  granularity?: Granularity;
}

export interface RevenueSummaryResult {
  totalCollectedCents: string; // string to survive JSON BigInt serialization
  txnCount: number;
  from: string;
  to: string;
  source: string | null;
}

export interface RevenueBreakdownResult {
  granularity: Granularity;
  from: string;
  to: string;
  source: string | null;
  buckets: Array<{
    bucketStart: string;
    collectedCents: string;
    txnCount: number;
  }>;
  totalCollectedCents: string;
  totalTxnCount: number;
}

export class RevenueService {
  constructor(private readonly repo: PaymentRepo) {}

  private validateRange(from: Date, to: Date): void {
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw Object.assign(new Error('invalid_date_format'), { statusCode: 400 });
    }
    if (from >= to) {
      throw Object.assign(new Error('from_must_be_before_to'), { statusCode: 400 });
    }
    const diffDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (diffDays >= MAX_RANGE_DAYS) {
      throw Object.assign(
        new Error(`date_range_too_large: max ${MAX_RANGE_DAYS} days`),
        { statusCode: 400 },
      );
    }
  }

  // Delegates to PaymentRepo.sumCollected — no revenue logic lives outside this file.
  async computeCollected(query: RevenueQuery): Promise<RevenueBucket[]> {
    this.validateRange(query.from, query.to);
    const range: DateRange = { from: query.from, to: query.to, source: query.source };
    return this.repo.sumCollected(range, query.granularity ?? null);
  }

  async summary(query: RevenueQuery): Promise<RevenueSummaryResult> {
    const buckets = await this.computeCollected({ ...query, granularity: undefined });
    const total = buckets[0] ?? { collectedCents: 0n, txnCount: 0 };
    return {
      totalCollectedCents: total.collectedCents.toString(),
      txnCount: total.txnCount,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      source: query.source ?? null,
    };
  }

  async breakdown(query: RevenueQuery & { granularity: Granularity }): Promise<RevenueBreakdownResult> {
    const buckets = await this.computeCollected(query);
    const totalCollectedCents = buckets.reduce((s, b) => s + b.collectedCents, 0n);
    const totalTxnCount = buckets.reduce((s, b) => s + b.txnCount, 0);
    return {
      granularity: query.granularity,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      source: query.source ?? null,
      buckets: buckets.map((b) => ({
        bucketStart: b.bucketStart.toISOString(),
        collectedCents: b.collectedCents.toString(),
        txnCount: b.txnCount,
      })),
      totalCollectedCents: totalCollectedCents.toString(),
      totalTxnCount,
    };
  }
}
