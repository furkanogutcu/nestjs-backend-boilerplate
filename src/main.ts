// * Must load before any instrumented module so OpenTelemetry patches them first.
import './infrastructure/observability/tracing';
import './database/extensions';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Settings } from 'luxon';
import { Logger } from 'nestjs-pino';

import { versioningConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { setupDocs } from '@infrastructure/docs/setup-docs';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    // * Keep the raw request body so the Resend webhook can verify its Svix signature over the exact bytes.
    rawBody: true,
  });

  app.useBodyParser('json', { limit: '1mb' });

  app.enableShutdownHooks();

  app.useLogger(app.get(Logger));
  app.use(contextBuilder);
  // * Parse the Cookie header so the auth layer can read the refresh & CSRF cookies (web transport).
  app.use(cookieParser());

  app.getHttpAdapter().getInstance().disable('x-powered-by');

  app.set('trust proxy', env.TRUST_PROXY);

  // * CORS with credentials only when explicit web origins are configured (a cross-origin SPA needs the refresh
  // * cookie sent + received). Empty means same-origin/native-only, so CORS stays off.
  app.enableCors(
    env.CORS_ALLOWED_ORIGINS.length > 0 ? { origin: env.CORS_ALLOWED_ORIGINS, credentials: true } : { origin: false },
  );

  app.enableVersioning(versioningConfig);

  setupDocs(app);

  Settings.defaultZone = 'utc';

  const server = await app.listen(env.PORT);

  server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  server.timeout = env.HTTP_SOCKET_TIMEOUT_MS;
}

void bootstrap().catch((error) => {
  console.error('❌ Failed to bootstrap application', error);
  process.exit(1);
});
