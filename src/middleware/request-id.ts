import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.requestId = supplied ?? randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
