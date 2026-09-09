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

function isSecure(): boolean {
  return env.NODE_ENV === 'production';
}

export function setCsrfCookie(params: { response: Response }): void {
  params.response.cookie(CSRF_TOKEN_COOKIE, issueCsrfToken(), {
    secure: isSecure(),
    sameSite: 'strict',
    path: CSRF_COOKIE_PATH,
    httpOnly: false,
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

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

// ! A cookie-borne token is ambient, so it MUST clear the double-submit CSRF check; a body token is not.
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

// ! Equality alone is not enough: the HMAC is what stops a sibling-subdomain cookie injection.
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

// * base64url never contains '.', so the separator splits value from signature unambiguously.
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
