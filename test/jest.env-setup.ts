// * env.config validates process.env at import and exits on failure; this setupFiles entry provides a valid env before any source module loads.
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  APP_URL: 'http://localhost:3000',
  TRUST_PROXY: 'loopback',

  DATABASE_URL: 'postgres://test:test@localhost:5432/app_test',
  REDIS_URL: 'redis://localhost:6379',

  MAIL_FROM_NAME: 'App',
  MAIL_FROM: 'no-reply@app.test',

  ENCRYPTION_KEYS: 'k1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  ENCRYPTION_ACTIVE_KID: 'k1',

  JWT_ACCESS_KEYS: 'jwt-k1:test-jwt-access-key-one-0123456789abcdef,jwt-k2:test-jwt-access-key-two-0123456789abcdef',
  JWT_ACCESS_ACTIVE_KID: 'jwt-k1',
  REFRESH_TOKEN_PEPPER: 'test-refresh-token-pepper-0123456789abcdef',
  CSRF_HMAC_SECRET: 'test-csrf-hmac-secret-0123456789abcdef',
  GOOGLE_OAUTH_CLIENT_IDS: 'test-client.apps.googleusercontent.com',
  APPLE_OAUTH_CLIENT_IDS: 'com.app.test',
  GAME_CENTER_BUNDLE_IDS: 'com.app.test',
  PLAY_GAMES_OAUTH_CLIENT_ID: 'test-play-games-client.apps.googleusercontent.com',
  PLAY_GAMES_OAUTH_CLIENT_SECRET: 'test-play-games-client-secret',

  // * Configured so the credential-gated /metrics and docs basic-auth is exercised by e2e specs.
  DOCS_AUTH_USER: 'metrics',
  DOCS_AUTH_PASSWORD: 'metrics-auth-password-0123456789',
};

for (const [key, value] of Object.entries(testEnv)) {
  // * `??=` lets the shell/CI override values (e.g. integration containers).
  process.env[key] ??= value;
}
