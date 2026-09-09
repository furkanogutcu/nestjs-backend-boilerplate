import { versioningConfig } from '@config/app.config';

export const TOKEN_TYPE = 'Bearer';

export const REFRESH_SECRET_BYTES = 32;

export const REFRESH_TOKEN_SEPARATOR = '.';

export const CLIENT_TYPE_HEADER = 'x-client-type';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const CSRF_TOKEN_COOKIE = 'csrf_token';

export const CSRF_TOKEN_HEADER = 'x-csrf-token';

export const CSRF_TOKEN_BYTES = 32;

export const AUTH_COOKIE_PATH = `/${versioningConfig.prefix}${versioningConfig.defaultVersion}/auth`;

// ! Root-scoped and not HttpOnly on purpose: the SPA's JS must read it to echo it in the CSRF header.
export const CSRF_COOKIE_PATH = '/';
export const IDEMPOTENCY_GUEST_TTL_SECONDS = 120;

// * Safe to keep long: the fingerprint binds to the refresh token, so only its legitimate holder can replay.
export const IDEMPOTENCY_REFRESH_TTL_SECONDS = 24 * 60 * 60;

export const MAX_USER_AGENT_LENGTH = 512;

export const OAUTH_NONCE_BYTES = 16;

export const OAUTH_NONCE_TTL_SECONDS = 120;

export const EMAIL_VERIFICATION_TOKEN_BYTES = 32;

export const PASSWORD_RESET_TOKEN_BYTES = 32;

// ! The ceiling bounds argon2 cost per request: an unbounded password is a cheap DoS.
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_MIN_STRENGTH_SCORE = 3;

export const EMAIL_MAX_LENGTH = 254;

export const MAX_ACTIVE_FAMILIES_PER_USER = 10;

export const MAX_DISPLAY_NAME_LENGTH = 50;

// ! Pinned: an attacker-supplied publicKeyUrl would otherwise make cert fetching an SSRF primitive.
export const GAME_CENTER_PUBLIC_KEY_HOSTS = new Set(['static.gc.apple.com', 'sandbox.gc.apple.com']);

export const GAME_CENTER_FETCH_TIMEOUT_MS = 5 * 1000;

export const GAME_CENTER_CERT_CACHE_TTL_MS = 10 * 60 * 1000;

export const GAME_CENTER_CERT_CACHE_MAX_ENTRIES = 16;

export const GAME_CENTER_CERT_MAX_BYTES = 64 * 1024;

export const GAME_CENTER_TIMESTAMP_SKEW_SECONDS = 600;

// ! Must outlive the two-sided freshness window (2*skew), else a future-dated signature outlives its guard key.
export const GAME_CENTER_REPLAY_GUARD_TTL_SECONDS = 2 * GAME_CENTER_TIMESTAMP_SKEW_SECONDS;

export const GAME_CENTER_SUBJECT_ORGANIZATION = 'O=Apple Inc.';

// * Pinned DigiCert anchors under oauth/services/certs/ (rotation: runbook).
export const GAME_CENTER_INTERMEDIATE_CA_FILE = 'digicert-trusted-g4-code-signing-rsa4096-sha384-2021-ca1.pem';
export const GAME_CENTER_ROOT_CA_FILE = 'digicert-trusted-root-g4.pem';

export const PLAY_GAMES_PLAYER_URL = 'https://games.googleapis.com/games/v1/users/me';

export const PLAY_GAMES_FETCH_TIMEOUT_MS = 5 * 1000;

export const PLAY_GAMES_RESPONSE_MAX_BYTES = 64 * 1024;
