import { ENVSchema } from './env.schema';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const HEX_UPPER = 'F'.repeat(64);

// * Validate ENVSchema directly — importing env.config would run process.exit on failure.
const baseEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  MAIL_FROM_NAME: 'App',
  MAIL_FROM: 'no-reply@app.test',
  ENCRYPTION_KEYS: `k1:${HEX_A}, k2:${HEX_B}`,
  ENCRYPTION_ACTIVE_KID: 'k1',
  JWT_ACCESS_KEYS: 'jwt-k1:test-jwt-access-key-one-0123456789abcdef',
  JWT_ACCESS_ACTIVE_KID: 'jwt-k1',
  REFRESH_TOKEN_PEPPER: 'test-refresh-token-pepper-0123456789abcdef',
  CSRF_HMAC_SECRET: 'test-csrf-hmac-secret-0123456789abcdef',
  GOOGLE_OAUTH_CLIENT_IDS: 'test-client.apps.googleusercontent.com',
  APPLE_OAUTH_CLIENT_IDS: 'com.app.test',
  GAME_CENTER_BUNDLE_IDS: 'com.app.test',
  PLAY_GAMES_OAUTH_CLIENT_ID: 'test-play-games-client.apps.googleusercontent.com',
  PLAY_GAMES_OAUTH_CLIENT_SECRET: 'test-play-games-client-secret',
};

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...baseEnv, ...overrides };
}

const productionRequired: Record<string, string> = {
  NODE_ENV: 'production',
  DOCS_AUTH_USER: 'admin',
  DOCS_AUTH_PASSWORD: 'metrics-auth-password-0123456789',
  DB_SSL: 'true',
  REDIS_URL: 'rediss://default:redis-pass-0123456789@localhost:6379',
  MAIL_DRIVER: 'resend',
  RESEND_API_KEY: 're_test_key',
  RESEND_WEBHOOK_SECRET: 'whsec_test',
};

function prodEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...baseEnv, ...productionRequired, ...overrides };
}

describe('ENVSchema', () => {
  it('parses a valid environment and applies defaults', () => {
    const result = ENVSchema.safeParse(baseEnv);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.TRUST_PROXY).toBe('loopback');
      expect(result.data.DB_POOL_MAX).toBe(10);
      expect(result.data.DB_SSL).toBe(false);
      expect(result.data.MAIL_DRIVER).toBe('log');
    }
  });

  it('defaults NODE_ENV to production when omitted', () => {
    const result = ENVSchema.safeParse(prodEnv({ NODE_ENV: undefined }));

    expect(result.success && result.data.NODE_ENV).toBe('production');
  });

  describe('field validation', () => {
    it.each([
      ['PORT below range', { PORT: '0' }],
      ['PORT above range', { PORT: '70000' }],
      ['invalid APP_URL', { APP_URL: 'not-a-url' }],
      ['non-postgres DATABASE_URL', { DATABASE_URL: 'mysql://localhost/db' }],
      ['non-redis REDIS_URL', { REDIS_URL: 'http://localhost:6379' }],
      ['invalid MAIL_FROM', { MAIL_FROM: 'not-an-email' }],
      ['invalid boolean DB_SSL', { DB_SSL: 'yes' }],
    ])('rejects %s', (_label, overrides) => {
      expect(ENVSchema.safeParse(envWith(overrides)).success).toBe(false);
    });

    it('coerces boolean strings', () => {
      const result = ENVSchema.safeParse(envWith({ DB_SSL: 'true' }));

      expect(result.success && result.data.DB_SSL).toBe(true);
    });

    it('rejects a docs password shorter than 24 characters', () => {
      expect(ENVSchema.safeParse(envWith({ DOCS_AUTH_PASSWORD: 'too-short' })).success).toBe(false);
    });

    it('accepts a docs password of at least 24 characters', () => {
      expect(ENVSchema.safeParse(envWith({ DOCS_AUTH_PASSWORD: 'a'.repeat(24) })).success).toBe(true);
    });

    it.each([
      ['boolean true', 'true', true],
      ['boolean false', 'false', false],
      ['numeric hop count', '2', 2],
      ['CIDR/keyword list', 'loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
    ])('normalizes TRUST_PROXY (%s)', (_label, input, expected) => {
      const result = ENVSchema.safeParse(envWith({ TRUST_PROXY: input }));

      expect(result.success && result.data.TRUST_PROXY).toEqual(expected);
    });
  });

  describe('HTTP timeout refinement', () => {
    it('applies default HTTP timeouts', () => {
      const result = ENVSchema.safeParse(baseEnv);

      expect(result.success && result.data.HTTP_KEEP_ALIVE_TIMEOUT_MS).toBe(65000);
      expect(result.success && result.data.HTTP_HEADERS_TIMEOUT_MS).toBe(75000);
      expect(result.success && result.data.HTTP_REQUEST_TIMEOUT_MS).toBe(80000);
      expect(result.success && result.data.HTTP_SOCKET_TIMEOUT_MS).toBe(0);
    });

    it('rejects when headers timeout is not greater than keep-alive timeout', () => {
      const result = ENVSchema.safeParse(
        envWith({ HTTP_KEEP_ALIVE_TIMEOUT_MS: '70000', HTTP_HEADERS_TIMEOUT_MS: '70000' }),
      );

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('HTTP_HEADERS_TIMEOUT_MS');
      }
    });

    it('rejects when request timeout is less than headers timeout', () => {
      const result = ENVSchema.safeParse(
        envWith({ HTTP_HEADERS_TIMEOUT_MS: '75000', HTTP_REQUEST_TIMEOUT_MS: '70000' }),
      );

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('HTTP_REQUEST_TIMEOUT_MS');
      }
    });

    it('accepts a valid custom timeout ladder', () => {
      const result = ENVSchema.safeParse(
        envWith({
          HTTP_KEEP_ALIVE_TIMEOUT_MS: '30000',
          HTTP_HEADERS_TIMEOUT_MS: '35000',
          HTTP_REQUEST_TIMEOUT_MS: '60000',
        }),
      );

      expect(result.success).toBe(true);
    });
  });

  describe('ENCRYPTION_KEYS parsing', () => {
    it.each<[string, string, Record<string, string>]>([
      ['single pair, no whitespace', `k1:${HEX_A}`, { k1: HEX_A }],
      ['two pairs, no whitespace', `k1:${HEX_A},k2:${HEX_B}`, { k1: HEX_A, k2: HEX_B }],
      ['two pairs with whitespace after commas', `k1:${HEX_A}, k2:${HEX_B}`, { k1: HEX_A, k2: HEX_B }],
      ['whitespace around kids and keys is trimmed', `  k1 : ${HEX_A}  ,  k2 : ${HEX_B}  `, { k1: HEX_A, k2: HEX_B }],
      ['three pairs', `k1:${HEX_A}, k2:${HEX_B}, k3:${HEX_C}`, { k1: HEX_A, k2: HEX_B, k3: HEX_C }],
      ['trailing comma is ignored', `k1:${HEX_A},`, { k1: HEX_A }],
      ['leading comma is ignored', `,k1:${HEX_A}`, { k1: HEX_A }],
      ['empty entries between commas are filtered', `k1:${HEX_A},,k2:${HEX_B},,,`, { k1: HEX_A, k2: HEX_B }],
      [
        'kids may contain hyphens and underscores',
        `key-2024:${HEX_A}, key_old:${HEX_B}`,
        { 'key-2024': HEX_A, key_old: HEX_B },
      ],
      ['kid is case-sensitive (k1 and K1 are distinct)', `k1:${HEX_A}, K1:${HEX_B}`, { k1: HEX_A, K1: HEX_B }],
      ['uppercase hex characters are accepted', `k1:${HEX_UPPER}`, { k1: HEX_UPPER }],
    ])('parses %s', (_label, input, expected) => {
      const result = ENVSchema.safeParse(
        envWith({ ENCRYPTION_KEYS: input, ENCRYPTION_ACTIVE_KID: Object.keys(expected)[0] }),
      );

      expect(result.success && result.data.ENCRYPTION_KEYS).toEqual(expected);
    });

    it('exposes the parsed ENCRYPTION_KEYS as a kid->hex record', () => {
      const result = ENVSchema.safeParse(baseEnv);

      expect(result.success && result.data.ENCRYPTION_KEYS).toEqual({ k1: HEX_A, k2: HEX_B });
      expect(result.success && result.data.ENCRYPTION_ACTIVE_KID).toBe('k1');
    });
  });

  describe('ENCRYPTION_KEYS rejection', () => {
    it.each<[string, string]>([
      ['empty string', ''],
      ['only whitespace and commas', '  , , ,  '],
      ['entry missing the colon separator', HEX_A],
      ['empty kid (":hex")', `:${HEX_A}`],
      ['empty key ("k1:")', 'k1:'],
      ['key one character too short', `k1:${'a'.repeat(63)}`],
      ['key one character too long', `k1:${'a'.repeat(65)}`],
      ['non-hex character in the key', `k1:${'z'.repeat(64)}`],
      ['kid contains an invalid character (!)', `k!:${HEX_A}`],
      ['kid contains a space', `k 1:${HEX_A}`],
      ['kid contains a dot', `k.1:${HEX_A}`],
      ['duplicate kid', `k1:${HEX_A}, k1:${HEX_B}`],
      ['one valid entry and one malformed entry → whole list rejected', `k1:${HEX_A}, k2:not-hex`],
    ])('rejects %s', (_label, input) => {
      const result = ENVSchema.safeParse(envWith({ ENCRYPTION_KEYS: input, ENCRYPTION_ACTIVE_KID: 'k1' }));

      expect(result.success).toBe(false);
    });

    it('rejects when ENCRYPTION_ACTIVE_KID is not present in ENCRYPTION_KEYS', () => {
      const result = ENVSchema.safeParse(envWith({ ENCRYPTION_ACTIVE_KID: 'missing' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('ENCRYPTION_ACTIVE_KID');
      }
    });
  });

  describe('JWT_ACCESS_KEYS keyring', () => {
    it('parses JWT_ACCESS_KEYS into a kid->secret record', () => {
      const secretA = 'a'.repeat(40);
      const secretB = 'b'.repeat(40);
      const result = ENVSchema.safeParse(
        envWith({ JWT_ACCESS_KEYS: `jwt-k1:${secretA}, jwt-k2:${secretB}`, JWT_ACCESS_ACTIVE_KID: 'jwt-k2' }),
      );

      expect(result.success && result.data.JWT_ACCESS_KEYS).toEqual({ 'jwt-k1': secretA, 'jwt-k2': secretB });
      expect(result.success && result.data.JWT_ACCESS_ACTIVE_KID).toBe('jwt-k2');
    });

    it('rejects a JWT signing secret shorter than 32 characters', () => {
      const result = ENVSchema.safeParse(envWith({ JWT_ACCESS_KEYS: `jwt-k1:${'s'.repeat(31)}` }));

      expect(result.success).toBe(false);
    });

    it('rejects when JWT_ACCESS_ACTIVE_KID is not present in JWT_ACCESS_KEYS', () => {
      const result = ENVSchema.safeParse(envWith({ JWT_ACCESS_ACTIVE_KID: 'missing' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('JWT_ACCESS_ACTIVE_KID');
      }
    });
  });

  describe('production auth refinement', () => {
    it('passes in production when all credentials and datastore TLS are provided', () => {
      const result = ENVSchema.safeParse(prodEnv());

      expect(result.success).toBe(true);
    });

    it('rejects a production REDIS_URL that carries no password (unauthenticated Redis)', () => {
      const result = ENVSchema.safeParse(prodEnv({ REDIS_URL: 'rediss://localhost:6379' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('REDIS_URL');
      }
    });

    it('rejects TRUST_PROXY="true" in production', () => {
      const result = ENVSchema.safeParse(prodEnv({ TRUST_PROXY: 'true' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('TRUST_PROXY');
      }
    });

    it.each([
      ['DB_SSL is not enabled', { DB_SSL: 'false' }, 'DB_SSL'],
      ['REDIS_URL does not use rediss://', { REDIS_URL: 'redis://localhost:6379' }, 'REDIS_URL'],
    ])('rejects when %s in production', (_label, overrides, expectedPath) => {
      const result = ENVSchema.safeParse(prodEnv(overrides));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(expectedPath);
      }
    });

    it('accepts production with no OAuth provider configured (every provider is opt-in)', () => {
      const result = ENVSchema.safeParse(
        prodEnv({
          GOOGLE_OAUTH_CLIENT_IDS: undefined,
          APPLE_OAUTH_CLIENT_IDS: undefined,
          GAME_CENTER_BUNDLE_IDS: undefined,
          PLAY_GAMES_OAUTH_CLIENT_ID: undefined,
          PLAY_GAMES_OAUTH_CLIENT_SECRET: undefined,
        }),
      );

      expect(result.success).toBe(true);
    });

    it('rejects a non-resend MAIL_DRIVER in production', () => {
      const result = ENVSchema.safeParse(prodEnv({ MAIL_DRIVER: 'log' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('MAIL_DRIVER');
      }
    });

    it('parses GOOGLE_OAUTH_CLIENT_IDS into a trimmed list', () => {
      const result = ENVSchema.safeParse(envWith({ GOOGLE_OAUTH_CLIENT_IDS: 'a.apps, b.apps ' }));

      expect(result.success && result.data.GOOGLE_OAUTH_CLIENT_IDS).toEqual(['a.apps', 'b.apps']);
    });

    it('rejects a numeric TRUST_PROXY hop count in production', () => {
      const result = ENVSchema.safeParse(prodEnv({ TRUST_PROXY: '1' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('TRUST_PROXY');
      }
    });

    it('accepts an explicit CIDR/IP list for TRUST_PROXY in production', () => {
      const result = ENVSchema.safeParse(prodEnv({ TRUST_PROXY: '10.0.0.0/8, 173.245.48.0/20' }));

      expect(result.success && result.data.TRUST_PROXY).toBe('10.0.0.0/8, 173.245.48.0/20');
    });
  });

  describe('OTEL exporter refinement', () => {
    it('requires an OTLP endpoint when tracing is enabled', () => {
      const result = ENVSchema.safeParse(envWith({ OTEL_ENABLED: 'true' }));

      expect(result.success).toBe(false);

      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));
        expect(paths).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
      }
    });

    it('passes when tracing is enabled together with an OTLP endpoint', () => {
      const result = ENVSchema.safeParse(
        envWith({ OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318' }),
      );

      expect(result.success).toBe(true);
    });
  });

  describe('mail driver refinement', () => {
    it.each([
      ['RESEND_API_KEY', 'RESEND_API_KEY'],
      ['RESEND_WEBHOOK_SECRET', 'RESEND_WEBHOOK_SECRET'],
    ])('requires %s when MAIL_DRIVER is resend', (key, expectedPath) => {
      const result = ENVSchema.safeParse(
        envWith({ MAIL_DRIVER: 'resend', RESEND_API_KEY: 're_k', RESEND_WEBHOOK_SECRET: 'whsec', [key]: undefined }),
      );

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(expectedPath);
      }
    });

    it('defaults MAIL_DRIVER to log and allows omitting Resend credentials outside production', () => {
      const result = ENVSchema.safeParse(baseEnv);

      expect(result.success && result.data.MAIL_DRIVER).toBe('log');
    });
  });
});
