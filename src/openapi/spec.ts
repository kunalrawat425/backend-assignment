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
  },
};
