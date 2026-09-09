// * Must load before any instrumented module so OpenTelemetry patches them first.
import './infrastructure/observability/tracing';
import './database/extensions';

import { INestApplication, Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { Settings } from 'luxon';
import { Logger } from 'nestjs-pino';

import { versioningConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { setupDocs } from '@infrastructure/docs/setup-docs';
import { ShutdownStateService } from '@infrastructure/lifecycle/shutdown-state.service';
import { shutdownTracing } from '@infrastructure/observability/tracing';
import { contextBuilder } from '@shared/middlewares/context-builder.middleware';
import { sleep } from '@shared/utils/sleep.util';

import { AppModule } from './app.module';

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
    // * Keep the raw request body so the Resend webhook can verify its Svix signature over the exact bytes.
    rawBody: true,
  });

  app.useBodyParser('json', { limit: '1mb' });

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

  registerShutdownHandlers(app);

  const server = await app.listen(env.PORT);

  server.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  server.timeout = env.HTTP_SOCKET_TIMEOUT_MS;
}

// ! Nest's enableShutdownHooks() is deliberately not used: it calls app.close() the moment the signal lands,
// ! while the load balancer is still routing traffic here. The order below is the whole point — readiness must
// ! fail, and the balancer must be given time to notice, BEFORE the server stops accepting connections.
function registerShutdownHandlers(app: INestApplication): void {
  const logger = new NestLogger('Shutdown');

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      // ! Unconditional exit guard: if any step below hangs (a stuck query, a queue that will not close),
      // ! the orchestrator would SIGKILL us anyway — exiting on our own terms at least flushes the logs.
      const forceExit = setTimeout(() => {
        logger.error(`Shutdown exceeded ${env.SHUTDOWN_TIMEOUT_MS}ms; forcing exit`);
        process.exit(1);
      }, env.SHUTDOWN_TIMEOUT_MS);

      forceExit.unref();

      void drain({ app, logger, signal })
        .then(() => {
          clearTimeout(forceExit);
          process.exit(0);
        })
        .catch((error: unknown) => {
          logger.error(`Shutdown failed: ${error instanceof Error ? error.message : 'unknown error'}`);
          clearTimeout(forceExit);
          process.exit(1);
        });
    });
  }
}

async function drain(params: { app: INestApplication; logger: NestLogger; signal: string }): Promise<void> {
  const { app, logger, signal } = params;

  logger.log(`${signal} received; starting graceful shutdown`);

  app.get(ShutdownStateService).beginDrain();
  await sleep(env.SHUTDOWN_DRAIN_DELAY_MS);

  // * Closes the HTTP server, then runs Nest's own destroy hooks: queue workers stop taking jobs and the
  // * database and Redis connections are released.
  await app.close();
  await shutdownTracing();

  logger.log('Graceful shutdown complete');
}

void bootstrap().catch((error) => {
  console.error('❌ Failed to bootstrap application', error);
  process.exit(1);
});
