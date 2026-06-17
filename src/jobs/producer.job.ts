import 'dotenv/config';
import { ConfigService } from '../config/config.service';
import { childLogger } from '../logger/logger.service';
import { ConnectorFactory } from '../connectors/connector.factory';
import { BaseConnector, StaleCursorError } from '../connectors/base.connector';
import { CursorService } from '../cursor/cursor.service';
import { OutboxService } from '../outbox/outbox.service';
import { RunReportService } from '../reports/run-report.service';
import { SourceType, SyncMode } from '../types/enums';
import { RunReportDraft } from '../types/unified';
import { getPrisma, disconnectPrisma } from '../db/db.service';

const log = childLogger({ component: 'producer.job' });

export class ProducerJob {
  constructor(
    private readonly cursors: CursorService,
    private readonly outbox: OutboxService,
    private readonly reports: RunReportService,
  ) {}

  async runAll(): Promise<RunReportDraft[]> {
    const cfg = ConfigService.get();
    const connectors = ConnectorFactory.build(cfg);
    const drafts: RunReportDraft[] = [];
    for (const { source, connector } of connectors) {
      try {
        const draft = await this.runOne(source, connector);
        drafts.push(draft);
      } catch (err) {
        // ISOLATION: one source failure must NOT kill the others
        log.error(
          { source, err: (err as Error).message },
          'source_run_failed_continuing_others',
        );
      }
    }
    return drafts;
  }

  async runOne(
    source: SourceType,
    connector: BaseConnector<unknown>,
    runId?: string,
  ): Promise<RunReportDraft> {
    const cfg = ConfigService.get();
    const entity = connector.entity;
    const draft = this.reports.start(source, entity, SyncMode.INCREMENTAL, runId);
    const runLog: typeof log = log.child({ runId: draft.runId, source, entity });

    // Cron double-fire protection — advisory lock per (source, entity)
    const lockAcquired = await getPrisma().$transaction(async (tx) => {
      return await this.cursors.tryAcquireRunLock(tx, source, entity);
    });
    if (!lockAcquired) {
      runLog.warn({}, 'run_lock_busy_skipping');
      draft.finishedAt = new Date();
      return draft;
    }

    try {
      const cursorBefore = await this.cursors.get(source, entity);
      draft.cursorBefore = cursorBefore;
      runLog.info({ cursor: cursorBefore }, 'producer_start');
      try {
        await this.executeIncremental(connector, cursorBefore, draft, runLog);
      } catch (err) {
        if (err instanceof StaleCursorError) {
          draft.staleCursorDetected = true;
          draft.fullBackfillReason = err.reason;
          runLog.warn({ reason: err.reason }, 'stale_cursor_detected');
          const allowed = await this.cursors.canAttemptFullBackfill(
            source,
            entity,
            cfg.FULL_BACKFILL_MIN_INTERVAL_MIN,
          );
          if (!allowed) {
            runLog.warn({}, 'full_backfill_rate_limited');
            this.reports.recordFailure(draft, {
              externalId: null,
              stage: 'fetch',
              error: `stale_cursor_but_rate_limited: ${err.reason}`,
              rawPreview: '',
            });
            return draft;
          }
          await this.cursors.reset(source, entity);
          draft.fullBackfillTriggered = true;
          draft.mode = SyncMode.FULL;
          runLog.info({}, 'full_backfill_starting');
          await this.executeFull(connector, draft, runLog);
          await this.cursors.markFullSyncCompleted(source, entity);
        } else {
          throw err;
        }
      }
      const cursorAfter = await this.cursors.get(source, entity);
      draft.cursorAfter = cursorAfter;
    } catch (err) {
      runLog.error({ err: (err as Error).message }, 'producer_failed');
      this.reports.recordFailure(draft, {
        externalId: null,
        stage: 'fetch',
        error: (err as Error).message,
        rawPreview: '',
      });
    } finally {
      draft.finishedAt = new Date();
      await this.reports.persist(draft);
      runLog.info(
        {
          pages: draft.pagesFetched,
          fetched: draft.recordsFetched,
          enqueued: draft.recordsUpserted,
          deduped: draft.recordsDeduped,
          failed: draft.recordsFailed,
          staleCursor: draft.staleCursorDetected,
          fullBackfill: draft.fullBackfillTriggered,
        },
        'producer_done',
      );
    }
    return draft;
  }

  private async executeIncremental(
    connector: BaseConnector<unknown>,
    cursor: string | null,
    draft: RunReportDraft,
    runLog: typeof log,
  ): Promise<void> {
    const pageSize = 50;
    for await (const page of connector.fetchIncremental(cursor, pageSize)) {
      draft.pagesFetched++;
      draft.recordsFetched += page.batch.length;
      const externalIds = this.extractExternalIds(page.batch);
      const enqueueRes = await this.outbox.enqueue(
        page.batch.map((raw, idx) => ({
          source: connector.source,
          entity: connector.entity,
          externalId: externalIds[idx],
          rawPayload: raw,
          runId: draft.runId,
        })),
      );
      draft.recordsUpserted += enqueueRes.inserted;
      draft.recordsDeduped += enqueueRes.deduped;
      this.reports.recordBatch(draft, {
        batchId: `${draft.runId}:p${draft.pagesFetched}`,
        size: page.batch.length,
        status: 'success',
      });
      // Advance cursor after successful publish-to-outbox
      if (page.nextCursor !== null) {
        await this.cursors.advance(connector.source, connector.entity, page.nextCursor);
      }
      runLog.debug({ page: draft.pagesFetched, size: page.batch.length }, 'page_enqueued');
    }
  }

  private async executeFull(
    connector: BaseConnector<unknown>,
    draft: RunReportDraft,
    runLog: typeof log,
  ): Promise<void> {
    const pageSize = 50;
    for await (const page of connector.fetchFull(pageSize)) {
      draft.pagesFetched++;
      draft.recordsFetched += page.batch.length;
      const externalIds = this.extractExternalIds(page.batch);
      const enqueueRes = await this.outbox.enqueue(
        page.batch.map((raw, idx) => ({
          source: connector.source,
          entity: connector.entity,
          externalId: externalIds[idx],
          rawPayload: raw,
          runId: draft.runId,
        })),
      );
      draft.recordsUpserted += enqueueRes.inserted;
      draft.recordsDeduped += enqueueRes.deduped;
      this.reports.recordBatch(draft, {
        batchId: `${draft.runId}:p${draft.pagesFetched}`,
        size: page.batch.length,
        status: 'success',
      });
      if (page.nextCursor !== null) {
        await this.cursors.advance(connector.source, connector.entity, page.nextCursor);
      }
      runLog.debug({ page: draft.pagesFetched, size: page.batch.length }, 'page_enqueued');
    }
  }

  private extractExternalIds(batch: unknown[]): string[] {
    return batch.map((item) => {
      const obj = item as { id?: string };
      if (!obj || typeof obj.id !== 'string') {
        throw new Error(`record_missing_id: ${JSON.stringify(item).slice(0, 200)}`);
      }
      return obj.id;
    });
  }
}

// CLI entry — `pnpm job:fetch`
async function main(): Promise<void> {
  ConfigService.load();
  const job = new ProducerJob(new CursorService(), new OutboxService(), new RunReportService());
  await job.runAll();
  await disconnectPrisma();
}

if (require.main === module) {
  main().catch((err) => {
    log.error({ err: err.message, stack: err.stack }, 'fatal');
    process.exit(1);
  });
}
