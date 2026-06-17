import { PaymentStatus } from '../types/enums';
import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';

export interface RevenueSummary {
  totalRevenueCents: bigint;
  currency: string;
  count: number;
}

export interface RevenueBreakdownEntry {
  date: string; // YYYY-MM-DD
  amountCents: bigint;
  count: number;
}

export interface RevenueBreakdown {
  totalRevenueCents: bigint;
  currency: string;
  breakdown: RevenueBreakdownEntry[];
}

export class RevenueService {
  // THE SINGLE SOURCE OF TRUTH ALLOW-LIST FOR REVENUE COMPUTATION
  // Absolutely no other file is allowed to define or inspect the status list for revenue calculation.
  private static readonly ALLOWED_REVENUE_STATUSES: string[] = [
    PaymentStatus.COLLECTED,
  ];

  /**
   * Computes the total collected revenue.
   * This is the single, canonical SQL logic for revenue.
   */
  static async computeCollected(startDate?: Date, endDate?: Date, source?: string): Promise<RevenueSummary> {
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

    const result = await withDbRetry(() =>
      getPrisma().payment.aggregate({
        where,
        _sum: { amountCents: true },
        _count: { id: true },
      }),
    );

    return {
      totalRevenueCents: result._sum.amountCents ?? 0n,
      currency: 'USD',
      count: result._count.id,
    };
  }

  /**
   * Computes the daily breakdown of collected revenue.
   * We assert that the sum of the daily breakdown matches computeCollected() exactly.
   */
  static async computeDailyBreakdown(startDate?: Date, endDate?: Date, source?: string): Promise<RevenueBreakdown> {
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

    // Fetch matching payments and group in memory to ensure 100% data consistency
    const payments = await withDbRetry(() =>
      getPrisma().payment.findMany({
        where,
        select: { amountCents: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    );

    const breakdownMap = new Map<string, { amountCents: bigint; count: number }>();
    let totalCents = 0n;

    for (const p of payments) {
      const dateStr = p.occurredAt.toISOString().split('T')[0];
      const existing = breakdownMap.get(dateStr) ?? { amountCents: 0n, count: 0 };
      existing.amountCents += p.amountCents;
      existing.count += 1;
      breakdownMap.set(dateStr, existing);
      totalCents += p.amountCents;
    }

    // Metric Drift Runtime Assertion: Validate breakdown total equals aggregate total
    const summary = await this.computeCollected(startDate, endDate, source);
    if (summary.totalRevenueCents !== totalCents) {
      throw new Error(
        `Critical Metric Drift Detected! Summary: ${summary.totalRevenueCents}, Breakdown: ${totalCents}`,
      );
    }

    const breakdown: RevenueBreakdownEntry[] = Array.from(breakdownMap.entries()).map(
      ([date, data]) => ({
        date,
        amountCents: data.amountCents,
        count: data.count,
      }),
    );

    return {
      totalRevenueCents: totalCents,
      currency: 'USD',
      breakdown,
    };
  }

  /**
   * Computes the weekly breakdown of collected revenue.
   * Asserts no drift compared to computeCollected().
   */
  static async computeWeeklyBreakdown(startDate?: Date, endDate?: Date, source?: string): Promise<RevenueBreakdown> {
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

    const payments = await withDbRetry(() =>
      getPrisma().payment.findMany({
        where,
        select: { amountCents: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      }),
    );

    const breakdownMap = new Map<string, { amountCents: bigint; count: number }>();
    let totalCents = 0n;

    for (const p of payments) {
      const d = new Date(p.occurredAt);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      const monday = new Date(d.setDate(diff));
      const weekStr = monday.toISOString().split('T')[0];

      const existing = breakdownMap.get(weekStr) ?? { amountCents: 0n, count: 0 };
      existing.amountCents += p.amountCents;
      existing.count += 1;
      breakdownMap.set(weekStr, existing);
      totalCents += p.amountCents;
    }

    // Validate breakdown total equals aggregate total
    const summary = await this.computeCollected(startDate, endDate, source);
    if (summary.totalRevenueCents !== totalCents) {
      throw new Error(
        `Critical Metric Drift Detected! Summary: ${summary.totalRevenueCents}, Breakdown: ${totalCents}`,
      );
    }

    const breakdown: RevenueBreakdownEntry[] = Array.from(breakdownMap.entries()).map(
      ([week, data]) => ({
        date: week, // start day of week
        amountCents: data.amountCents,
        count: data.count,
      }),
    );

    return {
      totalRevenueCents: totalCents,
      currency: 'USD',
      breakdown,
    };
  }
}
