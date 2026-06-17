import { EntityType, PaymentStatus, SourceType, SyncMode } from './enums';

export interface UnifiedPayment {
  source: SourceType;
  externalId: string;
  idempotencyKey: string;
  amountCents: bigint;
  currency: string;
  status: PaymentStatus;
  rawStatus: string;
  occurredAt: Date;
  raw: unknown;
}

export interface UnifiedContact {
  source: SourceType;
  externalId: string;
  idempotencyKey: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  occurredAt: Date;
  raw: unknown;
}

export interface UnifiedEvent {
  source: SourceType;
  externalId: string;
  idempotencyKey: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  status: string;
  occurredAt: Date;
  raw: unknown;
}

export interface FetchPage<T> {
  batch: T[];
  nextCursor: string | null;
}

export interface FailedRecord {
  externalId: string | null;
  stage: 'fetch' | 'normalize' | 'upsert' | 'publish';
  error: string;
  rawPreview: string;
}

export interface BatchOutcome {
  batchId: string;
  size: number;
  status: 'success' | 'partial' | 'failed' | 'dlq';
  error?: string;
}

export interface RunReportDraft {
  runId: string;
  source: SourceType;
  entity: EntityType;
  mode: SyncMode;
  startedAt: Date;
  finishedAt?: Date;
  cursorBefore: string | null;
  cursorAfter: string | null;
  staleCursorDetected: boolean;
  fullBackfillTriggered: boolean;
  fullBackfillReason?: string;
  pagesFetched: number;
  recordsFetched: number;
  recordsUpserted: number;
  recordsDeduped: number;
  recordsFailed: number;
  failedRecords: FailedRecord[];
  batches: BatchOutcome[];
  unmappedStatusesSeen: string[];
}
