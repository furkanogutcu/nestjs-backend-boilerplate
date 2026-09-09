// ! Must load first: env.config validates and exits at import, so a valid env has to exist before any source module.
const DOC_GEN_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  PORT: '4000',
  APP_URL: 'http://localhost:4000',
  DATABASE_URL: 'postgres://docs:docs@localhost:5432/app_docs',
  REDIS_URL: 'redis://localhost:6379',
  MAIL_FROM_NAME: 'App',
  MAIL_FROM: 'no-reply@app.local',
  ENCRYPTION_KEYS: 'k1:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  ENCRYPTION_ACTIVE_KID: 'k1',
  JWT_ACCESS_KEYS: 'jwt-k1:doc-gen-jwt-access-signing-key-0123456789abcdef',
  JWT_ACCESS_ACTIVE_KID: 'jwt-k1',
  REFRESH_TOKEN_PEPPER: 'doc-gen-refresh-token-pepper-0123456789abcdef',
  CSRF_HMAC_SECRET: 'doc-gen-csrf-hmac-secret-0123456789abcdef',
  KAFKA_BROKERS: 'localhost:9092',
};

for (const [key, value] of Object.entries(DOC_GEN_ENV)) {
  process.env[key] ??= value;
}
