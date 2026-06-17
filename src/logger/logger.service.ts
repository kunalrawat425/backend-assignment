import winston from 'winston';
import { ConfigService } from '../config/config.service';

const PII_KEYS = new Set([
  'email',
  'phone',
  'card',
  'card_number',
  'cardNumber',
  'address',
  'addressLine1',
  'addressLine2',
  'zip',
  'postal_code',
  'cvv',
  'cvc',
  'ssn',
  'taxId',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_KEYS.has(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

const redactFormat = winston.format((info) => {
  const redacted = redact(info) as any;
  const symbols = Object.getOwnPropertySymbols(info);
  for (const sym of symbols) {
    redacted[sym] = (info as any)[sym];
  }
  return redacted as winston.Logform.TransformableInfo;
})();


/**
 * Logger wrapper — bunyan-style API: `log.info({ meta }, 'msg')`.
 * Backed by winston under the hood.
 */
export class Logger {
  constructor(private readonly w: winston.Logger) {}

  private call(level: 'debug' | 'info' | 'warn' | 'error', meta: unknown, msg?: string): void {
    if (typeof meta === 'string') {
      this.w.log(level, meta);
      return;
    }
    this.w.log(level, msg ?? '', meta as object);
  }

  debug(meta: unknown, msg?: string): void { this.call('debug', meta, msg); }
  info(meta: unknown, msg?: string): void { this.call('info', meta, msg); }
  warn(meta: unknown, msg?: string): void { this.call('warn', meta, msg); }
  error(meta: unknown, msg?: string): void { this.call('error', meta, msg); }

  child(meta: Record<string, unknown>): Logger {
    return new Logger(this.w.child(meta));
  }

  // Expose underlying winston for advanced cases (tests, transports)
  get underlying(): winston.Logger {
    return this.w;
  }
}

let rootLogger: Logger | null = null;

export function getLogger(): Logger {
  if (rootLogger) return rootLogger;
  const cfg = ConfigService.get();
  const w = winston.createLogger({
    level: cfg.LOG_LEVEL,
    defaultMeta: { service: 'buffalo' },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      redactFormat,
      winston.format.json(),
    ),
    transports: [new winston.transports.Console()],
  });
  rootLogger = new Logger(w);
  return rootLogger;
}

export function childLogger(meta: Record<string, unknown>): Logger {
  return getLogger().child(meta);
}

export function resetLogger(): void {
  rootLogger = null;
}
