import { Request, Response, Router } from 'express';
import { pingDb } from '../../db/db.service';
import { getPrisma } from '../../db/db.service';
import { withDbRetry } from '../../db/retry-policy.service';
import { ConfigService } from '../../config/config.service';

const STARTED_AT = Date.now();

export function buildHealthRouter(): Router {
  const r = Router();

  r.get('/healthz', (_req: Request, res: Response) => {
    res.json({ status: 'ok', uptimeS: Math.floor((Date.now() - STARTED_AT) / 1000) });
  });

  r.get('/readyz', async (_req: Request, res: Response) => {
    const cfg = ConfigService.get();
    const db = await pingDb();
    const sources: Record<string, { ok: boolean; lastSync?: string; error?: string }> = {};
    const enabled = [
      ['stripe', cfg.STRIPE_ENABLED] as const,
      ['hubspot', cfg.HUBSPOT_ENABLED] as const,
      ['gcal', cfg.GCAL_ENABLED] as const,
    ].filter(([, on]) => on).map(([s]) => s);
    if (db.ok) {
      for (const s of enabled) {
        try {
          const latest = await withDbRetry(() =>
            getPrisma().runReport.findFirst({
              where: { source: s },
              orderBy: { startedAt: 'desc' },
              select: { startedAt: true, status: true },
            }),
          );
          sources[s] = latest
            ? { ok: latest.status !== 'failed', lastSync: latest.startedAt.toISOString() }
            : { ok: true };
        } catch (err) {
          sources[s] = { ok: false, error: (err as Error).message };
        }
      }
    }
    const allOk = db.ok && Object.values(sources).every((s) => s.ok);
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      checks: { db, ...sources },
      uptimeS: Math.floor((Date.now() - STARTED_AT) / 1000),
    });
  });

  return r;
}
