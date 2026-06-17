import express, { Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { requestId } from './middleware/request-id';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { buildHealthRouter } from './api/health/health.controller';
import { buildTriggerRouter } from './api/ingest/trigger.controller';
import { buildRunsRouter } from './api/ingest/runs.controller';
import { buildWebhookRouter } from './api/ingest/webhook.controller';
import { buildDocsRouter } from './openapi/docs.router';

export function buildApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestId);

  // BigInt JSON serialization
  if (!(BigInt.prototype as unknown as { toJSON?: () => string }).toJSON) {
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (
      this: bigint,
    ): string {
      return this.toString();
    };
  }

  // Health (no rate limit, no auth)
  app.use(buildHealthRouter());

  // Webhooks need RAW body for signature verify — mount BEFORE json parser
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
  app.use(buildWebhookRouter());

  // JSON parser for everything else
  app.use(express.json({ limit: '1mb' }));

  // Rate limit on read APIs
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/runs', apiLimiter);
  app.use('/metrics', apiLimiter);

  app.use(buildDocsRouter());
  app.use(buildTriggerRouter());
  app.use(buildRunsRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
