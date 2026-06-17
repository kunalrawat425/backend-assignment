import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { EntityType, SourceType } from '../types/enums';

export class CursorService {
  async get(source: SourceType, entity: EntityType): Promise<string | null> {
    const row = await withDbRetry(() =>
      getPrisma().syncCursor.findUnique({
        where: { source_entity: { source, entity } },
      }),
    );
    return row?.cursor ?? null;
  }

  async advance(source: SourceType, entity: EntityType, cursor: string | null): Promise<void> {
    await withDbRetry(() =>
      getPrisma().syncCursor.upsert({
        where: { source_entity: { source, entity } },
        update: { cursor: cursor ?? undefined },
        create: { source, entity, cursor: cursor ?? null },
      }),
    );
  }

  async reset(source: SourceType, entity: EntityType): Promise<void> {
    await withDbRetry(() =>
      getPrisma().syncCursor.upsert({
        where: { source_entity: { source, entity } },
        update: { cursor: null, lastFullAttemptAt: new Date() },
        create: { source, entity, cursor: null, lastFullAttemptAt: new Date() },
      }),
    );
  }

  async markFullSyncCompleted(source: SourceType, entity: EntityType): Promise<void> {
    await withDbRetry(() =>
      getPrisma().syncCursor.upsert({
        where: { source_entity: { source, entity } },
        update: { lastFullSyncAt: new Date() },
        create: { source, entity, lastFullSyncAt: new Date() },
      }),
    );
  }

  /**
   * Returns true if we should allow a full-backfill attempt (rate-limited to env interval).
   */
  async canAttemptFullBackfill(
    source: SourceType,
    entity: EntityType,
    minIntervalMin: number,
  ): Promise<boolean> {
    const row = await withDbRetry(() =>
      getPrisma().syncCursor.findUnique({
        where: { source_entity: { source, entity } },
      }),
    );
    if (!row?.lastFullAttemptAt) return true;
    const elapsedMs = Date.now() - row.lastFullAttemptAt.getTime();
    return elapsedMs >= minIntervalMin * 60 * 1000;
  }

  /**
   * Acquire transaction-scoped advisory lock to prevent cron double-fire.
   * Returns true if lock acquired. Lock auto-released at tx end.
   * Must be called inside getPrisma().$transaction.
   */
  async tryAcquireRunLock(
    tx: Pick<ReturnType<typeof getPrisma>, '$queryRaw'>,
    source: SourceType,
    entity: EntityType,
  ): Promise<boolean> {
    const key = `${source}:${entity}`;
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired
    `;
    return rows[0]?.acquired === true;
  }
}
