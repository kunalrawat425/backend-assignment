import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { adminKeyGuard } from '../../auth/api-key.guard';
import { idempotency } from '../../middleware/idempotency';
import { validate } from '../../middleware/validate';
import { ProducerJob } from '../../jobs/producer.job';
import { CursorService } from '../../cursor/cursor.service';
import { OutboxService } from '../../outbox/outbox.service';
import { RunReportService } from '../../reports/run-report.service';
import { ConnectorFactory } from '../../connectors/connector.factory';
import { ConfigService } from '../../config/config.service';
import { SourceType, SyncMode } from '../../types/enums';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'trigger.controller' });

const triggerParams = z.object({
  source: z.nativeEnum(SourceType),
  mode: z.enum(['full', 'incremental']),
});

export function buildTriggerRouter(): Router {
  const r = Router();
  r.post(
    '/trigger/:source/:mode',
    adminKeyGuard,
    idempotency,
    validate({ params: triggerParams }),
    async (req: Request, res: Response) => {
      const { source, mode } = req.params as unknown as z.infer<typeof triggerParams>;
      const cfg = ConfigService.get();
      const connectors = ConnectorFactory.build(cfg);
      const matches = connectors.filter((c) => c.source === source);
      if (matches.length === 0) {
        res.status(400).json({
          error: 'source_not_enabled',
          source,
          enabled: connectors.map((c) => c.source),
        });
        return;
      }
      const primaryRunId = uuidv4();
      res.status(202).json({ runId: primaryRunId, source, mode, status: 'accepted' });
      
      matches.forEach((match, idx) => {
        const runId = idx === 0 ? primaryRunId : uuidv4();
        void runAsync(source, mode, match.connector, runId).catch((err) => {
          log.error({ runId, source, mode, entity: match.connector.entity, err: err.message }, 'async_trigger_failed');
        });
      });
    },
  );
  return r;
}

async function runAsync(
  source: SourceType,
  mode: 'full' | 'incremental',
  connector: Awaited<ReturnType<typeof ConnectorFactory.build>>[number]['connector'],
  runId: string,
): Promise<void> {
  const cursors = new CursorService();
  const outbox = new OutboxService();
  const reports = new RunReportService();
  const job = new ProducerJob(cursors, outbox, reports);
  if (mode === 'full') {
    await cursors.reset(source, connector.entity);
  }
  await job.runOne(source, connector, runId);
  void mode; // mode captured via cursor reset above
  void SyncMode; // pacify linter
}
