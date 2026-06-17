import { NextFunction, Request, Response } from 'express';
import { ZodSchema } from 'zod';

export interface ValidateSchemas {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(schemas: ValidateSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ in: string; field: string; message: string }> = [];
    for (const key of ['body', 'query', 'params'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const parsed = schema.safeParse(req[key]);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          errors.push({
            in: key,
            field: issue.path.join('.'),
            message: issue.message,
          });
        }
      } else {
        (req as unknown as Record<string, unknown>)[key] = parsed.data;
      }
    }
    if (errors.length > 0) {
      res.status(400).json({ error: 'validation_failed', issues: errors });
      return;
    }
    next();
  };
}
