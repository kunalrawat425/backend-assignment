import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { apiKeyGuard } from '../../auth/api-key.guard';
import { validate } from '../../middleware/validate';
import { RevenueService } from '../../repos/revenue.service';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'revenue.controller' });

const querySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD format required').optional(),
  source: z.string().optional(),
});

export function buildRevenueRouter(): Router {
  const r = Router();

  r.get(
    '/metrics/revenue/summary',
    apiKeyGuard,
    validate({ query: querySchema }),
    async (req: Request, res: Response) => {
      const { startDate, endDate, source } = req.query as unknown as z.infer<typeof querySchema>;
      log.info({ startDate, endDate, source }, 'revenue_summary_requested');
      try {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;

        const summary = await RevenueService.computeCollected(start, end, source);
        res.status(200).json({
          totalRevenueCents: summary.totalRevenueCents.toString(),
          currency: summary.currency,
          count: summary.count,
          startDate: startDate || null,
          endDate: endDate || null,
          source: source || null,
        });
      } catch (err: any) {
        log.error({ startDate, endDate, source, err: err.message }, 'revenue_summary_failed');
        res.status(500).json({ error: 'internal_error', message: err.message });
      }
    },
  );

  r.get(
    '/metrics/revenue/daily',
    apiKeyGuard,
    validate({ query: querySchema }),
    async (req: Request, res: Response) => {
      const { startDate, endDate, source } = req.query as unknown as z.infer<typeof querySchema>;
      log.info({ startDate, endDate, source }, 'revenue_daily_requested');
      try {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;

        const breakdown = await RevenueService.computeDailyBreakdown(start, end, source);
        res.status(200).json({
          totalRevenueCents: breakdown.totalRevenueCents.toString(),
          currency: breakdown.currency,
          breakdown: breakdown.breakdown.map((b) => ({
            date: b.date,
            amountCents: b.amountCents.toString(),
            count: b.count,
          })),
          startDate: startDate || null,
          endDate: endDate || null,
          source: source || null,
        });
      } catch (err: any) {
        log.error({ startDate, endDate, source, err: err.message }, 'revenue_daily_failed');
        res.status(500).json({ error: 'internal_error', message: err.message });
      }
    },
  );

  r.get(
    '/metrics/revenue/weekly',
    apiKeyGuard,
    validate({ query: querySchema }),
    async (req: Request, res: Response) => {
      const { startDate, endDate, source } = req.query as unknown as z.infer<typeof querySchema>;
      log.info({ startDate, endDate, source }, 'revenue_weekly_requested');
      try {
        const start = startDate ? new Date(startDate) : undefined;
        const end = endDate ? new Date(endDate) : undefined;

        const breakdown = await RevenueService.computeWeeklyBreakdown(start, end, source);
        res.status(200).json({
          totalRevenueCents: breakdown.totalRevenueCents.toString(),
          currency: breakdown.currency,
          breakdown: breakdown.breakdown.map((b) => ({
            weekStartDate: b.date,
            amountCents: b.amountCents.toString(),
            count: b.count,
          })),
          startDate: startDate || null,
          endDate: endDate || null,
          source: source || null,
        });
      } catch (err: any) {
        log.error({ startDate, endDate, source, err: err.message }, 'revenue_weekly_failed');
        res.status(500).json({ error: 'internal_error', message: err.message });
      }
    },
  );

  return r;
}
