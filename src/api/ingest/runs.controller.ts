import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { apiKeyGuard } from '../../auth/api-key.guard';
import { validate } from '../../middleware/validate';
import { getPrisma } from '../../db/db.service';
import { withDbRetry } from '../../db/retry-policy.service';
import { SourceType } from '../../types/enums';

const listQuery = z.object({
  source: z.nativeEnum(SourceType).optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const runIdParams = z.object({
  runId: z.string().uuid(),
});

function serializeRun(row: {
  runId: string;
  source: string;
  entity: string;
  mode: string;
  startedAt: Date;
  finishedAt: Date | null;
  cursorBefore: string | null;
  cursorAfter: string | null;
  staleCursorDetected: boolean;
  fullBackfillTriggered: boolean;
  pagesFetched: number;
  recordsFetched: number;
  recordsUpserted: number;
  recordsDeduped: number;
  recordsFailed: number;
  failedRecords: unknown;
  batches: unknown;
  unmappedStatusesSeen: string[];
  status: string;
}) {
  return {
    runId: row.runId,
    source: row.source,
    entity: row.entity,
    mode: row.mode,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    cursorBefore: row.cursorBefore,
    cursorAfter: row.cursorAfter,
    staleCursorDetected: row.staleCursorDetected,
    fullBackfillTriggered: row.fullBackfillTriggered,
    counts: {
      pagesFetched: row.pagesFetched,
      recordsFetched: row.recordsFetched,
      recordsUpserted: row.recordsUpserted,
      recordsDeduped: row.recordsDeduped,
      recordsFailed: row.recordsFailed,
    },
    failedRecords: row.failedRecords,
    batches: row.batches,
    unmappedStatusesSeen: row.unmappedStatusesSeen,
    status: row.status,
  };
}

export function buildRunsRouter(): Router {
  const r = Router();

  r.get(
    '/runs',
    apiKeyGuard,
    validate({ query: listQuery }),
    async (req: Request, res: Response) => {
      const { source, limit } = req.query as unknown as z.infer<typeof listQuery>;
      const rows = await withDbRetry(() =>
        getPrisma().runReport.findMany({
          where: source ? { source } : {},
          orderBy: { startedAt: 'desc' },
          take: limit,
        }),
      );
      res.json({ runs: rows.map(serializeRun) });
    },
  );

  r.get(
    '/runs/:runId',
    apiKeyGuard,
    validate({ params: runIdParams }),
    async (req: Request, res: Response) => {
      const { runId } = req.params as unknown as z.infer<typeof runIdParams>;
      const row = await withDbRetry(() =>
        getPrisma().runReport.findUnique({ where: { runId } }),
      );
      if (!row) {
        res.status(404).json({ error: 'run_not_found', runId });
        return;
      }
      res.json(serializeRun(row));
    },
  );

  return r;
}
