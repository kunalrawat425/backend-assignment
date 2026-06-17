import { mapStatus, assertMapsRegistered } from '../../src/normalizers/status/status.mapper';
import { PaymentStatus, SourceType } from '../../src/types/enums';
import { ConfigService } from '../../src/config/config.service';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  } as NodeJS.ProcessEnv);
});

describe('status mapper — allow-list, NOT exclusion', () => {
  const FIXTURES: Array<[SourceType, string, PaymentStatus, { objectType?: 'charge'|'refund' }?]> = [
    // Stripe charge context
    [SourceType.STRIPE, 'succeeded',                PaymentStatus.COLLECTED],
    [SourceType.STRIPE, 'paid',                     PaymentStatus.COLLECTED],
    [SourceType.STRIPE, 'processing',               PaymentStatus.PENDING],
    [SourceType.STRIPE, 'requires_payment_method',  PaymentStatus.PENDING],
    [SourceType.STRIPE, 'requires_action',          PaymentStatus.PENDING],
    [SourceType.STRIPE, 'canceled',                 PaymentStatus.VOIDED],
    [SourceType.STRIPE, 'failed',                   PaymentStatus.FAILED],

    // Stripe refund context — same word, different meaning
    [SourceType.STRIPE, 'succeeded',                PaymentStatus.REFUNDED, { objectType: 'refund' }],
    [SourceType.STRIPE, 'pending',                  PaymentStatus.PENDING,  { objectType: 'refund' }],
    [SourceType.STRIPE, 'failed',                   PaymentStatus.FAILED,   { objectType: 'refund' }],

    // HubSpot
    [SourceType.HUBSPOT, 'closedwon',               PaymentStatus.COLLECTED],
    [SourceType.HUBSPOT, 'closedlost',              PaymentStatus.FAILED],
    [SourceType.HUBSPOT, 'qualifiedtobuy',          PaymentStatus.PENDING],

    // Unknowns NEVER count as collected — allow-list, not exclusion
    [SourceType.STRIPE, 'totally_made_up_status',   PaymentStatus.UNKNOWN],
    [SourceType.STRIPE, 'partial_capture',          PaymentStatus.UNKNOWN],
    [SourceType.HUBSPOT, 'newstatusfromhubspot',    PaymentStatus.UNKNOWN],
    [SourceType.STRIPE, 'authorised',               PaymentStatus.UNKNOWN], // Adyen spelling — Stripe never says this
  ];

  const mappedFixtures = FIXTURES.map(f => [f[0], f[1], f[2], f[3] || undefined] as [SourceType, string, PaymentStatus, { objectType?: 'charge' | 'refund' } | undefined]);

  it.each(mappedFixtures)('%s "%s" → %s', (src, raw, expected, ctx) => {
    expect(mapStatus(src, raw, ctx)).toBe(expected);
  });


  it('case-preserving lookup — Adyen-style Capitalised would miss Stripe lowercase', () => {
    expect(mapStatus(SourceType.STRIPE, 'Succeeded')).toBe(PaymentStatus.UNKNOWN);
  });

  it('trims whitespace before lookup', () => {
    expect(mapStatus(SourceType.STRIPE, '  succeeded  ')).toBe(PaymentStatus.COLLECTED);
  });

  it('rejects unknown source enum value', () => {
    expect(mapStatus('madeup' as SourceType, 'succeeded')).toBe(PaymentStatus.UNKNOWN);
  });

  it('assertMapsRegistered passes for enabled sources with maps', () => {
    expect(() => assertMapsRegistered([SourceType.STRIPE, SourceType.HUBSPOT])).not.toThrow();
  });

  it('assertMapsRegistered skips GCAL (no payment status)', () => {
    expect(() => assertMapsRegistered([SourceType.GCAL])).not.toThrow();
  });
});
