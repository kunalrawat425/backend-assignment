import { NextFunction, Request, Response } from 'express';
import { childLogger } from '../logger/logger.service';

const log = childLogger({ component: 'error-handler' });

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found', path: req.path });
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  log.error(
    { requestId: req.requestId, path: req.path, err: err.message, stack: err.stack },
    'unhandled_error',
  );
  if (res.headersSent) return;
  const status = (err as unknown as { statusCode?: number }).statusCode ?? 500;
  const isClientError = status >= 400 && status < 500;
  res.status(status).json({
    error: isClientError ? err.message : 'internal_error',
    requestId: req.requestId,
  });
}
