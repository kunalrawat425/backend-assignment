import 'dotenv/config'; // Load env variables from .env file
import { ConfigService } from '../../src/config/config.service';
ConfigService.load();

import request from 'supertest';
import { getPrisma, disconnectPrisma } from '../../src/db/db.service';
import { PaymentStatus } from '../../src/types/enums';
import { Express } from 'express';

// Require server after config is loaded
const { buildApp } = require('../../src/server');

const TEST_SOURCE = 'api_test_revenue';

describe('Revenue API Integration Tests', () => {
  let app: Express;
  const prisma = getPrisma();
  const API_KEY = 'f5d96a7ebcd7fbe4f691c28c894d0a1b';

  beforeAll(async () => {
    app = buildApp();
    await prisma.payment.deleteMany({ where: { source: TEST_SOURCE } });
    
    // Seed test payments
    await prisma.payment.createMany({
      data: [
        {
          source: TEST_SOURCE,
          externalId: 'api_p1',
          idempotencyKey: 'api_idemp_p1',
          amountCents: 15000n, // $150
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-17T10:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'api_p2',
          idempotencyKey: 'api_idemp_p2',
          amountCents: 5000n, // $50
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'paid',
          raw: {},
          occurredAt: new Date('2026-06-16T15:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'api_p3',
          idempotencyKey: 'api_idemp_p3',
          amountCents: 3000n, // $30 (failed, should NOT count)
          currency: 'USD',
          status: PaymentStatus.FAILED,
          rawStatus: 'failed',
          raw: {},
          occurredAt: new Date('2026-06-17T12:00:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { source: TEST_SOURCE } });
    await disconnectPrisma();
  });

  it('1. rejects unauthorized requests with 401', async () => {
    const res = await request(app)
      .get('/metrics/revenue/summary')
      .query({ source: TEST_SOURCE });
    
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('2. rejects invalid date query parameters with 400', async () => {
    const res = await request(app)
      .get('/metrics/revenue/summary')
      .set('x-api-key', API_KEY)
      .query({ startDate: '17-06-2026', source: TEST_SOURCE });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_failed');
  });

  it('3. returns correct revenue summary with 200', async () => {
    const res = await request(app)
      .get('/metrics/revenue/summary')
      .set('x-api-key', API_KEY)
      .query({
        startDate: '2026-06-15',
        endDate: '2026-06-18',
        source: TEST_SOURCE,
      });

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueCents).toBe('20000'); // $150 + $50 = $200
    expect(res.body.count).toBe(2);
    expect(res.body.currency).toBe('USD');
  });

  it('4. returns correct daily breakdown and asserts consistency', async () => {
    const res = await request(app)
      .get('/metrics/revenue/daily')
      .set('x-api-key', API_KEY)
      .query({
        startDate: '2026-06-15',
        endDate: '2026-06-18',
        source: TEST_SOURCE,
      });

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueCents).toBe('20000');
    expect(res.body.breakdown).toHaveLength(2);
    
    const day17 = res.body.breakdown.find((b: any) => b.date === '2026-06-17');
    const day16 = res.body.breakdown.find((b: any) => b.date === '2026-06-16');

    expect(day17.amountCents).toBe('15000');
    expect(day17.count).toBe(1);
    expect(day16.amountCents).toBe('5000');
    expect(day16.count).toBe(1);
  });

  it('5. returns correct weekly breakdown and asserts consistency', async () => {
    const res = await request(app)
      .get('/metrics/revenue/weekly')
      .set('x-api-key', API_KEY)
      .query({
        startDate: '2026-06-15',
        endDate: '2026-06-18',
        source: TEST_SOURCE,
      });

    expect(res.status).toBe(200);
    expect(res.body.totalRevenueCents).toBe('20000');
    expect(res.body.breakdown).toHaveLength(1);
    
    const week15 = res.body.breakdown.find((b: any) => b.weekStartDate === '2026-06-15');
    expect(week15.amountCents).toBe('20000');
    expect(week15.count).toBe(2);
  });
});
