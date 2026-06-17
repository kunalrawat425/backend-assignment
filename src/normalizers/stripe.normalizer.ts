import crypto from 'crypto';
import Stripe from 'stripe';
import { SourceType } from '../types/enums';
import { UnifiedPayment } from '../types/unified';
import { mapStatus } from './status/status.mapper';

export class CurrencyRejectedError extends Error {
  constructor(public readonly currency: string) {
    super(`unsupported_currency: ${currency}`);
    this.name = 'CurrencyRejectedError';
  }
}

const ALLOWED_CURRENCY = 'USD';

export function idempotencyKey(source: SourceType, externalId: string): string {
  return crypto.createHash('sha256').update(`${source}|${externalId}`).digest('hex');
}

export class StripeNormalizer {
  normalize(raw: Stripe.Charge): UnifiedPayment {
    const currency = (raw.currency ?? '').toUpperCase();
    if (currency !== ALLOWED_CURRENCY) {
      throw new CurrencyRejectedError(currency || 'EMPTY');
    }
    const status = mapStatus(SourceType.STRIPE, raw.status, { objectType: 'charge' });
    return {
      source: SourceType.STRIPE,
      externalId: raw.id,
      idempotencyKey: idempotencyKey(SourceType.STRIPE, raw.id),
      amountCents: BigInt(raw.amount),
      currency,
      status,
      rawStatus: raw.status,
      occurredAt: new Date(raw.created * 1000),
      raw,
    };
  }

  // Refund objects normalize to a SEPARATE row with status=REFUNDED, positive amount.
  normalizeRefund(refund: Stripe.Refund): UnifiedPayment {
    const currency = (refund.currency ?? '').toUpperCase();
    if (currency !== ALLOWED_CURRENCY) {
      throw new CurrencyRejectedError(currency || 'EMPTY');
    }
    const status = mapStatus(SourceType.STRIPE, refund.status ?? 'unknown', {
      objectType: 'refund',
    });
    return {
      source: SourceType.STRIPE,
      externalId: refund.id,
      idempotencyKey: idempotencyKey(SourceType.STRIPE, refund.id),
      amountCents: BigInt(refund.amount),
      currency,
      status,
      rawStatus: refund.status ?? 'unknown',
      occurredAt: new Date(refund.created * 1000),
      raw: refund,
    };
  }
}
