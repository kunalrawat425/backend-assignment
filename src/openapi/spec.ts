export const openApiDoc = {
  openapi: '3.1.0',
  info: {
    title: 'Buffalo Ingestion API',
    version: '1.0.0',
    description:
      'Unified ingestion pipeline for Stripe, HubSpot, and Google Calendar with revenue metrics.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev' }],
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      AdminKey: { type: 'apiKey', in: 'header', name: 'X-Admin-Api-Key' },
    },
    schemas: {
      RunReport: {
        type: 'object',
        properties: {
          runId: { type: 'string', format: 'uuid' },
          source: { type: 'string', enum: ['stripe', 'hubspot', 'gcal'] },
          entity: { type: 'string', enum: ['payments', 'contacts', 'events'] },
          mode: { type: 'string', enum: ['INCREMENTAL', 'FULL'] },
          startedAt: { type: 'string', format: 'date-time' },
          finishedAt: { type: 'string', format: 'date-time', nullable: true },
          pagesFetched: { type: 'integer' },
          recordsFetched: { type: 'integer' },
          recordsUpserted: { type: 'integer' },
          recordsDeduped: { type: 'integer' },
          recordsFailed: { type: 'integer' },
          staleCursorDetected: { type: 'boolean' },
          fullBackfillTriggered: { type: 'boolean' },
          failedRecords: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                externalId: { type: 'string', nullable: true },
                stage: { type: 'string', enum: ['fetch', 'normalize', 'upsert', 'publish'] },
                error: { type: 'string' },
                rawPreview: { type: 'string' },
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/healthz': {
      get: {
        summary: 'Liveness probe',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'Service is alive',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    uptimeS: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/readyz': {
      get: {
        summary: 'Readiness probe — checks DB + per-source last sync',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'All checks healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['ok', 'degraded'] },
                    checks: {
                      type: 'object',
                      properties: {
                        db: {
                          type: 'object',
                          properties: { ok: { type: 'boolean' }, latencyMs: { type: 'number' } },
                        },
                        stripe: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            ok: { type: 'boolean' },
                            lastSync: { type: 'string', format: 'date-time', nullable: true },
                          },
                        },
                      },
                    },
                    uptimeS: { type: 'number' },
                  },
                },
              },
            },
          },
          '503': { description: 'One or more checks degraded' },
        },
      },
    },
    '/trigger/{source}/{mode}': {
      post: {
        summary: 'Trigger a sync run (admin)',
        tags: ['Ingest'],
        security: [{ AdminKey: [] }],
        parameters: [
          {
            name: 'source',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['stripe', 'hubspot', 'gcal'] },
          },
          {
            name: 'mode',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['incremental', 'full'] },
          },
        ],
        requestBody: {
          description: 'No body required',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '202': {
            description: 'Run accepted, processing async',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    runId: { type: 'string', format: 'uuid' },
                    source: { type: 'string' },
                    mode: { type: 'string' },
                    status: { type: 'string', example: 'accepted' },
                  },
                },
              },
            },
          },
          '400': { description: 'Invalid source or mode' },
          '401': { description: 'Missing or invalid admin API key' },
        },
      },
    },
    '/runs': {
      get: {
        summary: 'List run reports',
        tags: ['Runs'],
        security: [{ ApiKey: [] }],
        parameters: [
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string', enum: ['stripe', 'hubspot', 'gcal'] },
          },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
        ],
        responses: {
          '200': {
            description: 'List of run reports',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    runs: { type: 'array', items: { $ref: '#/components/schemas/RunReport' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/runs/{runId}': {
      get: {
        summary: 'Get a specific run report',
        tags: ['Runs'],
        security: [{ ApiKey: [] }],
        parameters: [
          { name: 'runId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'Run report',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RunReport' },
              },
            },
          },
          '404': { description: 'Run not found' },
        },
      },
    },
    '/webhooks/stripe': {
      post: {
        summary: 'Stripe webhook receiver',
        tags: ['Webhooks'],
        description:
          'Receives charge.* and refund.* events. Body must be raw bytes. Stripe-Signature header required.',
        parameters: [
          {
            name: 'Stripe-Signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          description: 'Raw Stripe event payload',
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          '200': { description: 'Event accepted' },
          '400': { description: 'Invalid signature or unsupported event' },
        },
      },
    },
    '/metrics/revenue': {
      get: {
        summary: 'Collected revenue summary for a date range',
        tags: ['Metrics'],
        security: [{ ApiKey: [] }],
        parameters: [
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'ISO 8601 start (inclusive), e.g. 2026-01-01T00:00:00Z',
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'ISO 8601 end (exclusive), e.g. 2026-06-30T23:59:59Z',
          },
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string', enum: ['stripe', 'hubspot', 'gcal'] },
            description: 'Filter to one source (optional)',
          },
        ],
        responses: {
          '200': {
            description: 'Revenue summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    totalCollectedCents: { type: 'string', example: '159900' },
                    txnCount: { type: 'integer', example: 3 },
                    from: { type: 'string', format: 'date-time' },
                    to: { type: 'string', format: 'date-time' },
                    source: { type: 'string', nullable: true },
                  },
                },
                example: {
                  totalCollectedCents: '159900',
                  txnCount: 3,
                  from: '2026-01-01T00:00:00.000Z',
                  to: '2026-06-30T23:59:59.000Z',
                  source: null,
                },
              },
            },
          },
          '400': { description: 'Invalid date range or range > 366 days' },
          '401': { description: 'Missing or invalid API key' },
        },
      },
    },
    '/metrics/revenue/breakdown': {
      get: {
        summary: 'Collected revenue broken down by time bucket — totals ALWAYS match /metrics/revenue',
        tags: ['Metrics'],
        security: [{ ApiKey: [] }],
        parameters: [
          {
            name: 'granularity',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['day', 'week', 'month'] },
          },
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'source',
            in: 'query',
            schema: { type: 'string', enum: ['stripe', 'hubspot', 'gcal'] },
          },
        ],
        responses: {
          '200': {
            description: 'Revenue breakdown — sum(buckets.collectedCents) === totalCollectedCents',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    granularity: { type: 'string', enum: ['day', 'week', 'month'] },
                    from: { type: 'string', format: 'date-time' },
                    to: { type: 'string', format: 'date-time' },
                    source: { type: 'string', nullable: true },
                    totalCollectedCents: { type: 'string' },
                    totalTxnCount: { type: 'integer' },
                    buckets: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          bucketStart: { type: 'string', format: 'date-time' },
                          collectedCents: { type: 'string' },
                          txnCount: { type: 'integer' },
                        },
                      },
                    },
                  },
                },
                example: {
                  granularity: 'month',
                  from: '2026-01-01T00:00:00.000Z',
                  to: '2026-06-30T23:59:59.000Z',
                  source: null,
                  totalCollectedCents: '159900',
                  totalTxnCount: 3,
                  buckets: [
                    { bucketStart: '2026-01-01T00:00:00.000Z', collectedCents: '9900', txnCount: 1 },
                    { bucketStart: '2026-02-01T00:00:00.000Z', collectedCents: '0', txnCount: 0 },
                    { bucketStart: '2026-06-01T00:00:00.000Z', collectedCents: '150000', txnCount: 2 },
                  ],
                },
              },
            },
          },
          '400': { description: 'Missing granularity or invalid range' },
        },
      },
    },
    '/metrics/unmapped-statuses': {
      get: {
        summary: 'Ops — list payment rows with status=UNKNOWN (unmapped raw statuses)',
        tags: ['Metrics'],
        security: [{ ApiKey: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          '200': {
            description: 'Unmapped status groups',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    statuses: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          source: { type: 'string' },
                          rawStatus: { type: 'string' },
                          count: { type: 'integer' },
                          sample: { type: 'string', description: 'Sample external_id for debugging' },
                        },
                      },
                    },
                  },
                },
                example: {
                  count: 1,
                  statuses: [
                    { source: 'stripe', rawStatus: 'partially_funded', count: 3, sample: 'ch_abc123' },
                  ],
                },
              },
            },
          },
        },
      },
    },
  },
};
