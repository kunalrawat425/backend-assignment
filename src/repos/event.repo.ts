import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { UnifiedEvent } from '../types/unified';

export class EventRepo {
  async upsert(e: UnifiedEvent): Promise<{ inserted: boolean }> {
    const existing = await withDbRetry(() =>
      getPrisma().event.findUnique({
        where: {
          source_externalId: { source: e.source, externalId: e.externalId },
        },
        select: { id: true },
      }),
    );

    if (!existing) {
      await withDbRetry(() =>
        getPrisma().event.create({
          data: {
            source: e.source,
            externalId: e.externalId,
            idempotencyKey: e.idempotencyKey,
            title: e.title,
            description: e.description,
            startAt: e.startAt,
            endAt: e.endAt,
            status: e.status,
            raw: e.raw as object,
            occurredAt: e.occurredAt,
          },
        }),
      );
      return { inserted: true };
    }

    await withDbRetry(() =>
      getPrisma().event.update({
        where: { id: existing.id },
        data: {
          title: e.title,
          description: e.description,
          startAt: e.startAt,
          endAt: e.endAt,
          status: e.status,
          raw: e.raw as object,
          occurredAt: e.occurredAt,
        },
      }),
    );
    return { inserted: false };
  }
}
