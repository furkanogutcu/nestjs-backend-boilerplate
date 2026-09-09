import { VersioningType } from '@nestjs/common';

const namespace = 'app';
const separator = ':';

export const versioningConfig = {
  type: VersioningType.URI,
  defaultVersion: '1',
  prefix: 'api/v',
} as const;

export const appConfig = {
  name: 'NestJS Backend Boilerplate',
  slug: namespace,
  redis: {
    separator,
    keyPrefixes: {
      cache: `${namespace}${separator}cache`,
      rateLimit: `${namespace}${separator}rate-limit`,
      bull: `${namespace}${separator}bull`,
      revocation: `${namespace}${separator}revocation`,
      idempotency: `${namespace}${separator}idempotency`,
      oauthNonce: `${namespace}${separator}oauth-nonce`,
      oauthSigninNonce: `${namespace}${separator}oauth-signin-nonce`,
      emailVerification: `${namespace}${separator}email-verification`,
      passwordReset: `${namespace}${separator}password-reset`,
      gameCenterReplay: `${namespace}${separator}game-center-replay`,
      mailWebhookInbox: `${namespace}${separator}mail-webhook-inbox`,
    },
  },
  cache: {
    defaultTtl: 3600,
  },
} as const;
