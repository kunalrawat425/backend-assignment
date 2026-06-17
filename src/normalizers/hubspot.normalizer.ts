import crypto from 'crypto';
import { SourceType } from '../types/enums';
import { UnifiedContact, UnifiedPayment } from '../types/unified';
import { mapStatus } from './status/status.mapper';
import { CurrencyRejectedError } from './stripe.normalizer';

function idempotencyKey(source: SourceType, externalId: string): string {
  return crypto.createHash('sha256').update(`${source}|${externalId}`).digest('hex');
}

interface HsContact {
  id: string;
  properties: Record<string, string | null>;
  updatedAt: string;
}

interface HsDeal {
  id: string;
  properties: Record<string, string | null>;
  updatedAt: string;
}

export class HubSpotContactNormalizer {
  normalize(raw: HsContact): UnifiedContact {
    const p = raw.properties;
    return {
      source: SourceType.HUBSPOT,
      externalId: raw.id,
      idempotencyKey: idempotencyKey(SourceType.HUBSPOT, raw.id),
      firstName: p.firstname ?? '',
      lastName: p.lastname ?? '',
      email: p.email ?? null,
      phone: p.phone ?? null,
      occurredAt: new Date(p.createdate ?? raw.updatedAt),
      raw,
    };
  }
}

export class HubSpotDealNormalizer {
  normalize(raw: HsDeal): UnifiedPayment {
    const p = raw.properties;
    // HubSpot deals always USD for this assignment
    const amountStr = p.amount ?? '0';
    const amountCents = BigInt(Math.round(parseFloat(amountStr) * 100));
    const currency = 'USD';
    const rawStatus = (p.dealstage ?? 'unknown').toLowerCase();
    const status = mapStatus(SourceType.HUBSPOT, rawStatus);

    const occurred = p.closedate
      ? new Date(p.closedate)
      : new Date(p.createdate ?? raw.updatedAt);

    return {
      source: SourceType.HUBSPOT,
      externalId: raw.id,
      idempotencyKey: idempotencyKey(SourceType.HUBSPOT, raw.id),
      amountCents,
      currency,
      status,
      rawStatus,
      occurredAt: occurred,
      raw,
    };
  }
}

// Keep CurrencyRejectedError re-export for processor consistency
export { CurrencyRejectedError };
