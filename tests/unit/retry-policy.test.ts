import { withDbRetry } from '../../src/db/retry-policy.service';
import { ConfigService } from '../../src/config/config.service';

beforeAll(() => {
  ConfigService.load({
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  } as NodeJS.ProcessEnv);
});

class PrismaP1001 extends Error {
  code = 'P1001';
}
class FatalP2002 extends Error {
  code = 'P2002'; // unique-violation — must NOT retry
}

describe('withDbRetry', () => {
  it('retries retryable errors then succeeds', async () => {
    let calls = 0;
    const result = await withDbRetry(
      async () => {
        calls++;
        if (calls < 3) throw new PrismaP1001('db unreachable');
        return 'ok';
      },
      { attempts: 3, baseMs: 5 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does NOT retry non-retryable errors', async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new FatalP2002('unique violation');
        },
        { attempts: 3, baseMs: 5 },
      ),
    ).rejects.toThrow('unique violation');
    expect(calls).toBe(1);
  });

  it('throws last error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withDbRetry(
        async () => {
          calls++;
          throw new PrismaP1001('persistent');
        },
        { attempts: 3, baseMs: 5 },
      ),
    ).rejects.toThrow('persistent');
    expect(calls).toBe(3);
  });
});
