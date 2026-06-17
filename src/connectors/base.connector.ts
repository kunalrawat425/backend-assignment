import { EntityType, SourceType } from '../types/enums';
import { FetchPage } from '../types/unified';

export class StaleCursorError extends Error {
  constructor(
    public readonly source: SourceType,
    public readonly reason: string,
  ) {
    super(`${source} cursor stale: ${reason}`);
    this.name = 'StaleCursorError';
  }
}

export abstract class BaseConnector<TRaw> {
  abstract readonly source: SourceType;
  abstract readonly entity: EntityType;

  /**
   * Fetch all records from beginning. Yields page-by-page.
   * Must throw StaleCursorError if source indicates cursor expired.
   */
  abstract fetchFull(pageSize: number): AsyncGenerator<FetchPage<TRaw>, void, unknown>;

  /**
   * Fetch incremental records since cursor. Yields page-by-page.
   * Throws StaleCursorError on 410 / expired-token / invalid-cursor.
   */
  abstract fetchIncremental(
    cursor: string | null,
    pageSize: number,
  ): AsyncGenerator<FetchPage<TRaw>, void, unknown>;
}
