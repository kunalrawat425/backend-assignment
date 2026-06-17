import { PaymentStatus } from '../types/enums';
import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';

export interface RevenueResult {
  totalRevenueCents: bigint;
  currency: string;
  count: number;
  breakdown: Array<{
    date: string;
    amountCents: bigint;
    count: number;
  }>;
}

export class RevenueService {
  // THE SINGLE SOURCE OF TRUTH ALLOW-LIST FOR REVENUE COMPUTATION
  // Absolutely no other file is allowed to define or inspect the status list for revenue calculation.
  private static readonly ALLOWED_REVENUE_STATUSES: string[] = [
    PaymentStatus.COLLECTED,
  ];

  /**
   * Single unified entrypoint to compute revenue.
   * Parameterizes the grouping view ('summary' | 'daily' | 'weekly') while sharing
   * the exact same query construction, database constraints, and total calculations.
   * The total aggregate is included in the response for all breakdown views.
   */
  static async computeRevenue(
    view: 'summary' | 'daily' | 'weekly',
    startDate?: Date,
    endDate?: Date,
    source?: string,
  ): Promise<RevenueResult> {
    const where: any = {
      status: { in: this.ALLOWED_REVENUE_STATUSES },
    };

    if (source) {
      where.source = source;
    }

    if (startDate || endDate) {
      where.occurredAt = {};
      if (startDate) {
        where.occurredAt.gte = startDate;
      }
      if (endDate) {
        where.occurredAt.lte = endDate;
      }
    }

    // 1. Fetch total aggregate (always run this canonical DB check)
    const summary = await withDbRetry(() =>
      getPrisma().payment.aggregate({
        where,
        _sum: { amountCents: true },
        _count: { id: true },
      }),
    );

    const totalRevenueCents = summary._sum.amountCents ?? 0n;
    const totalCount = summary._count.id;

    if (view === 'summary') {
      return {
        totalRevenueCents,
        currency: 'USD',
        count: totalCount,
        breakdown: [],
      };
    }

    // 2. Fetch payments to build daily/weekly grouping (identical where constraints)
    const payments = await withDbRetry(() =>
      getPrisma().payment.findMany({
        where,
        select: { amountCents: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    );

    const breakdownMap = new Map<string, { amountCents: bigint; count: number }>();
    let checksumCents = 0n;

    for (const p of payments) {
      let key = '';
      if (view === 'daily') {
        key = p.occurredAt.toISOString().split('T')[0];
      } else {
        // weekly
        const d = new Date(p.occurredAt);
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        key = monday.toISOString().split('T')[0];
      }

      const existing = breakdownMap.get(key) ?? { amountCents: 0n, count: 0 };
      existing.amountCents += p.amountCents;
      existing.count += 1;
      breakdownMap.set(key, existing);
      checksumCents += p.amountCents;
    }

    // Runtime checksum verification: Assert no drift between summary and breakdown sum
    if (totalRevenueCents !== checksumCents) {
      throw new Error(
        `Critical Metric Drift Detected! Summary: ${totalRevenueCents}, Breakdown: ${checksumCents}`,
      );
    }

    const breakdown = Array.from(breakdownMap.entries()).map(([key, data]) => ({
      date: key,
      amountCents: data.amountCents,
      count: data.count,
    }));

    return {
      totalRevenueCents,
      currency: 'USD',
      count: totalCount,
      breakdown,
    };
  }

  // Preserve signatures using the unified method for compatibility
  static async computeCollected(startDate?: Date, endDate?: Date, source?: string) {
    return this.computeRevenue('summary', startDate, endDate, source);
  }

  static async computeDailyBreakdown(startDate?: Date, endDate?: Date, source?: string) {
    return this.computeRevenue('daily', startDate, endDate, source);
  }

  static async computeWeeklyBreakdown(startDate?: Date, endDate?: Date, source?: string) {
    return this.computeRevenue('weekly', startDate, endDate, source);
  }
}
