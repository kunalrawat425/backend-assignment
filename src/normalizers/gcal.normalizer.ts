import crypto from 'crypto';
import { SourceType } from '../types/enums';
import { UnifiedEvent } from '../types/unified';
import { GCalEvent } from '../connectors/gcal/gcal.connector';

function idempotencyKey(source: SourceType, externalId: string): string {
  return crypto.createHash('sha256').update(`${source}|${externalId}`).digest('hex');
}

export class GCalNormalizer {
  normalize(raw: GCalEvent): UnifiedEvent {
    const startAt = raw.start?.dateTime
      ? new Date(raw.start.dateTime)
      : raw.start?.date
        ? new Date(raw.start.date)
        : new Date(raw.created ?? Date.now());

    const endAt = raw.end?.dateTime
      ? new Date(raw.end.dateTime)
      : raw.end?.date
        ? new Date(raw.end.date)
        : null;

    return {
      source: SourceType.GCAL,
      externalId: raw.id,
      idempotencyKey: idempotencyKey(SourceType.GCAL, raw.id),
      title: raw.summary ?? '(no title)',
      description: raw.description ?? null,
      startAt,
      endAt,
      status: raw.status ?? 'confirmed',
      occurredAt: new Date(raw.created ?? startAt),
      raw,
    };
  }
}
