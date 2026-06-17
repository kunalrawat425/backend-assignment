import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ConfigService } from '../config/config.service';

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function apiKeyGuard(req: Request, res: Response, next: NextFunction): void {
  const cfg = ConfigService.get();
  const supplied = req.header('x-api-key');
  if (!supplied || !timingSafeStringEqual(supplied, cfg.API_KEY)) {
    res.status(401).json({ error: 'unauthorized', code: 'invalid_api_key' });
    return;
  }
  next();
}

export function adminKeyGuard(req: Request, res: Response, next: NextFunction): void {
  const cfg = ConfigService.get();
  const supplied = req.header('x-admin-api-key');
  if (!supplied || !timingSafeStringEqual(supplied, cfg.ADMIN_API_KEY)) {
    res.status(401).json({ error: 'unauthorized', code: 'invalid_admin_key' });
    return;
  }
  next();
}
