import { v4 as uuidv4 } from 'uuid';
import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { EntityType, RunStatus, SourceType, SyncMode } from '../types/enums';
import { BatchOutcome, FailedRecord, RunReportDraft } from '../types/unified';

export class RunReportService {
  start(source: SourceType, entity: EntityType, mode: SyncMode): RunReportDraft {
    return {
      runId: uuidv4(),
      source,
      entity,
      mode,
      startedAt: new Date(),
      cursorBefore: null,
      cursorAfter: null,
      staleCursorDetected: false,
      fullBackfillTriggered: false,
      pagesFetched: 0,
      recordsFetched: 0,
      recordsUpserted: 0,
      recordsDeduped: 0,
      recordsFailed: 0,
      failedRecords: [],
      batches: [],
      unmappedStatusesSeen: [],
    };
  }

  recordFailure(draft: RunReportDraft, failure: FailedRecord): void {
    draft.recordsFailed++;
    if (draft.failedRecords.length < 50) {
      draft.failedRecords.push(failure);
    }
  }

  recordBatch(draft: RunReportDraft, batch: BatchOutcome): void {
    draft.batches.push(batch);
  }

  async persist(draft: RunReportDraft): Promise<void> {
    const status = this.resolveStatus(draft);
    draft.finishedAt = draft.finishedAt ?? new Date();
    await withDbRetry(() =>
      getPrisma().runReport.create({
        data: {
          runId: draft.runId,
          source: draft.source,
          entity: draft.entity,
          mode: draft.mode,
          startedAt: draft.startedAt,
          finishedAt: draft.finishedAt,
          cursorBefore: draft.cursorBefore,
          cursorAfter: draft.cursorAfter,
          staleCursorDetected: draft.staleCursorDetected,
          fullBackfillTriggered: draft.fullBackfillTriggered,
          fullBackfillReason: draft.fullBackfillReason,
          pagesFetched: draft.pagesFetched,
          recordsFetched: draft.recordsFetched,
          recordsUpserted: draft.recordsUpserted,
          recordsDeduped: draft.recordsDeduped,
          recordsFailed: draft.recordsFailed,
          failedRecords: draft.failedRecords as object,
          batches: draft.batches as object,
          unmappedStatusesSeen: draft.unmappedStatusesSeen,
          status,
        },
      }),
    );
  }

  private resolveStatus(draft: RunReportDraft): RunStatus {
    if (draft.recordsFailed === 0) return RunStatus.SUCCESS;
    if (draft.recordsUpserted > 0) return RunStatus.PARTIAL;
    return RunStatus.FAILED;
  }
}
