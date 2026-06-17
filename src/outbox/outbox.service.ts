import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { EntityType, OutboxStatus, SourceType } from '../types/enums';

export interface OutboxInsert {
  source: SourceType;
  entity: EntityType;
  externalId: string;
  rawPayload: unknown;
  runId: string;
}

export interface OutboxRow {
  id: bigint;
  source: string;
  entity: string;
  externalId: string;
  rawPayload: unknown;
  attempts: number;
  runId: string;
}

export class OutboxService {
  async enqueue(rows: OutboxInsert[]): Promise<{ inserted: number; deduped: number }> {
    if (rows.length === 0) return { inserted: 0, deduped: 0 };
    const result = await withDbRetry(() =>
      getPrisma().ingestOutbox.createMany({
        data: rows.map((r) => ({
          source: r.source,
          entity: r.entity,
          externalId: r.externalId,
          rawPayload: r.rawPayload as object,
          runId: r.runId,
          status: OutboxStatus.PENDING,
        })),
        skipDuplicates: true,
      }),
    );
    return {
      inserted: result.count,
      deduped: rows.length - result.count,
    };
  }

  /**
   * Atomically claim N pending rows using SELECT FOR UPDATE SKIP LOCKED.
   * Caller MUST mark them consumed/failed within the same transaction
   * via markConsumed / markFailed below to avoid leaving them in-flight.
   */
  async claimBatch(limit: number): Promise<OutboxRow[]> {
    const rows = await withDbRetry(() =>
      getPrisma().$queryRaw<OutboxRow[]>`
        SELECT id, source, entity, external_id AS "externalId",
               raw_payload AS "rawPayload", attempts, run_id AS "runId"
        FROM sync_ingest_outbox
        WHERE status = 'pending'
        ORDER BY id ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `,
    );
    return rows;
  }

  async markConsumed(ids: bigint[]): Promise<void> {
    if (ids.length === 0) return;
    await withDbRetry(() =>
      getPrisma().ingestOutbox.updateMany({
        where: { id: { in: ids } },
        data: { status: OutboxStatus.CONSUMED, consumedAt: new Date() },
      }),
    );
  }

  async markFailed(id: bigint, error: string): Promise<void> {
    await withDbRetry(() =>
      getPrisma().ingestOutbox.update({
        where: { id },
        data: {
          attempts: { increment: 1 },
          lastError: error.slice(0, 1000),
        },
      }),
    );
  }

  async markPermanentlyFailed(id: bigint, error: string): Promise<void> {
    await withDbRetry(() =>
      getPrisma().ingestOutbox.update({
        where: { id },
        data: { status: OutboxStatus.FAILED, lastError: error.slice(0, 1000) },
      }),
    );
  }

  async pendingCount(): Promise<number> {
    return withDbRetry(() =>
      getPrisma().ingestOutbox.count({ where: { status: OutboxStatus.PENDING } }),
    );
  }
}
