import { getLogger } from '../logger/logger.service';

const RETRYABLE_PRISMA_CODES = new Set([
  'P1001', // db unreachable
  'P1002', // db unreachable timeout
  'P1008', // ops timeout
  'P1017', // connection closed
  'P2024', // connection pool timeout
]);

const RETRYABLE_NODE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
]);

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string };
  if (e.code && RETRYABLE_PRISMA_CODES.has(e.code)) return true;
  if (e.code && RETRYABLE_NODE_CODES.has(e.code)) return true;
  if (e.message && /connection|timeout|reset|terminated/i.test(e.message)) return true;
  return false;
}

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  label?: string;
}

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const label = opts.label ?? 'db-op';
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      const delay = baseMs * Math.pow(2, i) + Math.floor(Math.random() * baseMs);
      getLogger().warn(
        { label, attempt: i + 1, attempts, delay, err: (err as Error).message },
        'db_retry',
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
