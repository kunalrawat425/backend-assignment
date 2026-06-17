import { RevenueService } from '../../src/revenue/revenue.service';
import { PaymentRepo, RevenueBucket } from '../../src/repos/payment.repo';

function makeRepo(buckets: RevenueBucket[]): jest.Mocked<PaymentRepo> {
  return {
    sumCollected: jest.fn().mockResolvedValue(buckets),
    upsert: jest.fn(),
    getUnmappedStatuses: jest.fn(),
  } as unknown as jest.Mocked<PaymentRepo>;
}

function bucket(days: number, cents: bigint, count: number): RevenueBucket {
  return { bucketStart: new Date(Date.now() + days * 86400000), collectedCents: cents, txnCount: count };
}

const FROM = new Date('2025-01-01T00:00:00Z');
const TO = new Date('2025-02-01T00:00:00Z');

describe('RevenueService.validateRange', () => {
  const svc = new RevenueService(makeRepo([]));

  it('throws 400 on invalid date', async () => {
    await expect(svc.summary({ from: new Date('not-a-date'), to: TO }))
      .rejects.toMatchObject({ message: 'invalid_date_format', statusCode: 400 });
  });

  it('throws 400 when from >= to', async () => {
    await expect(svc.summary({ from: TO, to: FROM }))
      .rejects.toMatchObject({ message: 'from_must_be_before_to', statusCode: 400 });
  });

  it('throws 400 when from == to', async () => {
    await expect(svc.summary({ from: FROM, to: FROM }))
      .rejects.toMatchObject({ message: 'from_must_be_before_to', statusCode: 400 });
  });

  it('throws 400 when range >= 366 days', async () => {
    const tooBig = new Date(FROM.getTime() + 366 * 86400000);
    await expect(svc.summary({ from: FROM, to: tooBig }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts 365-day range', async () => {
    const repo = makeRepo([{ bucketStart: FROM, collectedCents: 0n, txnCount: 0 }]);
    const svc2 = new RevenueService(repo);
    const to365 = new Date(FROM.getTime() + 365 * 86400000);
    await expect(svc2.summary({ from: FROM, to: to365 })).resolves.toBeDefined();
  });
});

describe('RevenueService.summary', () => {
  it('returns zero totals when no payments', async () => {
    const repo = makeRepo([{ bucketStart: FROM, collectedCents: 0n, txnCount: 0 }]);
    const svc = new RevenueService(repo);
    const result = await svc.summary({ from: FROM, to: TO });
    expect(result.totalCollectedCents).toBe('0');
    expect(result.txnCount).toBe(0);
  });

  it('serializes BigInt as string to survive JSON', async () => {
    const repo = makeRepo([{ bucketStart: FROM, collectedCents: 9999999999999n, txnCount: 5 }]);
    const svc = new RevenueService(repo);
    const result = await svc.summary({ from: FROM, to: TO });
    expect(typeof result.totalCollectedCents).toBe('string');
    expect(result.totalCollectedCents).toBe('9999999999999');
  });

  it('passes source filter through to repo', async () => {
    const repo = makeRepo([{ bucketStart: FROM, collectedCents: 100n, txnCount: 1 }]);
    const svc = new RevenueService(repo);
    await svc.summary({ from: FROM, to: TO, source: 'stripe' });
    expect(repo.sumCollected).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'stripe' }),
      null,
    );
  });

  it('uses null granularity for summary call', async () => {
    const repo = makeRepo([{ bucketStart: FROM, collectedCents: 0n, txnCount: 0 }]);
    const svc = new RevenueService(repo);
    await svc.summary({ from: FROM, to: TO });
    expect(repo.sumCollected).toHaveBeenCalledWith(expect.anything(), null);
  });
});

describe('RevenueService.breakdown', () => {
  it('aggregates multiple buckets correctly', async () => {
    const buckets = [bucket(0, 100n, 1), bucket(1, 200n, 3), bucket(2, 0n, 0)];
    const repo = makeRepo(buckets);
    const svc = new RevenueService(repo);
    const result = await svc.breakdown({ from: FROM, to: TO, granularity: 'day' });
    expect(result.totalCollectedCents).toBe('300');
    expect(result.totalTxnCount).toBe(4);
    expect(result.buckets).toHaveLength(3);
  });

  it('totalCollectedCents equals sum of buckets.collectedCents', async () => {
    const buckets = [bucket(0, 500n, 2), bucket(7, 1500n, 6)];
    const repo = makeRepo(buckets);
    const svc = new RevenueService(repo);
    const result = await svc.breakdown({ from: FROM, to: TO, granularity: 'week' });
    const bucketSum = result.buckets.reduce((acc, b) => acc + BigInt(b.collectedCents), 0n);
    expect(BigInt(result.totalCollectedCents)).toBe(bucketSum);
  });

  it('passes granularity to repo', async () => {
    const repo = makeRepo([]);
    const svc = new RevenueService(repo);
    await svc.breakdown({ from: FROM, to: TO, granularity: 'month' }).catch(() => {});
    expect(repo.sumCollected).toHaveBeenCalledWith(expect.anything(), 'month');
  });

  it('serializes bucket collectedCents as strings', async () => {
    const repo = makeRepo([bucket(0, 12345n, 2)]);
    const svc = new RevenueService(repo);
    const result = await svc.breakdown({ from: FROM, to: TO, granularity: 'day' });
    expect(typeof result.buckets[0].collectedCents).toBe('string');
    expect(result.buckets[0].collectedCents).toBe('12345');
  });

  it('handles empty bucket list with zero totals', async () => {
    const repo = makeRepo([]);
    const svc = new RevenueService(repo);
    const result = await svc.breakdown({ from: FROM, to: TO, granularity: 'day' });
    expect(result.totalCollectedCents).toBe('0');
    expect(result.totalTxnCount).toBe(0);
    expect(result.buckets).toHaveLength(0);
  });
});
