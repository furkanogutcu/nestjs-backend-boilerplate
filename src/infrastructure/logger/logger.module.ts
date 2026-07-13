import { Module } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { env } from '@config/env.config';
import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';
import { SENSITIVE_HEADER_KEYS } from '@shared/constants/sensitive-headers.constant';

const isDevMode = env.NODE_ENV === 'development';

const IGNORED_LOG_PATHS = ['/health', '/metrics', '/api/v1/health', '/api/v1/metrics'];

const REQUEST_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL ?? (isDevMode ? 'debug' : 'info'),
        transport: isDevMode ? { target: 'pino-pretty' } : undefined,
        redact: [
          ...SENSITIVE_HEADER_KEYS.map((key) => `req.headers["${key}"]`),
          'res.headers["set-cookie"]',
          'req.body.refresh_token',
          'req.body.idempotency_key',
          'req.body.id_token',
          'req.body.nonce',
          'req.body.server_auth_code',
        ],
        autoLogging: {
          ignore: (req) => IGNORED_LOG_PATHS.some((path) => (req.url ?? '').startsWith(path)),
        },
        mixin: () => getCurrentTraceIds() ?? {},
        // eslint-disable-next-line no-restricted-syntax -- pino-http genReqId callback signature is fixed (req, res)
        genReqId: (req, res) => {
          const header = req.headers['x-request-id'];
          const incoming = Array.isArray(header) ? header[0] : header;
          const requestId = incoming && REQUEST_ID_REGEX.test(incoming) ? incoming : randomUUID();

          res.setHeader('X-Request-Id', requestId);

          return requestId;
        },
      },
    }),
  ],
})
export class LoggerModule {}
