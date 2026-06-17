import 'dotenv/config'; // Load env variables from .env file
import { ConfigService } from '../../src/config/config.service';
import { getPrisma, disconnectPrisma } from '../../src/db/db.service';
import { RevenueService } from '../../src/repos/revenue.service';
import { PaymentStatus } from '../../src/types/enums';

const TEST_SOURCE = 'test_revenue';

beforeAll(async () => {
  ConfigService.load();
  const prisma = getPrisma();
  // Clear any leftover test data
  await prisma.payment.deleteMany({ where: { source: TEST_SOURCE } });
});

afterAll(async () => {
  const prisma = getPrisma();
  // Clean up test data
  await prisma.payment.deleteMany({ where: { source: TEST_SOURCE } });
  await disconnectPrisma();
});

describe('RevenueService Database Integrations', () => {
  const prisma = getPrisma();

  beforeEach(async () => {
    await prisma.payment.deleteMany({ where: { source: TEST_SOURCE } });
  });

  it('calculates total collected revenue using allow-list only', async () => {
    // Seed test payments
    await prisma.payment.createMany({
      data: [
        {
          source: TEST_SOURCE,
          externalId: 'p1',
          idempotencyKey: 'idemp_p1',
          amountCents: 10000n, // $100
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-17T10:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'p2',
          idempotencyKey: 'idemp_p2',
          amountCents: 5000n, // $50
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'paid',
          raw: {},
          occurredAt: new Date('2026-06-17T11:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'p3',
          idempotencyKey: 'idemp_p3',
          amountCents: 20000n, // $200 (pending, should NOT count)
          currency: 'USD',
          status: PaymentStatus.PENDING,
          rawStatus: 'processing',
          raw: {},
          occurredAt: new Date('2026-06-17T12:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'p4',
          idempotencyKey: 'idemp_p4',
          amountCents: 3000n, // $30 (failed, should NOT count)
          currency: 'USD',
          status: PaymentStatus.FAILED,
          rawStatus: 'failed',
          raw: {},
          occurredAt: new Date('2026-06-16T12:00:00Z'),
        },
      ],
    });

    const start = new Date('2026-06-15T00:00:00Z');
    const end = new Date('2026-06-18T23:59:59Z');

    const summary = await RevenueService.computeCollected(start, end, TEST_SOURCE);
    expect(Number(summary.totalRevenueCents)).toBe(15000); // 10000 + 5000
    expect(summary.count).toBe(2);
  });

  it('computes daily breakdown and asserts sum matches total exactly with zero drift', async () => {
    // Seed payments across different days
    await prisma.payment.createMany({
      data: [
        {
          source: TEST_SOURCE,
          externalId: 'p_d1',
          idempotencyKey: 'idemp_pd1',
          amountCents: 12000n, // $120
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-17T10:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'p_d2',
          idempotencyKey: 'idemp_pd2',
          amountCents: 8000n, // $80
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-17T15:00:00Z'),
        },
        {
          source: TEST_SOURCE,
          externalId: 'p_d3',
          idempotencyKey: 'idemp_pd3',
          amountCents: 15000n, // $150
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-16T12:00:00Z'),
        },
      ],
    });

    const start = new Date('2026-06-15T00:00:00Z');
    const end = new Date('2026-06-18T23:59:59Z');

    const breakdown = await RevenueService.computeDailyBreakdown(start, end, TEST_SOURCE);
    expect(Number(breakdown.totalRevenueCents)).toBe(35000); // 120 + 80 + 150

    const day17 = breakdown.breakdown.find((b) => b.date === '2026-06-17');
    const day16 = breakdown.breakdown.find((b) => b.date === '2026-06-16');

    expect(Number(day17?.amountCents)).toBe(20000);
    expect(day17?.count).toBe(2);
    expect(Number(day16?.amountCents)).toBe(15000);
    expect(day16?.count).toBe(1);

    const sumBreakdown = breakdown.breakdown.reduce((acc, curr) => acc + curr.amountCents, 0n);
    expect(sumBreakdown.toString()).toBe(breakdown.totalRevenueCents.toString());
  });

  it('computes weekly breakdown and asserts sum matches total exactly with zero drift', async () => {
    // Monday June 15, 2026
    await prisma.payment.createMany({
      data: [
        {
          source: TEST_SOURCE,
          externalId: 'p_w1',
          idempotencyKey: 'idemp_pw1',
          amountCents: 10000n,
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-15T10:00:00Z'), // Monday
        },
        {
          source: TEST_SOURCE,
          externalId: 'p_w2',
          idempotencyKey: 'idemp_pw2',
          amountCents: 5000n,
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-17T10:00:00Z'), // Wednesday
        },
        {
          source: TEST_SOURCE,
          externalId: 'p_w3',
          idempotencyKey: 'idemp_pw3',
          amountCents: 7000n,
          currency: 'USD',
          status: PaymentStatus.COLLECTED,
          rawStatus: 'succeeded',
          raw: {},
          occurredAt: new Date('2026-06-22T10:00:00Z'), // Next Monday
        },
      ],
    });

    const start = new Date('2026-06-10T00:00:00Z');
    const end = new Date('2026-06-28T23:59:59Z');

    const breakdown = await RevenueService.computeWeeklyBreakdown(start, end, TEST_SOURCE);
    expect(Number(breakdown.totalRevenueCents)).toBe(22000);

    const week15 = breakdown.breakdown.find((b) => b.date === '2026-06-15');
    const week22 = breakdown.breakdown.find((b) => b.date === '2026-06-22');

    expect(Number(week15?.amountCents)).toBe(15000);
    expect(Number(week22?.amountCents)).toBe(7000);

    const sumBreakdown = breakdown.breakdown.reduce((acc, curr) => acc + curr.amountCents, 0n);
    expect(sumBreakdown.toString()).toBe(breakdown.totalRevenueCents.toString());
  });
});
