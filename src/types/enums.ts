export enum SourceType {
  STRIPE = 'stripe',
  HUBSPOT = 'hubspot',
  GCAL = 'gcal',
}

export enum EntityType {
  PAYMENTS = 'payments',
  CONTACTS = 'contacts',
  EVENTS = 'events',
}

export enum SyncMode {
  INCREMENTAL = 'incremental',
  FULL = 'full',
}

export enum PaymentStatus {
  COLLECTED = 'COLLECTED',
  REFUNDED = 'REFUNDED',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
  VOIDED = 'VOIDED',
  UNKNOWN = 'UNKNOWN',
}

export enum OutboxStatus {
  PENDING = 'pending',
  CONSUMED = 'consumed',
  FAILED = 'failed',
}

export enum RunStatus {
  RUNNING = 'running',
  SUCCESS = 'success',
  PARTIAL = 'partial',
  FAILED = 'failed',
}
