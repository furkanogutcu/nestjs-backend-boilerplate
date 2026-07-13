import { z } from 'zod';

import { KID_PATTERN, parseKeyring } from './keyring.util';

const booleanStringSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const brokerSchema = z.string().regex(/^[^\s:,]+:\d{1,5}$/, 'must be in host:port format');

const trustProxySchema = z
  .string()
  .default('loopback')
  .transform((value): boolean | number | string => {
    const trimmed = value.trim();

    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);

    return trimmed;
  });

const kidSchema = z.string().regex(KID_PATTERN, 'must be alphanumeric (with - or _)');

const redisUrlPassword = (url: string): string => {
  try {
    return new URL(url).password;
  } catch {
    return '';
  }
};

const validateHexKey = (value: string): string | null =>
  /^[0-9a-fA-F]{64}$/.test(value) ? null : 'must be a 64-character hex string (32 bytes)';

const validateJwtSecret = (value: string): string | null =>
  value.length >= 32 ? null : 'must be at least 32 characters';

const keyringSchema = (validateValue: (value: string) => string | null): z.ZodType<Record<string, string>> =>
  z
    .string()
    .min(1)
    // eslint-disable-next-line no-restricted-syntax -- Zod .transform/.superRefine callback signature is fixed (value, ctx)
    .transform((value, ctx): Record<string, string> => {
      const { keys, errors } = parseKeyring({ raw: value, validateValue });

      for (const message of errors) {
        ctx.addIssue({ code: 'custom', message });
      }

      return keys;
    });

export const ENVSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535),
    NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
    // * Public base URL of the application's web front-end (the origin users reach in a browser). Emailed
    // * verification & password-reset links point here — the page reads the token from the query and calls the API.
    APP_URL: z.url(),
    TRUST_PROXY: trustProxySchema,
    // * Cross-origin browsers allowed to call the API with credentials (cookies). Comma-separated scheme+host
    // * origins; empty means same-origin/native-only, so CORS stays off. Required for a cross-origin web SPA that
    // * relies on the refresh cookie.
    CORS_ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
          : [],
      ),

    HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(65000),
    HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(75000),
    HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(80000),
    HTTP_SOCKET_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),

    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres connection URI'),
    MIGRATION_DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres connection URI')
      .optional(),
    DB_POOL_MAX: z.coerce.number().int().positive().default(10),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10000),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30000),
    DB_SSL: booleanStringSchema.default(false),

    REDIS_URL: z.string().regex(/^rediss?:\/\/.+/, 'must be a redis connection URI'),
    REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

    MAIL_DRIVER: z.enum(['resend', 'log']).default('log'),
    MAIL_FROM_NAME: z.string().min(1),
    MAIL_FROM: z.email(),
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),

    REALTIME_DRIVER: z.enum(['socketio', 'log', 'off']).default('log'),
    REALTIME_CORS_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((origin) => origin.trim())
              .filter(Boolean)
          : [],
      )
      .refine((origins) => origins.every((origin) => /^https?:\/\/[^\s/]+$/.test(origin)), {
        message:
          'Each entry must be a scheme + host origin (e.g. https://app.example.com) — no path, no trailing slash',
      }),

    ENCRYPTION_KEYS: keyringSchema(validateHexKey),
    ENCRYPTION_ACTIVE_KID: kidSchema,

    JWT_ACCESS_KEYS: keyringSchema(validateJwtSecret),
    JWT_ACCESS_ACTIVE_KID: kidSchema,
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    JWT_ISSUER: z.string().min(1).default('app'),
    JWT_AUDIENCE: z.string().min(1).default('app'),

    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
    REFRESH_TOKEN_HARD_CAP_SECONDS: z.coerce.number().int().positive().default(7776000),
    REFRESH_TOKEN_PEPPER: z.string().min(32),

    CSRF_HMAC_SECRET: z.string().min(32),

    GOOGLE_OAUTH_CLIENT_IDS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      ),

    APPLE_OAUTH_CLIENT_IDS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      ),
    APPLE_OAUTH_ISSUER: z.string().min(1).default('https://appleid.apple.com'),

    GAME_CENTER_BUNDLE_IDS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ? value
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      ),

    PLAY_GAMES_OAUTH_CLIENT_ID: z.string().optional(),
    PLAY_GAMES_OAUTH_CLIENT_SECRET: z.string().optional(),

    SIGNIN_NONCE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

    EMAIL_VERIFICATION_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

    KAFKA_BROKERS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((broker) => broker.trim())
          .filter(Boolean),
      )
      .pipe(brokerSchema.array().min(1)),
    KAFKA_SSL: booleanStringSchema.default(false),
    KAFKA_SASL_MECHANISM: z.enum(['plain', 'scram-sha-256', 'scram-sha-512']).optional(),
    KAFKA_SASL_USERNAME: z.string().min(1).optional(),
    KAFKA_SASL_PASSWORD: z.string().min(1).optional(),

    KAFKA_TOPIC_PARTITIONS: z.coerce.number().int().positive().default(3),
    KAFKA_TOPIC_REPLICATION_FACTOR: z.coerce.number().int().positive().default(1),
    KAFKA_RETRY_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60 * 60 * 1000),
    KAFKA_DLQ_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(14 * 24 * 60 * 60 * 1000),

    KAFKA_OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
    KAFKA_OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(100),
    KAFKA_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    KAFKA_OUTBOX_BACKOFF_MS: z.coerce.number().int().positive().default(5000),
    KAFKA_OUTBOX_BACKOFF_MAX_MS: z.coerce.number().int().positive().default(300000),
    KAFKA_OUTBOX_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60 * 60 * 1000),
    KAFKA_OUTBOX_PRUNE_CRON: z.string().min(1).default('0 3 * * *'),
    KAFKA_INBOX_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60 * 60 * 1000),
    KAFKA_INBOX_PRUNE_CRON: z.string().min(1).default('0 4 * * *'),

    SENTRY_DSN: z.url().optional(),
    SENTRY_RELEASE: z.string().min(1).optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

    OTEL_ENABLED: booleanStringSchema.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('app'),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
    OTEL_DEBUG: booleanStringSchema.default(false),

    METRICS_AUTH_USER: z.string().min(1).optional(),
    METRICS_AUTH_PASSWORD: z.string().min(24).optional(),
  })
  // eslint-disable-next-line no-restricted-syntax -- Zod .transform/.superRefine callback signature is fixed (value, ctx)
  .superRefine((env, ctx) => {
    if (env.ENCRYPTION_KEYS && !(env.ENCRYPTION_ACTIVE_KID in env.ENCRYPTION_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_ACTIVE_KID'],
        message: 'ENCRYPTION_ACTIVE_KID must match a key id defined in ENCRYPTION_KEYS',
      });
    }

    if (env.JWT_ACCESS_KEYS && !(env.JWT_ACCESS_ACTIVE_KID in env.JWT_ACCESS_KEYS)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_ACTIVE_KID'],
        message: 'JWT_ACCESS_ACTIVE_KID must match a key id defined in JWT_ACCESS_KEYS',
      });
    }

    if (env.HTTP_HEADERS_TIMEOUT_MS <= env.HTTP_KEEP_ALIVE_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'HTTP_HEADERS_TIMEOUT_MS must be greater than HTTP_KEEP_ALIVE_TIMEOUT_MS',
      });
    }

    if (env.HTTP_REQUEST_TIMEOUT_MS < env.HTTP_HEADERS_TIMEOUT_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['HTTP_REQUEST_TIMEOUT_MS'],
        message: 'HTTP_REQUEST_TIMEOUT_MS must be greater than or equal to HTTP_HEADERS_TIMEOUT_MS',
      });
    }

    if (env.KAFKA_SASL_MECHANISM) {
      if (!env.KAFKA_SASL_USERNAME) {
        ctx.addIssue({
          code: 'custom',
          path: ['KAFKA_SASL_USERNAME'],
          message: 'KAFKA_SASL_USERNAME is required when KAFKA_SASL_MECHANISM is set',
        });
      }
      if (!env.KAFKA_SASL_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['KAFKA_SASL_PASSWORD'],
          message: 'KAFKA_SASL_PASSWORD is required when KAFKA_SASL_MECHANISM is set',
        });
      }
    }

    if (env.OTEL_ENABLED && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
        message: 'OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED is true',
      });
    }

    if (env.MAIL_DRIVER === 'resend') {
      if (!env.RESEND_API_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['RESEND_API_KEY'],
          message: 'RESEND_API_KEY is required when MAIL_DRIVER is resend',
        });
      }
      if (!env.RESEND_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['RESEND_WEBHOOK_SECRET'],
          message: 'RESEND_WEBHOOK_SECRET is required when MAIL_DRIVER is resend',
        });
      }
    }

    if (env.NODE_ENV === 'production') {
      if (!env.DB_SSL) {
        ctx.addIssue({
          code: 'custom',
          path: ['DB_SSL'],
          message: 'DB_SSL must be true in production (encryption in transit)',
        });
      }
      if (!env.KAFKA_SSL) {
        ctx.addIssue({
          code: 'custom',
          path: ['KAFKA_SSL'],
          message: 'KAFKA_SSL must be true in production (encryption in transit)',
        });
      }
      if (!env.KAFKA_SASL_MECHANISM) {
        ctx.addIssue({
          code: 'custom',
          path: ['KAFKA_SASL_MECHANISM'],
          message: 'KAFKA_SASL_MECHANISM is required in production (unauthenticated brokers are not allowed)',
        });
      }
      if (!env.REDIS_URL.startsWith('rediss://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'REDIS_URL must use the rediss:// (TLS) scheme in production',
        });
      }
      if (!redisUrlPassword(env.REDIS_URL)) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: 'REDIS_URL must include a password in production (unauthenticated Redis is not allowed)',
        });
      }
      // * OAuth providers (Google / Apple / Game Center / Play Games) are opt-in: configure only the ones you use.
      // * Each verifier fails closed at request time when its config is absent, so an unconfigured provider simply
      // * rejects sign-in rather than blocking boot — a web-only or email/password-only deployment needs none of them.
      if (env.TRUST_PROXY === true || typeof env.TRUST_PROXY === 'number') {
        ctx.addIssue({
          code: 'custom',
          path: ['TRUST_PROXY'],
          message:
            'TRUST_PROXY must be an explicit CIDR/IP list (e.g. the load balancer subnet and Cloudflare ranges) in production, not "true" or a numeric hop count',
        });
      }
      if (!env.METRICS_AUTH_USER) {
        ctx.addIssue({
          code: 'custom',
          path: ['METRICS_AUTH_USER'],
          message: 'METRICS_AUTH_USER is required in production',
        });
      }
      if (!env.METRICS_AUTH_PASSWORD) {
        ctx.addIssue({
          code: 'custom',
          path: ['METRICS_AUTH_PASSWORD'],
          message: 'METRICS_AUTH_PASSWORD is required in production',
        });
      }
      if (env.MAIL_DRIVER !== 'resend') {
        ctx.addIssue({
          code: 'custom',
          path: ['MAIL_DRIVER'],
          message: 'MAIL_DRIVER must be resend in production',
        });
      }
      if (env.REALTIME_DRIVER !== 'socketio') {
        ctx.addIssue({
          code: 'custom',
          path: ['REALTIME_DRIVER'],
          message: 'REALTIME_DRIVER must be socketio in production (the log driver pushes nothing)',
        });
      }
    }
  });
