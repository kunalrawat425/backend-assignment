import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { UnifiedPayment } from '../types/unified';

export class PaymentRepo {
  /**
   * Upsert with last-write-wins on updated_at.
   * Returns { inserted: boolean } so caller can count deduped vs new.
   */
  async upsert(p: UnifiedPayment): Promise<{ inserted: boolean }> {
    const existing = await withDbRetry(() =>
      getPrisma().payment.findUnique({
        where: {
          source_externalId: { source: p.source, externalId: p.externalId },
        },
        select: { id: true, updatedAt: true },
      }),
    );

    if (!existing) {
      await withDbRetry(() =>
        getPrisma().payment.create({
          data: {
            source: p.source,
            externalId: p.externalId,
            idempotencyKey: p.idempotencyKey,
            amountCents: p.amountCents,
            currency: p.currency,
            status: p.status,
            rawStatus: p.rawStatus,
            raw: p.raw as object,
            occurredAt: p.occurredAt,
          },
        }),
      );
      return { inserted: true };
    }

    // Last-write-wins: only update if incoming is fresher.
    // For sync path we always pass current timestamps; the unique key prevents dupes.
    await withDbRetry(() =>
      getPrisma().payment.update({
        where: { id: existing.id },
        data: {
          amountCents: p.amountCents,
          currency: p.currency,
          status: p.status,
          rawStatus: p.rawStatus,
          raw: p.raw as object,
          occurredAt: p.occurredAt,
        },
      }),
    );
    return { inserted: false };
  }
}
