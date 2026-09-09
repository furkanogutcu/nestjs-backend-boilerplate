import { createMock } from '@golevelup/ts-vitest';
import type { Request, Response } from 'express';

import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import {
  AUTH_COOKIE_PATH,
  CSRF_COOKIE_PATH,
  CSRF_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../constants/auth.constant';
import { clearAuthCookies, resolveRefreshToken, setAuthCookies, setCsrfCookie } from './auth-cookie.util';

describe('auth cookie util', () => {
  describe('setAuthCookies', () => {
    it('sets an HttpOnly auth-path refresh cookie and a readable root-path CSRF cookie', () => {
      const response = createMock<Response>();

      setAuthCookies({ response, refreshToken: 'rt' });

      expect(response.cookie).toHaveBeenCalledWith(
        REFRESH_TOKEN_COOKIE,
        'rt',
        expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: AUTH_COOKIE_PATH }),
      );
      expect(response.cookie).toHaveBeenCalledWith(
        CSRF_TOKEN_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: false, sameSite: 'strict', path: CSRF_COOKIE_PATH }),
      );
    });
  });

  describe('setCsrfCookie', () => {
    it('sets only the readable root-path CSRF cookie (no refresh cookie)', () => {
      const response = createMock<Response>();

      setCsrfCookie({ response });

      expect(response.cookie).toHaveBeenCalledTimes(1);
      expect(response.cookie).toHaveBeenCalledWith(
        CSRF_TOKEN_COOKIE,
        expect.any(String),
        expect.objectContaining({ httpOnly: false, path: CSRF_COOKIE_PATH }),
      );
    });
  });

  describe('clearAuthCookies', () => {
    it('clears both the refresh and CSRF cookies', () => {
      const response = createMock<Response>();

      clearAuthCookies({ response });

      expect(response.clearCookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, expect.any(Object));
      expect(response.clearCookie).toHaveBeenCalledWith(CSRF_TOKEN_COOKIE, expect.any(Object));
    });
  });

  describe('resolveRefreshToken', () => {
    const request = ({
      cookies,
      headers = {},
    }: {
      cookies: Record<string, string>;
      headers?: Record<string, unknown>;
    }): Request => ({ cookies, headers }) as unknown as Request;

    const issueSignedCsrf = (): string => {
      const response = createMock<Response>();

      setCsrfCookie({ response });

      return response.cookie.mock.calls[0][1] as string;
    };

    it('returns the body token for a mobile request (no refresh cookie)', () => {
      expect(resolveRefreshToken({ request: request({ cookies: {} }), bodyToken: 'body-rt' })).toBe('body-rt');
    });

    it('returns the cookie token when the CSRF header matches a validly signed CSRF cookie (double-submit)', () => {
      const csrf = issueSignedCsrf();
      const req = request({
        cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-rt', [CSRF_TOKEN_COOKIE]: csrf },
        headers: { 'x-csrf-token': csrf },
      });

      expect(resolveRefreshToken({ request: req })).toBe('cookie-rt');
    });

    it('rejects a cookie request whose CSRF header does not match', () => {
      const req = request({
        cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-rt', [CSRF_TOKEN_COOKIE]: issueSignedCsrf() },
        headers: { 'x-csrf-token': 'nope-2' },
      });

      expect(() => resolveRefreshToken({ request: req })).toThrow(AppForbiddenException);
    });

    it('rejects a cookie request that sends no CSRF header', () => {
      const req = request({ cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-rt', [CSRF_TOKEN_COOKIE]: issueSignedCsrf() } });

      expect(() => resolveRefreshToken({ request: req })).toThrow(AppForbiddenException);
    });

    it('rejects a matching cookie+header whose HMAC signature is tampered', () => {
      const signed = issueSignedCsrf();
      const tampered = signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A');
      const req = request({
        cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-rt', [CSRF_TOKEN_COOKIE]: tampered },
        headers: { 'x-csrf-token': tampered },
      });

      expect(() => resolveRefreshToken({ request: req })).toThrow(AppForbiddenException);
    });

    it('rejects a matching cookie+header that carries no signature (legacy/unsigned token)', () => {
      const req = request({
        cookies: { [REFRESH_TOKEN_COOKIE]: 'cookie-rt', [CSRF_TOKEN_COOKIE]: 'csrf-1' },
        headers: { 'x-csrf-token': 'csrf-1' },
      });

      expect(() => resolveRefreshToken({ request: req })).toThrow(AppForbiddenException);
    });

    it('rejects when neither the cookie nor the body carries a token', () => {
      expect(() => resolveRefreshToken({ request: request({ cookies: {} }) })).toThrow(AppUnauthorizedException);
    });
  });
});
