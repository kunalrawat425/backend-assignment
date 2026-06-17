import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { UnifiedContact } from '../types/unified';

export class ContactRepo {
  async upsert(c: UnifiedContact): Promise<{ inserted: boolean }> {
    const existing = await withDbRetry(() =>
      getPrisma().contact.findUnique({
        where: {
          source_externalId: { source: c.source, externalId: c.externalId },
        },
        select: { id: true },
      }),
    );

    if (!existing) {
      await withDbRetry(() =>
        getPrisma().contact.create({
          data: {
            source: c.source,
            externalId: c.externalId,
            idempotencyKey: c.idempotencyKey,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            raw: c.raw as object,
            occurredAt: c.occurredAt,
          },
        }),
      );
      return { inserted: true };
    }

    await withDbRetry(() =>
      getPrisma().contact.update({
        where: { id: existing.id },
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          raw: c.raw as object,
          occurredAt: c.occurredAt,
        },
      }),
    );
    return { inserted: false };
  }
}
