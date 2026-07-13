import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { CookieOptions, Request, Response } from 'express';

import { env } from '@config/env.config';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import {
  AUTH_COOKIE_PATH,
  CSRF_COOKIE_PATH,
  CSRF_TOKEN_BYTES,
  CSRF_TOKEN_COOKIE,
  CSRF_TOKEN_HEADER,
  REFRESH_TOKEN_COOKIE,
} from '../constants/auth.constant';

const CSRF_TOKEN_SIGNATURE_SEPARATOR = '.';

// * Secure cookies only travel over HTTPS; skip the flag outside production so localhost (http) still works.
function isSecure(): boolean {
  return env.NODE_ENV === 'production';
}

// * Issue (or rotate) the readable CSRF cookie the SPA echoes into the CSRF header (double-submit). Root-scoped and
// * not HttpOnly so browser JS can read it; the value is high-entropy, HMAC-signed and single-purpose. Standalone so
// * the CSRF bootstrap endpoint can hand a fresh token to a page that has not authenticated yet.
export function setCsrfCookie(params: { response: Response }): void {
  params.response.cookie(CSRF_TOKEN_COOKIE, issueCsrfToken(), {
    secure: isSecure(),
    sameSite: 'strict',
    path: CSRF_COOKIE_PATH,
    httpOnly: false,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

// * Issue the web refresh transport: the token as an HttpOnly, auth-path-scoped cookie (JS-invisible, sent only to
// * auth routes) plus a fresh root-scoped CSRF cookie. Both SameSite=Strict, expiring with the refresh token.
export function setAuthCookies(params: { response: Response; refreshToken: string }): void {
  params.response.cookie(REFRESH_TOKEN_COOKIE, params.refreshToken, {
    secure: isSecure(),
    sameSite: 'strict',
    path: AUTH_COOKIE_PATH,
    httpOnly: true,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
  setCsrfCookie({ response: params.response });
}

export function clearAuthCookies(params: { response: Response }): void {
  const base: Pick<CookieOptions, 'secure' | 'sameSite'> = { secure: isSecure(), sameSite: 'strict' };

  params.response.clearCookie(REFRESH_TOKEN_COOKIE, { ...base, path: AUTH_COOKIE_PATH });
  params.response.clearCookie(CSRF_TOKEN_COOKIE, { ...base, path: CSRF_COOKIE_PATH });
}

// * Resolve the presented refresh token by transport: a refresh cookie means a web client, and because that cookie
// * is ambient it MUST clear the double-submit CSRF check; otherwise fall back to the request body (mobile). Missing
// * from both is an invalid request.
export function resolveRefreshToken(params: { request: Request; bodyToken?: string }): string {
  const cookieToken = params.request.cookies?.[REFRESH_TOKEN_COOKIE] as string | undefined;

  if (cookieToken) {
    assertCsrf({ request: params.request });

    return cookieToken;
  }

  if (params.bodyToken) {
    return params.bodyToken;
  }

  throw new AppUnauthorizedException({
    code: ExceptionCode.InvalidRefreshToken,
    message: 'Refresh token is missing.',
  });
}

// * Signed double-submit CSRF: the CSRF cookie (only same-origin JS can read it) must equal the CSRF header the
// * client copies into it, AND the cookie value must carry a valid server HMAC. The equality check stops a
// * cross-site forgery that cannot read the cookie; the signature stops a sibling-subdomain cookie-injection where
// * the attacker controls the value it writes — it cannot forge the HMAC without the secret. Constant-time compares
// * avoid leaking match progress.
function assertCsrf(params: { request: Request }): void {
  const cookieToken = params.request.cookies?.[CSRF_TOKEN_COOKIE] as string | undefined;
  const header = params.request.headers[CSRF_TOKEN_HEADER];
  const headerToken = Array.isArray(header) ? header[0] : header;

  if (
    !cookieToken ||
    !headerToken ||
    !constantTimeEqual({ a: cookieToken, b: headerToken }) ||
    !hasValidCsrfSignature(cookieToken)
  ) {
    throw new AppForbiddenException({ code: ExceptionCode.CsrfTokenInvalid, message: 'CSRF validation failed.' });
  }
}

// * A CSRF token is `<random>.<hmac>`: a high-entropy value plus its HMAC-SHA256 under CSRF_HMAC_SECRET. base64url
// * never contains '.', so the last separator cleanly splits value from signature.
function issueCsrfToken(): string {
  const value = randomBytes(CSRF_TOKEN_BYTES).toString('base64url');

  return `${value}${CSRF_TOKEN_SIGNATURE_SEPARATOR}${signCsrfValue(value)}`;
}

function signCsrfValue(value: string): string {
  return createHmac('sha256', env.CSRF_HMAC_SECRET).update(value).digest('base64url');
}

function hasValidCsrfSignature(token: string): boolean {
  const separatorIndex = token.lastIndexOf(CSRF_TOKEN_SIGNATURE_SEPARATOR);

  if (separatorIndex <= 0) {
    return false;
  }

  const value = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);

  return constantTimeEqual({ a: signature, b: signCsrfValue(value) });
}

function constantTimeEqual({ a, b }: { a: string; b: string }): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
