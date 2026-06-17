import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDoc } from './spec';

const router = Router();

router.get('/docs/openapi.json', (_req, res) => {
  res.json(openApiDoc);
});

router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

export function buildDocsRouter(): Router {
  return router;
}
