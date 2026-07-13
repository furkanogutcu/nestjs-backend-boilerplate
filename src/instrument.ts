// * Must load before Sentry and any instrumented module so OTel patches them first.
import './infrastructure/observability/tracing';

import * as Sentry from '@sentry/nestjs';

import { env } from '@config/env.config';
import { SENSITIVE_HEADER_KEYS } from '@shared/constants/sensitive-headers.constant';

const SENSITIVE_HEADERS: string[] = [...SENSITIVE_HEADER_KEYS, 'set-cookie'];
const IGNORED_TRANSACTIONS = ['GET /health', 'GET /api/v1/health', 'GET /metrics', 'GET /api/v1/metrics'];

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE,
    sendDefaultPii: false,

    // * Sentry is error-tracking only; OpenTelemetry owns all tracing (-> Tempo).
    skipOpenTelemetrySetup: true,
    tracesSampleRate: 0,

    beforeSend(event) {
      if (event.request) {
        if (event.request.headers) {
          for (const key of Object.keys(event.request.headers)) {
            if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
              event.request.headers[key] = '[REDACTED]';
            }
          }
        }

        delete event.request.query_string;

        if (event.request.url) {
          event.request.url = event.request.url.split('?')[0];
        }
      }

      return event;
    },

    beforeSendTransaction(event) {
      if (IGNORED_TRANSACTIONS.includes(event.transaction ?? '')) {
        return null;
      }

      return event;
    },
  });
}
