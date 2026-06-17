import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { apiKeyGuard } from '../../auth/api-key.guard';
import { validate } from '../../middleware/validate';
import { PaymentRepo } from '../../repos/payment.repo';

const unmappedQuery = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const repo = new PaymentRepo();

export function buildUnmappedRouter(): Router {
  const router = Router();

  router.get(
    '/metrics/unmapped-statuses',
    apiKeyGuard,
    validate({ query: unmappedQuery }),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // validate() mutates req.query with parsed output; z.coerce ensures limit is number
        const q = req.query as unknown as z.infer<typeof unmappedQuery>;
        const rows = await repo.getUnmappedStatuses(q.limit);
        res.json({ count: rows.length, statuses: rows });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
