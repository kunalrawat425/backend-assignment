import 'dotenv/config';
import { ConfigService } from '../../src/config/config.service';

// Mock Stripe library before importing anything else
const mockList = jest.fn();
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => {
    return {
      charges: {
        list: mockList,
      },
    };
  });
});

import request from 'supertest';
import { getPrisma, disconnectPrisma } from '../../src/db/db.service';
import { OutboxProcessor } from '../../src/outbox/outbox.processor';
import { OutboxService } from '../../src/outbox/outbox.service';
import { PaymentRepo } from '../../src/repos/payment.repo';
import { StripeNormalizer } from '../../src/normalizers/stripe.normalizer';
import { PaymentStatus, SourceType } from '../../src/types/enums';
import { Express } from 'express';

const { buildApp } = require('../../src/server');

describe('Cursor Ingestion & Revenue Metrics E2E Test Cycle', () => {
  let app: Express;
  const prisma = getPrisma();
  const API_KEY = 'f5d96a7ebcd7fbe4f691c28c894d0a1b';
  const ADMIN_API_KEY = '9a7c3b2f5d1e4c7b8e0a1f2c3d4e5f6a';

  beforeAll(async () => {
    // Enforce Stripe ingestion enabled in config
    process.env.STRIPE_ENABLED = 'true';
    process.env.STRIPE_API_KEY = 'sk_test_mockkey';
    ConfigService.reset();
    ConfigService.load();
    app = buildApp();
    
    // Clean up all tables that might affect the test
    await prisma.payment.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.syncCursor.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.ingestOutbox.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.runReport.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.apiIdempotency.deleteMany({});
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.syncCursor.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.ingestOutbox.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.runReport.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.apiIdempotency.deleteMany({});
    await disconnectPrisma();
  });

  it('verifies ingestion cursor advancement and metrics computation sequentially', async () => {
    // Ensure clean state
    await prisma.payment.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.syncCursor.deleteMany({ where: { source: SourceType.STRIPE } });
    await prisma.apiIdempotency.deleteMany({});
    
    const nowSuffix = Date.now();

    // ==============================================
    // BATCH 1: Ingest 2 Charges ($10 and $20)
    // ==============================================
    
    // Mock Stripe API returning 2 charges
    const created1 = 1718611200; // 2026-06-17T08:00:00Z
    const created2 = 1718611210; // 2026-06-17T08:00:10Z
    
    mockList.mockResolvedValueOnce({
      data: [
        {
          id: 'ch_jest_001',
          amount: 1000,
          currency: 'usd',
          status: 'succeeded',
          created: created1,
        },
        {
          id: 'ch_jest_002',
          amount: 2000,
          currency: 'usd',
          status: 'succeeded',
          created: created2,
        },
      ],
      has_more: false,
    });

    // 1. Trigger incremental sync via API
    const resTrigger1 = await request(app)
      .post('/trigger/stripe/incremental')
      .set('x-admin-api-key', ADMIN_API_KEY)
      .set('idempotency-key', `jest-test-trigger-1-${nowSuffix}`)
      .send({});
    
    expect(resTrigger1.status).toBe(202);
    const runId1 = resTrigger1.body.runId;
    expect(runId1).toBeDefined();

    // Poll the run report until the producer finishes
    let finished1 = false;
    for (let i = 0; i < 40; i++) {
      const rep = await prisma.runReport.findUnique({ where: { runId: runId1 } });
      if (rep && rep.finishedAt !== null) {
        finished1 = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(finished1).toBe(true);

    // 2. Run Ingestion Processor to process outbox
    const processor = new OutboxProcessor(new OutboxService(), new PaymentRepo(), new StripeNormalizer());
    const stats1 = await processor.drain();
    
    expect(stats1.consumed).toBe(2);
    expect(stats1.failed).toBe(0);

    // 3. Verify Database payments
    const dbPayments1 = await prisma.payment.findMany({
      where: { source: SourceType.STRIPE },
      orderBy: { occurredAt: 'asc' },
    });
    expect(dbPayments1).toHaveLength(2);
    expect(dbPayments1[0].externalId).toBe('ch_jest_001');
    expect(dbPayments1[1].externalId).toBe('ch_jest_002');
    expect(dbPayments1[0].status).toBe(PaymentStatus.COLLECTED);

    // 4. Verify advanced cursor in database
    const dbCursor1 = await prisma.syncCursor.findUnique({
      where: { source_entity: { source: SourceType.STRIPE, entity: 'payments' } },
    });
    expect(dbCursor1).toBeDefined();
    // Cursor should be: created2 + 1 second (1718611211) converted to ISO timestamp
    const expectedCursor1 = new Date((created2 + 1) * 1000).toISOString();
    expect(dbCursor1?.cursor).toBe(expectedCursor1);

    // 5. Verify API Revenue Metrics
    const resMetrics1 = await request(app)
      .get('/metrics/revenue/summary')
      .set('x-api-key', API_KEY)
      .query({ source: SourceType.STRIPE });
    
    expect(resMetrics1.status).toBe(200);
    expect(resMetrics1.body.totalRevenueCents).toBe('3000'); // $10 + $20 = $30
    expect(resMetrics1.body.count).toBe(2);

    // ==============================================
    // BATCH 2: Ingest 3 Charges ($15, $25, and $35)
    // ==============================================
    
    const created3 = 1718611300;
    const created4 = 1718611310;
    const created5 = 1718611320;

    mockList.mockResolvedValueOnce({
      data: [
        {
          id: 'ch_jest_003',
          amount: 1500,
          currency: 'usd',
          status: 'succeeded',
          created: created3,
        },
        {
          id: 'ch_jest_004',
          amount: 2500,
          currency: 'usd',
          status: 'succeeded',
          created: created4,
        },
        {
          id: 'ch_jest_005',
          amount: 3500,
          currency: 'usd',
          status: 'succeeded',
          created: created5,
        },
      ],
      has_more: false,
    });

    // 1. Trigger incremental sync again via API
    const resTrigger2 = await request(app)
      .post('/trigger/stripe/incremental')
      .set('x-admin-api-key', ADMIN_API_KEY)
      .set('idempotency-key', `jest-test-trigger-2-${nowSuffix}`)
      .send({});
    
    expect(resTrigger2.status).toBe(202);
    const runId2 = resTrigger2.body.runId;

    // Poll the run report until the second producer finishes
    let finished2 = false;
    for (let i = 0; i < 40; i++) {
      const rep = await prisma.runReport.findUnique({ where: { runId: runId2 } });
      if (rep && rep.finishedAt !== null) {
        finished2 = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect(finished2).toBe(true);

    // Verify Stripe mock list was called with the cursor filter
    expect(mockList).toHaveBeenCalledTimes(2);
    // The second call's first argument should contain createdGte representing the advanced cursor time
    const secondCallParams = mockList.mock.calls[1][0];
    expect(secondCallParams.created.gte).toBe(created2 + 1);

    // 2. Run processor again
    const stats2 = await processor.drain();
    expect(stats2.consumed).toBe(3);

    // 3. Verify total DB payments
    const dbPayments2 = await prisma.payment.findMany({
      where: { source: SourceType.STRIPE },
      orderBy: { occurredAt: 'asc' },
    });
    expect(dbPayments2).toHaveLength(5);

    // 4. Verify advanced cursor is set to latest (created5 + 1 second)
    const dbCursor2 = await prisma.syncCursor.findUnique({
      where: { source_entity: { source: SourceType.STRIPE, entity: 'payments' } },
    });
    const expectedCursor2 = new Date((created5 + 1) * 1000).toISOString();
    expect(dbCursor2?.cursor).toBe(expectedCursor2);

    // 5. Verify total metrics is now $105 (3000 + 1500 + 2500 + 3500 = 10500 cents)
    const resMetrics2 = await request(app)
      .get('/metrics/revenue/summary')
      .set('x-api-key', API_KEY)
      .query({ source: SourceType.STRIPE });
    
    expect(resMetrics2.status).toBe(200);
    expect(resMetrics2.body.totalRevenueCents).toBe('10500');
    expect(resMetrics2.body.count).toBe(5);
  }, 60000);
});
