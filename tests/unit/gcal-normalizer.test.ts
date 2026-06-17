import { ConfigService } from '../../src/config/config.service';
import { GCalNormalizer } from '../../src/normalizers/gcal.normalizer';
import { SourceType } from '../../src/types/enums';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  } as NodeJS.ProcessEnv);
});

describe('GCalNormalizer', () => {
  const normalizer = new GCalNormalizer();

  const baseEvent = () => ({
    id: 'gcal_ev_123',
    summary: 'Project Sync',
    description: 'Weekly team status update',
    start: {
      dateTime: '2026-06-17T14:00:00.000Z',
    },
    end: {
      dateTime: '2026-06-17T15:00:00.000Z',
    },
    status: 'confirmed',
    created: '2026-06-17T10:00:00.000Z',
    updated: '2026-06-17T10:05:00.000Z',
  });

  it('1. normalizes a valid GCal event payload', () => {
    const res = normalizer.normalize(baseEvent());
    expect(res.source).toBe(SourceType.GCAL);
    expect(res.externalId).toBe('gcal_ev_123');
    expect(res.title).toBe('Project Sync');
    expect(res.description).toBe('Weekly team status update');
    expect(res.startAt.toISOString()).toBe('2026-06-17T14:00:00.000Z');
    expect(res.endAt?.toISOString()).toBe('2026-06-17T15:00:00.000Z');
    expect(res.status).toBe('confirmed');
    expect(res.occurredAt.toISOString()).toBe('2026-06-17T10:00:00.000Z');
  });

  it('2. handles missing optional fields (summary, description, end, status, created)', () => {
    const event = {
      id: 'gcal_ev_124',
      start: {
        dateTime: '2026-06-17T14:00:00.000Z',
      },
    } as any;
    const res = normalizer.normalize(event);
    expect(res.title).toBe('(no title)');
    expect(res.description).toBeNull();
    expect(res.endAt).toBeNull();
    expect(res.status).toBe('confirmed'); // default fallback
  });

  it('3. handles null values gracefully', () => {
    const event = {
      id: 'gcal_ev_125',
      summary: null,
      description: null,
      start: {
        dateTime: '2026-06-17T14:00:00.000Z',
      },
      end: null,
      status: null,
    } as any;
    const res = normalizer.normalize(event);
    expect(res.title).toBe('(no title)');
    expect(res.description).toBeNull();
    expect(res.endAt).toBeNull();
    expect(res.status).toBe('confirmed');
  });

  it('4. handles empty string values', () => {
    const event = {
      id: 'gcal_ev_126',
      summary: '',
      description: '',
      start: {
        dateTime: '2026-06-17T14:00:00.000Z',
      },
      end: {
        dateTime: '',
      },
      status: '',
    } as any;
    const res = normalizer.normalize(event);
    expect(res.title).toBe(''); // empty string is preserved by nullish coalescing
    expect(res.description).toBe('');
    expect(res.status).toBe('');
  });

  it('5. ignores unexpected fields at root level', () => {
    const event = {
      ...baseEvent(),
      anotherUnexpectedProp: 'xyz',
    } as any;
    const res = normalizer.normalize(event);
    expect(res.externalId).toBe('gcal_ev_123');
  });

  it('6. ignores extra nested properties in start/end', () => {
    const event = baseEvent();
    (event.start as any).timeZone = 'America/New_York';
    (event.start as any).extraField = 'extra';
    const res = normalizer.normalize(event);
    expect(res.externalId).toBe('gcal_ev_123');
  });

  it('7. handles schema change (start is completely missing)', () => {
    const event = {
      id: 'gcal_ev_err',
      summary: 'No Start Event',
      created: '2026-06-17T10:00:00.000Z',
    } as any;
    const res = normalizer.normalize(event);
    expect(res.startAt.toISOString()).toBe('2026-06-17T10:00:00.000Z');
  });

  it('8. falls back cleanly if dates are invalid strings', () => {
    const event = baseEvent();
    event.start.dateTime = 'invalid-date';
    event.created = 'invalid-date';
    const res = normalizer.normalize(event);
    expect(res.startAt.getTime()).toBeNaN();
    expect(res.occurredAt.getTime()).toBeNaN();
  });

  it('9. handles start.date (all-day event) normalization', () => {
    const event = {
      id: 'gcal_ev_allday',
      summary: 'All Day Event',
      start: {
        date: '2026-06-17',
      },
      end: {
        date: '2026-06-18',
      },
    } as any;
    const res = normalizer.normalize(event);
    expect(res.startAt.toISOString()).toBe('2026-06-17T00:00:00.000Z');
    expect(res.endAt?.toISOString()).toBe('2026-06-18T00:00:00.000Z');
  });

  it('10. handles GCal event with missing ID (no throw, externalId is undefined)', () => {
    const event = {
      summary: 'Broken Event',
    } as any;
    const res = normalizer.normalize(event);
    expect(res.externalId).toBeUndefined();
  });
});
