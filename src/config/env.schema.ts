import { z } from 'zod';

import { KID_PATTERN, parseKeyring } from './keyring.util';

const booleanStringSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

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
    .transform((value, ctx): Record<string, string> => {
      const { keys, errors } = parseKeyring({ raw: value, validateValue });

      for (const message of errors) {
        ctx.addIssue({ code: 'custom', message });
      }

      return keys;
    });

const envObjectSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  APP_URL: z.url(),
  TRUST_PROXY: trustProxySchema,
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
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_BASE_URL: z.url().optional(),
  S3_FORCE_PATH_STYLE: booleanStringSchema.default(false),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  ACCOUNT_ERASURE_CRON: z.string().min(1).default('0 4 * * *'),

  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  SHUTDOWN_DRAIN_DELAY_MS: z.coerce.number().int().nonnegative().default(10000),
  // ! Must stay below the orchestrator's kill grace period, or the process is SIGKILLed mid-drain.
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

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

  DOCS_AUTH_USER: z.string().min(1).optional(),
  DOCS_AUTH_PASSWORD: z.string().min(24).optional(),

  SERVICE_RELEASE: z.string().min(1).default('unknown'),

  OTEL_ENABLED: booleanStringSchema.default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAME: z.string().min(1).default('app'),
  OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
  OTEL_DEBUG: booleanStringSchema.default(false),
});

export const ENV_KEYS = Object.keys(envObjectSchema.shape);

export const ENVSchema = envObjectSchema.superRefine((env, ctx) => {
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

  if (env.OTEL_ENABLED && !env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    ctx.addIssue({
      code: 'custom',
      path: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
      message: 'OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_ENABLED is true',
    });
  }

  const storageKeys = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const missingStorageKeys = storageKeys.filter((key) => env[key] === undefined);

  if (missingStorageKeys.length > 0 && missingStorageKeys.length < storageKeys.length) {
    for (const key of missingStorageKeys) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is required when any other S3_* variable is set`,
      });
    }
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
    if (env.TRUST_PROXY === true || typeof env.TRUST_PROXY === 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY must be an explicit CIDR/IP list (e.g. the load balancer subnet and Cloudflare ranges) in production, not "true" or a numeric hop count',
      });
    }
    if (env.MAIL_DRIVER !== 'resend') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_DRIVER'],
        message: 'MAIL_DRIVER must be resend in production',
      });
    }
  }
});
