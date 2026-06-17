import { PaymentStatus, SourceType } from '../../types/enums';
import { getLogger } from '../../logger/logger.service';
import { STRIPE_MAP } from './maps/stripe.map';
import { STRIPE_REFUND_MAP } from './maps/stripe.refund.map';
import { HUBSPOT_MAP } from './maps/hubspot.map';

export interface StatusMapContext {
  objectType?: 'charge' | 'refund' | 'invoice' | 'deal';
}

// Per-source maps. Case-preserving lookup — Adyen/Xero are case-sensitive.
// GCal omitted: events don't have payment status.
const MAPS: Partial<Record<SourceType, Record<string, PaymentStatus>>> = {
  [SourceType.STRIPE]: STRIPE_MAP,
  [SourceType.HUBSPOT]: HUBSPOT_MAP,
};

export function mapStatus(
  source: SourceType,
  rawStatus: string,
  context?: StatusMapContext,
): PaymentStatus {
  const key = rawStatus.trim();
  if (source === SourceType.STRIPE && context?.objectType === 'refund') {
    const mapped = STRIPE_REFUND_MAP[key];
    if (mapped === undefined) {
      getLogger().warn({ source, rawStatus: key, context }, 'unmapped_status');
      return PaymentStatus.UNKNOWN;
    }
    return mapped;
  }
  const map = MAPS[source];
  if (!map) {
    getLogger().error({ source }, 'no_status_map_for_source');
    return PaymentStatus.UNKNOWN;
  }
  const mapped = map[key];
  if (mapped === undefined) {
    getLogger().warn({ source, rawStatus: key }, 'unmapped_status');
    return PaymentStatus.UNKNOWN;
  }
  return mapped;
}

// CI assertion helper: every enabled source must have a map registered.
export function assertMapsRegistered(sources: SourceType[]): void {
  for (const s of sources) {
    if (s === SourceType.GCAL) continue; // events have no payment status
    if (!MAPS[s]) {
      throw new Error(`No status map registered for source: ${s}`);
    }
  }
}
