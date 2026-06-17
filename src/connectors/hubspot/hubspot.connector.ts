import axios from 'axios';
import { BaseConnector, StaleCursorError } from '../base.connector';
import { EntityType, SourceType } from '../../types/enums';
import { FetchPage } from '../../types/unified';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'hubspot.connector' });

const BASE = 'https://api.hubapi.com';

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

// Raw record unions both shapes; entity determines which is used
export type HsRaw = HsContact | HsDeal;

export class HubSpotContactConnector extends BaseConnector<HsContact> {
  readonly source = SourceType.HUBSPOT;
  readonly entity = EntityType.CONTACTS;

  constructor(private readonly token: string) {
    super();
  }

  async *fetchFull(pageSize: number): AsyncGenerator<FetchPage<HsContact>, void, unknown> {
    yield* this.paginate('/crm/v3/objects/contacts', pageSize, null);
  }

  async *fetchIncremental(
    cursor: string | null,
    pageSize: number,
  ): AsyncGenerator<FetchPage<HsContact>, void, unknown> {
    yield* this.paginate('/crm/v3/objects/contacts', pageSize, cursor);
  }

  private async *paginate(
    path: string,
    pageSize: number,
    after: string | null,
  ): AsyncGenerator<FetchPage<HsContact>, void, unknown> {
    let cursor = after;
    while (true) {
      const params: Record<string, string | number> = {
        limit: pageSize,
        properties: 'firstname,lastname,email,phone,createdate,lastmodifieddate',
      };
      if (cursor) params.after = cursor;
      const res = await this.get<{ results: HsContact[]; paging?: { next?: { after: string } } }>(
        path,
        params,
      );
      const next = res.paging?.next?.after ?? null;
      yield { batch: res.results, nextCursor: next };
      if (!next) break;
      cursor = next;
      log.debug({ cursor }, 'hubspot_contact_page');
    }
  }

  private async get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    log.info({ path, params }, 'hubspot_contact_api_request');
    try {
      const { data } = await axios.get<T>(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params,
      });
      const count = (data as any)?.results?.length ?? 0;
      log.info({ path, count }, 'hubspot_contact_api_response');
      return data;
    } catch (err) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 401) {
        throw new StaleCursorError(this.source, 'hubspot_auth_failed');
      }
      throw err;
    }
  }
}

export class HubSpotDealConnector extends BaseConnector<HsDeal> {
  readonly source = SourceType.HUBSPOT;
  readonly entity = EntityType.PAYMENTS;

  constructor(private readonly token: string) {
    super();
  }

  async *fetchFull(pageSize: number): AsyncGenerator<FetchPage<HsDeal>, void, unknown> {
    yield* this.paginate(pageSize, null);
  }

  async *fetchIncremental(
    cursor: string | null,
    pageSize: number,
  ): AsyncGenerator<FetchPage<HsDeal>, void, unknown> {
    yield* this.paginate(pageSize, cursor);
  }

  private async *paginate(
    pageSize: number,
    after: string | null,
  ): AsyncGenerator<FetchPage<HsDeal>, void, unknown> {
    let cursor = after;
    while (true) {
      const params: Record<string, string | number> = {
        limit: pageSize,
        properties: 'dealname,amount,dealstage,pipeline,closedate,createdate,hs_lastmodifieddate',
      };
      if (cursor) params.after = cursor;
      const res = await this.get<{ results: HsDeal[]; paging?: { next?: { after: string } } }>(
        '/crm/v3/objects/deals',
        params,
      );
      const next = res.paging?.next?.after ?? null;
      yield { batch: res.results, nextCursor: next };
      if (!next) break;
      cursor = next;
      log.debug({ cursor }, 'hubspot_deal_page');
    }
  }

  private async get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    log.info({ path, params }, 'hubspot_deal_api_request');
    try {
      const { data } = await axios.get<T>(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
        params,
      });
      const count = (data as any)?.results?.length ?? 0;
      log.info({ path, count }, 'hubspot_deal_api_response');
      return data;
    } catch (err) {
      const e = err as { response?: { status?: number } };
      if (e.response?.status === 401) {
        throw new StaleCursorError(this.source, 'hubspot_auth_failed');
      }
      throw err;
    }
  }
}
