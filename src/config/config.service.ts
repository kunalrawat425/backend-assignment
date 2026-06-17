import { z } from 'zod';

const bool = z
  .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  API_KEY: z.string().min(16),
  ADMIN_API_KEY: z.string().min(16),

  STRIPE_ENABLED: bool.default('false'),
  STRIPE_API_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  HUBSPOT_ENABLED: bool.default('false'),
  HUBSPOT_ACCESS_TOKEN: z.string().optional(),
  HUBSPOT_WEBHOOK_SECRET: z.string().optional(),

  GCAL_ENABLED: bool.default('false'),
  GOOGLE_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),

  RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(10),
  MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
  BACKOFF_BASE_MS: z.coerce.number().int().positive().default(1000),
  FULL_BACKFILL_MIN_INTERVAL_MIN: z.coerce.number().int().positive().default(60),

  RESEND_API_KEY: z.string().optional(),
  NOTIFY_TO: z.string().email().default('kunalrawat425@gmail.com'),
  NOTIFY_FROM: z.string().default('buffalo@resend.dev'),
  NOTIFY_ON: csv.default('failure,recovery,daily'),
  NOTIFY_DAILY_AT_UTC: z.string().regex(/^\d{2}:\d{2}$/).default('09:00'),

  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
});

export type AppConfig = z.infer<typeof configSchema>;

export class ConfigService {
  private static instance: AppConfig | null = null;

  static load(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = configSchema.safeParse(env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    ConfigService.instance = parsed.data;
    return parsed.data;
  }

  static get(): AppConfig {
    if (!ConfigService.instance) {
      return ConfigService.load();
    }
    return ConfigService.instance;
  }

  static reset(): void {
    ConfigService.instance = null;
  }
}
