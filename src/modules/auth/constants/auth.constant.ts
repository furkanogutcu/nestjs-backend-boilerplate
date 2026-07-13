import { versioningConfig } from '@config/app.config';

export const TOKEN_TYPE = 'Bearer';

export const REFRESH_SECRET_BYTES = 32;

export const REFRESH_TOKEN_SEPARATOR = '.';

// * Web clients declare themselves with this header so the auth layer switches the refresh token to cookie transport
// * (+ CSRF). Absent or any other value → mobile (Bearer/body), keeping native clients backward-compatible.
export const CLIENT_TYPE_HEADER = 'x-client-type';

// * Web refresh-token transport. The refresh cookie is HttpOnly (JS-invisible); the CSRF cookie is readable so the
// * SPA can echo it in the CSRF header (double-submit). Both are SameSite=Strict + path-scoped to the auth routes.
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const CSRF_TOKEN_COOKIE = 'csrf_token';

export const CSRF_TOKEN_HEADER = 'x-csrf-token';

export const CSRF_TOKEN_BYTES = 32;

// * The HttpOnly refresh cookie is scoped to the auth routes only, so it is never sent on unrelated requests.
// * Derived from the versioning config to track the API prefix (e.g. /api/v1/auth) without drift.
export const AUTH_COOKIE_PATH = `/${versioningConfig.prefix}${versioningConfig.defaultVersion}/auth`;

// * The CSRF cookie must be root-scoped: the SPA's JS (running at the app root) reads it via document.cookie to echo
// * it in the CSRF header, and a path-scoped cookie would be invisible there. It is not HttpOnly for the same reason.
export const CSRF_COOKIE_PATH = '/';

// * Short window: a guest response caches a token pair under an unauthenticated, client-chosen key, so the replay window stays small to bound the token-leak surface.
export const IDEMPOTENCY_GUEST_TTL_SECONDS = 120;

// * Long window: the refresh fingerprint binds to the refresh token itself, so only the legitimate holder can replay; a wide window lets a slow/offline retry recover its response without tripping reuse detection.
export const IDEMPOTENCY_REFRESH_TTL_SECONDS = 24 * 60 * 60;

export const MAX_USER_AGENT_LENGTH = 512;

export const OAUTH_NONCE_BYTES = 16;

export const OAUTH_NONCE_TTL_SECONDS = 120;

// * Single-use email-verification / password-reset tokens: 32 bytes of CSPRNG entropy (base64url), stored in Redis
// * mapping token → userId and consumed atomically (GETDEL) so a link works exactly once.
export const EMAIL_VERIFICATION_TOKEN_BYTES = 32;

export const PASSWORD_RESET_TOKEN_BYTES = 32;

// * Password length bounds. The floor keeps a minimum entropy; the ceiling bounds the argon2 hashing cost per
// * request (a multi-megabyte password is a cheap DoS otherwise).
export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_MAX_LENGTH = 128;

// * Minimum zxcvbn strength score (0-4) accepted on registration / password reset. 3 = "safely unguessable
// * (moderate protection from offline slow-hash scenarios)"; login is never gated so pre-existing weak passwords
// * keep working.
export const PASSWORD_MIN_STRENGTH_SCORE = 3;

// * RFC 5321 caps an email address at 254 characters; bound the input so an oversized string can neither bloat a
// * row nor become a cheap request-body DoS.
export const EMAIL_MAX_LENGTH = 254;

export const MAX_ACTIVE_FAMILIES_PER_USER = 10;

// * Kafka consumer-group id for the durable revocation-denylist reconcile. Distinct from the realtime fanout group so
// * both consume every SessionRevoked event: the realtime bridge kicks sockets, this rewrites the denylist key.
export const REVOCATION_RECONCILE_CONSUMER_GROUP = 'auth-revocation-reconcile';

export const MAX_DISPLAY_NAME_LENGTH = 50;

// * Pin the exact Apple host(s) so a tampered publicKeyUrl cannot turn cert fetching into an SSRF primitive against the wider apple.com surface (static = production, sandbox = Apple sandbox).
export const GAME_CENTER_PUBLIC_KEY_HOSTS = new Set(['static.gc.apple.com', 'sandbox.gc.apple.com']);

export const GAME_CENTER_FETCH_TIMEOUT_MS = 5 * 1000;

export const GAME_CENTER_CERT_CACHE_TTL_MS = 10 * 60 * 1000;

export const GAME_CENTER_CERT_CACHE_MAX_ENTRIES = 16;

// * Cap the fetched leaf-cert body (a DER cert is a few KB) so a compromised-but-pinned host cannot stream an oversized body into memory. Defense-in-depth behind the host allowlist + fetch timeout.
export const GAME_CENTER_CERT_MAX_BYTES = 64 * 1024;

// * Reject signatures whose timestamp drifts beyond this window (replay freshness).
export const GAME_CENTER_TIMESTAMP_SKEW_SECONDS = 600;

// * Replay-guard lifetime. The freshness check is two-sided (|drift| <= skew), so a captured signature is acceptable across a 2*skew window; the guard must outlive that whole window, else a future-dated signature could be replayed after its key expired while still "fresh".
export const GAME_CENTER_REPLAY_GUARD_TTL_SECONDS = 2 * GAME_CENTER_TIMESTAMP_SKEW_SECONDS;

// * The pinned leaf is an Apple code-signing cert; its subject organization (RDN line from X509Certificate.subject) must be exactly this.
export const GAME_CENTER_SUBJECT_ORGANIZATION = 'O=Apple Inc.';

// * Pinned DigiCert trust anchors shipped as PEM assets under oauth/services/certs/ (rotation: runbook).
export const GAME_CENTER_INTERMEDIATE_CA_FILE = 'digicert-trusted-g4-code-signing-rsa4096-sha384-2021-ca1.pem';
export const GAME_CENTER_ROOT_CA_FILE = 'digicert-trusted-root-g4.pem';

export const PLAY_GAMES_PLAYER_URL = 'https://games.googleapis.com/games/v1/users/me';

export const PLAY_GAMES_FETCH_TIMEOUT_MS = 5 * 1000;

// * Cap the Play Games user-profile response (a small JSON object) before parsing. Defense-in-depth behind the pinned Google endpoint + fetch timeout.
export const PLAY_GAMES_RESPONSE_MAX_BYTES = 64 * 1024;
