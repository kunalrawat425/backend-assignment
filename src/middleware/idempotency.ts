import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getPrisma } from '../db/db.service';
import { withDbRetry } from '../db/retry-policy.service';
import { childLogger } from '../logger/logger.service';

const log = childLogger({ component: 'idempotency' });
const TTL_HOURS = 24;

/**
 * Stripe-style Idempotency-Key header.
 * Required on mutating POST routes. Same key → stored response replayed.
 */
export function idempotency(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'POST') {
    next();
    return;
  }
  const key = req.header('idempotency-key');
  if (!key) {
    res.status(400).json({
      error: 'idempotency_key_required',
      message: 'Header "Idempotency-Key" is required for POST requests',
    });
    return;
  }
  const routeKey = `${req.method} ${req.path}`;
  void handleIdempotent(req, res, next, key, routeKey);
}

async function handleIdempotent(
  _req: Request,
  res: Response,
  next: NextFunction,
  key: string,
  routeKey: string,
): Promise<void> {
  try {
    const existing = await withDbRetry(() =>
      getPrisma().apiIdempotency.findUnique({ where: { key } }),
    );
    if (existing && existing.expiresAt > new Date()) {
      if (existing.routeKey !== routeKey) {
        res.status(409).json({
          error: 'idempotency_key_route_mismatch',
          message: 'Key was previously used on a different route',
        });
        return;
      }
      log.info({ key, routeKey }, 'idempotent_replay');
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }
    // Capture response on first call
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const status = res.statusCode;
      // best-effort write; do not block response
      void persistResponse(key, routeKey, body, status);
      return originalJson(body);
    }) as Response['json'];
    next();
  } catch (err) {
    log.error({ err: (err as Error).message }, 'idempotency_check_failed');
    next();
  }
}

async function persistResponse(
  key: string,
  routeKey: string,
  body: unknown,
  statusCode: number,
): Promise<void> {
  try {
    const bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
    await withDbRetry(() =>
      getPrisma().apiIdempotency.upsert({
        where: { key },
        update: {
          routeKey,
          responseBody: body as object,
          statusCode,
          expiresAt,
        },
        create: {
          key,
          routeKey,
          responseBody: body as object,
          statusCode,
          expiresAt,
        },
      }),
    );
    log.debug({ key, routeKey, statusCode, bodyHash }, 'idempotency_stored');
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'idempotency_persist_failed');
  }
}
