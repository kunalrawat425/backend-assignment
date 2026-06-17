import Stripe from 'stripe';
import { ConfigService } from '../../src/config/config.service';
import {
  CurrencyRejectedError,
  StripeNormalizer,
  idempotencyKey,
} from '../../src/normalizers/stripe.normalizer';
import { PaymentStatus, SourceType } from '../../src/types/enums';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  } as NodeJS.ProcessEnv);
});

const sampleCharge = (overrides: Partial<Stripe.Charge> = {}): Stripe.Charge =>
  ({
    id: 'ch_test_123',
    amount: 4200,
    currency: 'usd',
    status: 'succeeded',
    created: 1700000000,
    ...overrides,
  }) as Stripe.Charge;

const sampleRefund = (overrides: Partial<Stripe.Refund> = {}): Stripe.Refund =>
  ({
    id: 're_test_123',
    amount: 4200,
    currency: 'usd',
    status: 'succeeded',
    created: 1700000000,
    ...overrides,
  }) as Stripe.Refund;

describe('StripeNormalizer', () => {
  const n = new StripeNormalizer();

  it('1. normalizes charge to UnifiedPayment with status=COLLECTED', () => {
    const u = n.normalize(sampleCharge());
    expect(u.source).toBe(SourceType.STRIPE);
    expect(u.externalId).toBe('ch_test_123');
    expect(u.amountCents).toBe(4200n);
    expect(u.currency).toBe('USD');
    expect(u.status).toBe(PaymentStatus.COLLECTED);
    expect(u.rawStatus).toBe('succeeded');
    expect(u.occurredAt.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('2. handles missing optional fields (description)', () => {
    const charge = sampleCharge();
    delete (charge as any).description;
    const u = n.normalize(charge);
    expect((u.raw as any).description).toBeUndefined();
  });

  it('3. handles null values gracefully (description: null)', () => {
    const u = n.normalize(sampleCharge({ description: null }));
    expect((u.raw as any).description).toBeNull();
  });

  it('4. handles empty string values', () => {
    // Empty currency gets rejected, but verify empty description handles correctly
    const u = n.normalize(sampleCharge({ description: '' }));
    expect((u.raw as any).description).toBe('');
  });

  it('5. ignores unexpected fields at root level', () => {
    const charge = {
      ...sampleCharge(),
      randomField: 'unexpected',
    } as any;
    const u = n.normalize(charge);
    expect(u.externalId).toBe('ch_test_123');
  });

  it('6. ignores extra fields in metadata nested object', () => {
    const u = n.normalize(sampleCharge({ metadata: { extra: 'value' } }));
    expect((u.raw as any).metadata?.extra).toBe('value');
  });

  it('7. handles schema changes (non-numeric amount)', () => {
    const charge = sampleCharge();
    (charge as any).amount = 'forty-two-dollars';
    expect(() => n.normalize(charge)).toThrow();
  });

  it('8. handles invalid date formats / timestamp values', () => {
    const charge = sampleCharge();
    (charge as any).created = 'invalid-timestamp-string';
    const u = n.normalize(charge);
    expect(u.occurredAt.getTime()).toBeNaN();
  });

  it('9. rejects non-USD currency', () => {
    expect(() => n.normalize(sampleCharge({ currency: 'eur' }))).toThrow(CurrencyRejectedError);
  });

  it('10. handles Stripe charge with missing ID (no throw, externalId is undefined)', () => {
    const charge = sampleCharge();
    delete (charge as any).id;
    const u = n.normalize(charge);
    expect(u.externalId).toBeUndefined();
  });

  it('idempotency key is sha256(source|external_id) — stable, no timestamps', () => {
    const k1 = n.normalize(sampleCharge({ amount: 100, created: 1 })).idempotencyKey;
    const k2 = n.normalize(sampleCharge({ amount: 999, created: 999 })).idempotencyKey;
    expect(k1).toBe(k2); // mutations to amount/created MUST NOT change key
    expect(k1).toBe(idempotencyKey(SourceType.STRIPE, 'ch_test_123'));
  });

  it('refund object normalizes to status=REFUNDED with same allow-list', () => {
    const u = n.normalizeRefund(sampleRefund());
    expect(u.externalId).toBe('re_test_123');
    expect(u.status).toBe(PaymentStatus.REFUNDED);
    expect(u.rawStatus).toBe('succeeded');
    expect(u.amountCents).toBe(4200n);
  });

  it('unknown charge status maps to UNKNOWN (never counted as collected)', () => {
    const u = n.normalize(sampleCharge({ status: 'partial_capture' as Stripe.Charge.Status }));
    expect(u.status).toBe(PaymentStatus.UNKNOWN);
  });

  it('charge.status=failed maps to FAILED, never silently collected', () => {
    const u = n.normalize(sampleCharge({ status: 'failed' }));
    expect(u.status).toBe(PaymentStatus.FAILED);
  });

  it('refund.status=failed maps to FAILED, NOT REFUNDED', () => {
    const u = n.normalizeRefund(sampleRefund({ status: 'failed' }));
    expect(u.status).toBe(PaymentStatus.FAILED);
  });
});
