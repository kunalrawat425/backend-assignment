import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { apiKeyGuard } from '../../auth/api-key.guard';
import { validate } from '../../middleware/validate';
import { RevenueService } from '../../revenue/revenue.service';
import { PaymentRepo, Granularity } from '../../repos/payment.repo';

const SOURCES = ['stripe', 'hubspot', 'gcal'] as const;

const summaryQuery = z.object({
  from: z.string().datetime({ offset: true, message: 'from must be ISO 8601 with timezone' }),
  to: z.string().datetime({ offset: true, message: 'to must be ISO 8601 with timezone' }),
  source: z.enum(SOURCES).optional(),
});

const breakdownQuery = summaryQuery.extend({
  granularity: z.enum(['day', 'week', 'month'] as [Granularity, ...Granularity[]]),
});

// Module-level singleton — stateless repos, safe to share
const service = new RevenueService(new PaymentRepo());

export function buildRevenueRouter(): Router {
  const router = Router();

  // All routes in this router require API key
  router.use(apiKeyGuard);

  // GET /metrics/revenue — summary
  router.get(
    '/metrics/revenue',
    validate({ query: summaryQuery }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // validate() middleware mutates req.query to the parsed output — cast is safe
        const q = req.query as unknown as z.infer<typeof summaryQuery>;
        const result = await service.summary({
          from: new Date(q.from),
          to: new Date(q.to),
          source: q.source,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // GET /metrics/revenue/breakdown — bucketed
  router.get(
    '/metrics/revenue/breakdown',
    validate({ query: breakdownQuery }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const q = req.query as unknown as z.infer<typeof breakdownQuery>;
        const result = await service.breakdown({
          from: new Date(q.from),
          to: new Date(q.to),
          source: q.source,
          granularity: q.granularity as Granularity,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
