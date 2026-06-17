import { PaymentRepo } from '../../src/repos/payment.repo';

// Tests that don't require a DB connection — pure-logic guards in the repo
describe('PaymentRepo.sumCollected — granularity allowlist', () => {
  const repo = new PaymentRepo();

  it('throws 400 for unlisted granularity value', async () => {
    await expect(
      // Cast to any to simulate bypass of controller-level zod enum
      repo.sumCollected({ from: new Date('2025-01-01'), to: new Date('2025-02-01') }, 'year' as any),
    ).rejects.toMatchObject({ message: 'invalid_granularity: year', statusCode: 400 });
  });

  it('throws 400 for SQL-injection attempt via granularity', async () => {
    await expect(
      repo.sumCollected({ from: new Date('2025-01-01'), to: new Date('2025-02-01') }, "day'; DROP TABLE payments;--" as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 for empty string granularity', async () => {
    await expect(
      repo.sumCollected({ from: new Date('2025-01-01'), to: new Date('2025-02-01') }, '' as any),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  const valid = ['day', 'week', 'month'] as const;
  for (const gran of valid) {
    it(`does NOT throw 400 for valid granularity "${gran}" (may fail on DB, not allowlist)`, async () => {
      // The allowlist check itself must pass — the DB error (no connection) comes after.
      // We verify the rejection is NOT the allowlist error.
      await expect(
        repo.sumCollected({ from: new Date('2025-01-01'), to: new Date('2025-02-01') }, gran),
      ).rejects.not.toMatchObject({ message: `invalid_granularity: ${gran}` });
    });
  }

  it('null granularity passes allowlist (summary path)', async () => {
    // null means summary mode — skip allowlist. Should fail on DB, not allowlist.
    await expect(
      repo.sumCollected({ from: new Date('2025-01-01'), to: new Date('2025-02-01') }, null),
    ).rejects.not.toMatchObject({ statusCode: 400 });
  });
});
