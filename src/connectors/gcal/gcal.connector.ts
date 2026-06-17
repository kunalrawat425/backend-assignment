import { google } from 'googleapis';
import { BaseConnector, StaleCursorError } from '../base.connector';
import { EntityType, SourceType } from '../../types/enums';
import { FetchPage } from '../../types/unified';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'gcal.connector' });

export interface GCalEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  created?: string;
  updated?: string;
  organizer?: { email?: string };
}

export class GCalConnector extends BaseConnector<GCalEvent> {
  readonly source = SourceType.GCAL;
  readonly entity = EntityType.EVENTS;
  private readonly calendar;
  private readonly calendarId: string;

  constructor(clientEmail: string, privateKey: string, calendarId: string) {
    super();
    this.calendarId = calendarId;
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async *fetchFull(pageSize: number): AsyncGenerator<FetchPage<GCalEvent>, void, unknown> {
    let pageToken: string | undefined;
    while (true) {
      const res = await this.listEvents({ maxResults: pageSize, pageToken });
      const events = (res.data.items ?? []) as GCalEvent[];
      yield { batch: events, nextCursor: res.data.nextPageToken ?? null };
      if (!res.data.nextPageToken) break;
      pageToken = res.data.nextPageToken;
      log.debug({ pageToken }, 'gcal_full_page');
    }
  }

  async *fetchIncremental(
    cursor: string | null,
    pageSize: number,
  ): AsyncGenerator<FetchPage<GCalEvent>, void, unknown> {
    // cursor = nextSyncToken from previous run; null = first run (do full list)
    if (!cursor) {
      yield* this.fetchFull(pageSize);
      return;
    }
    try {
      const res = await this.listEvents({ maxResults: pageSize, syncToken: cursor });
      const events = (res.data.items ?? []) as GCalEvent[];
      // nextSyncToken signals "done", nextPageToken signals more pages
      const nextCursor = res.data.nextSyncToken ?? res.data.nextPageToken ?? null;
      yield { batch: events, nextCursor };
    } catch (err) {
      const e = err as { code?: number; message?: string };
      // 410 = syncToken expired (typically after 7d) → full backfill
      if (e.code === 410) {
        throw new StaleCursorError(this.source, `sync_token_expired: ${e.message ?? ''}`);
      }
      throw err;
    }
  }

  private async listEvents(params: {
    maxResults: number;
    pageToken?: string;
    syncToken?: string;
  }) {
    log.info(
      { maxResults: params.maxResults, pageToken: params.pageToken, syncToken: params.syncToken },
      'gcal_list_events_request',
    );
    try {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        maxResults: params.maxResults,
        singleEvents: true,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
        ...(params.syncToken ? { syncToken: params.syncToken } : {}),
      });
      log.info(
        { count: res.data.items?.length ?? 0, hasNextPage: !!res.data.nextPageToken },
        'gcal_list_events_response',
      );
      return res;
    } catch (err) {
      throw err;
    }
  }
}
