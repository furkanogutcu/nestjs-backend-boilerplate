import { INestApplication } from '@nestjs/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import type { NextFunction, Request, Response } from 'express';
import basicAuth from 'express-basic-auth';

import { env } from '@config/env.config';

import { buildOpenApiDocument } from './openapi.factory';

const DOCS_PATH = '/api/docs';
const DOCS_JSON_PATH = '/api/docs-json';

const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
].join('; ');

export function setupDocs(app: INestApplication): void {
  // * API docs are never exposed in production; the surface is dev/staging only.
  if (env.NODE_ENV === 'production') {
    return;
  }

  const document = buildOpenApiDocument(app);

  applyDocsAuth(app);

  // eslint-disable-next-line no-restricted-syntax -- Express handler signature is fixed (req, res[, next])
  app.getHttpAdapter().get(DOCS_JSON_PATH, (_req: Request, res: Response) => {
    res.json(document);
  });

  // eslint-disable-next-line no-restricted-syntax -- Express middleware signature is fixed (req, res, next)
  app.use(DOCS_PATH, (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', DOCS_CSP);
    next();
  });
  app.use(DOCS_PATH, apiReference({ content: document }));
}

// * Docs are dev/staging-only, but a staging/preview surface still reaches an untrusted network. When the
// * operator credentials are configured, put both the rendered docs and the raw OpenAPI JSON behind basic-auth.
// * Registered before the route handlers so the guard runs first.
function applyDocsAuth(app: INestApplication): void {
  const user = env.DOCS_AUTH_USER;
  const password = env.DOCS_AUTH_PASSWORD;

  if (!user || !password) {
    return;
  }

  const guard = basicAuth({ users: { [user]: password }, challenge: true, realm: 'Docs' });

  app.use(DOCS_JSON_PATH, guard);
  app.use(DOCS_PATH, guard);
}
