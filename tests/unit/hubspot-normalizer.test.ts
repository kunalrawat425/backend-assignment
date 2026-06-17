import { ConfigService } from '../../src/config/config.service';
import { HubSpotContactNormalizer, HubSpotDealNormalizer } from '../../src/normalizers/hubspot.normalizer';
import { PaymentStatus, SourceType } from '../../src/types/enums';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  } as NodeJS.ProcessEnv);
});

describe('HubSpotContactNormalizer', () => {
  const normalizer = new HubSpotContactNormalizer();

  const baseContact = () => ({
    id: 'hs_c_123',
    properties: {
      firstname: 'John',
      lastname: 'Doe',
      email: 'john.doe@example.com',
      phone: '+15555555555',
      createdate: '2026-06-17T10:00:00.000Z',
    } as Record<string, string | null>,
    updatedAt: '2026-06-17T10:30:00.000Z',
  });

  it('1. normalizes a valid contact payload', () => {
    const res = normalizer.normalize(baseContact());
    expect(res.source).toBe(SourceType.HUBSPOT);
    expect(res.externalId).toBe('hs_c_123');
    expect(res.firstName).toBe('John');
    expect(res.lastName).toBe('Doe');
    expect(res.email).toBe('john.doe@example.com');
    expect(res.phone).toBe('+15555555555');
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T10:00:00.000Z');
  });

  it('2. handles missing optional fields (firstname, lastname, email, phone)', () => {
    const contact = {
      id: 'hs_c_124',
      properties: {
        createdate: '2026-06-17T10:00:00.000Z',
      } as Record<string, string | null>,
      updatedAt: '2026-06-17T10:30:00.000Z',
    } as any;
    const res = normalizer.normalize(contact);
    expect(res.firstName).toBe('');
    expect(res.lastName).toBe('');
    expect(res.email).toBeNull();
    expect(res.phone).toBeNull();
  });

  it('3. handles null properties gracefully', () => {
    const contact = baseContact();
    contact.properties.firstname = null;
    contact.properties.lastname = null;
    contact.properties.email = null;
    contact.properties.phone = null;

    const res = normalizer.normalize(contact);
    expect(res.firstName).toBe('');
    expect(res.lastName).toBe('');
    expect(res.email).toBeNull();
    expect(res.phone).toBeNull();
  });

  it('4. handles empty string values', () => {
    const contact = baseContact();
    contact.properties.firstname = '';
    contact.properties.lastname = '';
    contact.properties.email = '';
    contact.properties.phone = '';

    const res = normalizer.normalize(contact);
    expect(res.firstName).toBe('');
    expect(res.lastName).toBe('');
    expect(res.email).toBe('');
    expect(res.phone).toBe('');
  });

  it('5. ignores unexpected fields at root level', () => {
    const contact = {
      ...baseContact(),
      someRandomField: 'unexpected',
    } as any;
    const res = normalizer.normalize(contact);
    expect(res.externalId).toBe('hs_c_123');
  });

  it('6. ignores extra fields in properties object', () => {
    const contact = baseContact();
    (contact.properties as any).extraField = 'extraValue';
    const res = normalizer.normalize(contact);
    expect(res.externalId).toBe('hs_c_123');
  });

  it('7. handles schema change where properties are completely missing', () => {
    const contact = {
      id: 'hs_c_empty',
      updatedAt: '2026-06-17T10:30:00.000Z',
    } as any;
    expect(() => normalizer.normalize(contact)).toThrow();
  });

  it('8. falls back to updatedAt if createdate is null or missing', () => {
    const contact = baseContact();
    contact.properties.createdate = null;
    const res = normalizer.normalize(contact);
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T10:30:00.000Z');
  });

  it('8b. returns Invalid Date if createdate is invalid string format', () => {
    const contact = baseContact();
    contact.properties.createdate = 'invalid-date-string';
    const res = normalizer.normalize(contact);
    expect(res.occurredAt.getTime()).toBeNaN();
  });

  it('9. processes invalid email format as-is (non-strict normalizer)', () => {
    const contact = baseContact();
    contact.properties.email = 'not-an-email';
    const res = normalizer.normalize(contact);
    expect(res.email).toBe('not-an-email');
  });

  it('10. handles contact with missing ID (no throw, externalId is undefined)', () => {
    const contact = {
      properties: { firstname: 'NoID' } as Record<string, string | null>,
      updatedAt: '2026-06-17T10:00:00.000Z',
    } as any;
    const res = normalizer.normalize(contact);
    expect(res.externalId).toBeUndefined();
  });
});

describe('HubSpotDealNormalizer', () => {
  const normalizer = new HubSpotDealNormalizer();

  const baseDeal = () => ({
    id: 'hs_d_999',
    properties: {
      amount: '500.50',
      dealstage: 'closedwon',
      createdate: '2026-06-17T08:00:00.000Z',
      closedate: '2026-06-17T09:00:00.000Z',
    } as Record<string, string | null>,
    updatedAt: '2026-06-17T09:30:00.000Z',
  });

  it('1. normalizes a valid deal payload', () => {
    const res = normalizer.normalize(baseDeal());
    expect(res.source).toBe(SourceType.HUBSPOT);
    expect(res.externalId).toBe('hs_d_999');
    expect(res.amountCents).toBe(50050n);
    expect(res.currency).toBe('USD');
    expect(res.status).toBe(PaymentStatus.COLLECTED);
    expect(res.rawStatus).toBe('closedwon');
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T09:00:00.000Z');
  });

  it('2. handles missing optional fields (amount, dealstage, closedate)', () => {
    const deal = {
      id: 'hs_d_998',
      properties: {
        createdate: '2026-06-17T08:00:00.000Z',
      } as Record<string, string | null>,
      updatedAt: '2026-06-17T09:30:00.000Z',
    } as any;
    const res = normalizer.normalize(deal);
    expect(res.amountCents).toBe(0n);
    expect(res.status).toBe(PaymentStatus.UNKNOWN);
    expect(res.rawStatus).toBe('unknown');
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T08:00:00.000Z');
  });

  it('3. handles null properties gracefully', () => {
    const deal = baseDeal();
    deal.properties.amount = null;
    deal.properties.dealstage = null;
    deal.properties.closedate = null;

    const res = normalizer.normalize(deal);
    expect(res.amountCents).toBe(0n);
    expect(res.status).toBe(PaymentStatus.UNKNOWN);
    expect(res.rawStatus).toBe('unknown');
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T08:00:00.000Z');
  });

  it('4. handles empty amount or dealstage string (throws or defaults)', () => {
    const deal = baseDeal();
    deal.properties.amount = '';
    expect(() => normalizer.normalize(deal)).toThrow();
  });

  it('5. ignores unexpected fields at root level', () => {
    const deal = {
      ...baseDeal(),
      extraRootField: 'value',
    } as any;
    const res = normalizer.normalize(deal);
    expect(res.externalId).toBe('hs_d_999');
  });

  it('6. ignores extra fields inside properties', () => {
    const deal = baseDeal();
    (deal.properties as any).extraProperty = 'value';
    const res = normalizer.normalize(deal);
    expect(res.externalId).toBe('hs_d_999');
  });

  it('7. handles schema change (properties object is missing)', () => {
    const deal = {
      id: 'hs_d_err',
      updatedAt: '2026-06-17T09:30:00.000Z',
    } as any;
    expect(() => normalizer.normalize(deal)).toThrow();
  });

  it('8. falls back to createdate or updatedAt if closedate is null or missing', () => {
    const deal = baseDeal();
    deal.properties.closedate = null;
    const res = normalizer.normalize(deal);
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T08:00:00.000Z');
  });

  it('8b. returns Invalid Date if date strings are invalid format', () => {
    const deal = baseDeal();
    deal.properties.closedate = 'invalid-date';
    deal.properties.createdate = 'invalid-date';
    const res = normalizer.normalize(deal);
    expect(res.occurredAt.getTime()).toBeNaN();
  });

  it('10. handles deal with missing ID (no throw, externalId is undefined)', () => {
    const deal = {
      properties: { amount: '10' } as Record<string, string | null>,
      updatedAt: '2026-06-17T09:30:00.000Z',
    } as any;
    const res = normalizer.normalize(deal);
    expect(res.externalId).toBeUndefined();
  });
});
