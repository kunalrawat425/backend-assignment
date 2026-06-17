import { ConfigService } from '../../src/config/config.service';

describe('ConfigService', () => {
  beforeEach(() => ConfigService.reset());

  const baseEnv = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    API_KEY: 'a'.repeat(32),
    ADMIN_API_KEY: 'b'.repeat(32),
  };

  it('parses minimal valid env', () => {
    const cfg = ConfigService.load(baseEnv as NodeJS.ProcessEnv);
    expect(cfg.PORT).toBe(3000);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.STRIPE_ENABLED).toBe(false);
  });

  it('throws on missing DATABASE_URL', () => {
    expect(() =>
      ConfigService.load({ API_KEY: 'a'.repeat(32), ADMIN_API_KEY: 'b'.repeat(32) } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });

  it('rejects short API_KEY', () => {
    expect(() =>
      ConfigService.load({ ...baseEnv, API_KEY: 'short' } as NodeJS.ProcessEnv),
    ).toThrow(/API_KEY/);
  });

  it('coerces STRIPE_ENABLED=true correctly', () => {
    const cfg = ConfigService.load({
      ...baseEnv,
      STRIPE_ENABLED: 'true',
      STRIPE_API_KEY: 'sk_test_xxx',
    } as NodeJS.ProcessEnv);
    expect(cfg.STRIPE_ENABLED).toBe(true);
  });

  it('parses NOTIFY_ON csv', () => {
    const cfg = ConfigService.load({
      ...baseEnv,
      NOTIFY_ON: 'failure,recovery',
    } as NodeJS.ProcessEnv);
    expect(cfg.NOTIFY_ON).toEqual(['failure', 'recovery']);
  });

  it('validates NOTIFY_DAILY_AT_UTC format', () => {
    expect(() =>
      ConfigService.load({
        ...baseEnv,
        NOTIFY_DAILY_AT_UTC: '9am',
      } as NodeJS.ProcessEnv),
    ).toThrow(/NOTIFY_DAILY_AT_UTC/);
  });
});
