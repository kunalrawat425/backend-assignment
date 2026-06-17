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

  it('normalizes charge to UnifiedPayment with status=COLLECTED', () => {
    const u = n.normalize(sampleCharge());
    expect(u.source).toBe(SourceType.STRIPE);
    expect(u.externalId).toBe('ch_test_123');
    expect(u.amountCents).toBe(4200n);
    expect(u.currency).toBe('USD');
    expect(u.status).toBe(PaymentStatus.COLLECTED);
    expect(u.rawStatus).toBe('succeeded');
    expect(u.occurredAt.toISOString()).toBe('2023-11-14T22:13:20.000Z');
  });

  it('idempotency key is sha256(source|external_id) — stable, no timestamps', () => {
    const k1 = n.normalize(sampleCharge({ amount: 100, created: 1 })).idempotencyKey;
    const k2 = n.normalize(sampleCharge({ amount: 999, created: 999 })).idempotencyKey;
    expect(k1).toBe(k2); // mutations to amount/created MUST NOT change key
    expect(k1).toBe(idempotencyKey(SourceType.STRIPE, 'ch_test_123'));
  });

  it('rejects non-USD currency', () => {
    expect(() => n.normalize(sampleCharge({ currency: 'eur' }))).toThrow(CurrencyRejectedError);
  });

  it('rejects empty currency', () => {
    expect(() => n.normalize(sampleCharge({ currency: undefined as unknown as string }))).toThrow(
      CurrencyRejectedError,
    );
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
