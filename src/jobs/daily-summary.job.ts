import 'dotenv/config';
import { ConfigService } from '../config/config.service';
import { childLogger } from '../logger/logger.service';
import { NotifierService } from '../notifier/notifier.service';
import { getPrisma, disconnectPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { RunReportDraft } from '../types/unified';
import { EntityType, SourceType, SyncMode } from '../types/enums';

const log = childLogger({ component: 'daily-summary.job' });

async function loadRecentReports(): Promise<RunReportDraft[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await withDbRetry(() =>
    getPrisma().runReport.findMany({
      where: { startedAt: { gte: since } },
      orderBy: { startedAt: 'desc' },
    }),
  );
  return rows.map((r) => ({
    runId: r.runId,
    source: r.source as SourceType,
    entity: r.entity as EntityType,
    mode: r.mode as SyncMode,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? undefined,
    cursorBefore: r.cursorBefore,
    cursorAfter: r.cursorAfter,
    staleCursorDetected: r.staleCursorDetected,
    fullBackfillTriggered: r.fullBackfillTriggered,
    fullBackfillReason: r.fullBackfillReason ?? undefined,
    pagesFetched: r.pagesFetched,
    recordsFetched: r.recordsFetched,
    recordsUpserted: r.recordsUpserted,
    recordsDeduped: r.recordsDeduped,
    recordsFailed: r.recordsFailed,
    failedRecords: (r.failedRecords as unknown[]).map((f) => {
      const fObj = f as Record<string, unknown>;
      return {
        externalId: (fObj.externalId as string) ?? null,
        stage: (fObj.stage as 'fetch' | 'normalize' | 'upsert' | 'publish') ?? 'fetch',
        error: (fObj.error as string) ?? '',
        rawPreview: (fObj.rawPreview as string) ?? '',
      };
    }),
    batches: (r.batches as unknown[]).map((b) => {
      const bObj = b as Record<string, unknown>;
      return {
        batchId: (bObj.batchId as string) ?? '',
        size: (bObj.size as number) ?? 0,
        status: (bObj.status as 'success' | 'partial' | 'failed' | 'dlq') ?? 'success',
        error: bObj.error as string | undefined,
      };
    }),
    unmappedStatusesSeen: (r.unmappedStatusesSeen as string[]) ?? [],
  }));
}

async function main(): Promise<void> {
  const cfg = ConfigService.load();
  const reports = await loadRecentReports();
  const notifier = new NotifierService(cfg);
  await notifier.notifyDailySummary(reports);
  log.info({ count: reports.length }, 'daily_summary_sent');
  await disconnectPrisma();
}

if (require.main === module) {
  main().catch((err) => {
    log.error({ err: (err as Error).message }, 'fatal');
    process.exit(1);
  });
}
