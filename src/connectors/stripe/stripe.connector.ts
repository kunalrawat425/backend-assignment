import Stripe from 'stripe';
import { BaseConnector, StaleCursorError } from '../base.connector';
import { EntityType, SourceType } from '../../types/enums';
import { FetchPage } from '../../types/unified';
import { childLogger } from '../../logger/logger.service';

const log = childLogger({ component: 'stripe.connector' });

export class StripeConnector extends BaseConnector<Stripe.Charge> {
  readonly source = SourceType.STRIPE;
  readonly entity = EntityType.PAYMENTS;
  private readonly client: Stripe;

  constructor(apiKey: string) {
    super();
    this.client = new Stripe(apiKey, { apiVersion: '2024-09-30.acacia' as Stripe.LatestApiVersion });
  }

  async *fetchFull(pageSize: number): AsyncGenerator<FetchPage<Stripe.Charge>, void, unknown> {
    let startingAfter: string | undefined = undefined;
    let pages = 0;
    while (true) {
      const page = await this.listCharges({ limit: pageSize, startingAfter });
      pages++;
      log.debug({ pages, count: page.data.length, hasMore: page.has_more }, 'stripe_full_page');
      const nextCursor = page.has_more && page.data.length > 0
        ? page.data[page.data.length - 1].id
        : null;
      yield { batch: page.data, nextCursor };
      if (!page.has_more || !nextCursor) break;
      startingAfter = nextCursor;
    }
  }

  async *fetchIncremental(
    cursor: string | null,
    pageSize: number,
  ): AsyncGenerator<FetchPage<Stripe.Charge>, void, unknown> {
    // Stripe doesn't reject old IDs as 410. We use `created[gte]` timestamp cursor instead.
    // Cursor format: ISO timestamp of most-recent charge.created we've seen.
    const createdGte = cursor ? Math.floor(new Date(cursor).getTime() / 1000) : undefined;
    if (cursor && (Number.isNaN(createdGte) || createdGte === undefined)) {
      throw new StaleCursorError(this.source, `invalid_cursor_format: ${cursor}`);
    }
    let startingAfter: string | undefined = undefined;
    let maxSeen = createdGte ?? 0;
    while (true) {
      const page = await this.listCharges({
        limit: pageSize,
        startingAfter,
        createdGte,
      });
      for (const ch of page.data) {
        if (ch.created > maxSeen) maxSeen = ch.created;
      }
      const nextCursor = page.has_more && page.data.length > 0
        ? page.data[page.data.length - 1].id
        : null;
      const advanceCursor =
        maxSeen > 0 ? new Date((maxSeen + 1) * 1000).toISOString() : cursor;
      yield { batch: page.data, nextCursor: advanceCursor };
      if (!page.has_more || !nextCursor) break;
      startingAfter = nextCursor;
    }
  }

  private async listCharges(params: {
    limit: number;
    startingAfter?: string;
    createdGte?: number;
  }): Promise<Stripe.ApiList<Stripe.Charge>> {
    log.info(
      { limit: params.limit, startingAfter: params.startingAfter, createdGte: params.createdGte },
      'stripe_charges_list_request',
    );
    try {
      const res = await this.client.charges.list({
        limit: params.limit,
        ...(params.startingAfter ? { starting_after: params.startingAfter } : {}),
        ...(params.createdGte !== undefined ? { created: { gte: params.createdGte } } : {}),
      });
      log.info(
        { count: res.data.length, hasMore: res.has_more },
        'stripe_charges_list_response',
      );
      return res;
    } catch (err) {
      const e = err as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 401 || e.code === 'authentication_error') {
        throw new StaleCursorError(this.source, `auth_failed: ${e.message ?? 'unauthorized'}`);
      }
      throw err;
    }
  }
}
