import { createMock, DeepMocked } from '@golevelup/ts-jest';
import type { Request, Response } from 'express';

import { AuthController } from './auth.controller';
import { User } from './entities/user.entity';
import { AuthService } from './services/auth.service';

describe('AuthController', () => {
  let authService: DeepMocked<AuthService>;
  let controller: AuthController;

  beforeEach(() => {
    authService = createMock<AuthService>();
    controller = new AuthController(authService);
  });

  describe('csrf', () => {
    it('sets the readable CSRF cookie', () => {
      const response = createMock<Response>();

      controller.csrf(response);

      expect(response.cookie).toHaveBeenCalledWith('csrf_token', expect.any(String), expect.any(Object));
    });
  });

  describe('createGuest', () => {
    it('creates a guest and maps the token pair and user to the wire contract', async () => {
      authService.createGuest.mockResolvedValue({
        user: createMock<User>({ id: 'user-1', isAnonymous: true }),
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresInSeconds: 900,
      });

      const result = await controller.createGuest({ userAgent: 'jest', idempotencyKey: undefined });

      expect(authService.createGuest).toHaveBeenCalledWith({ userAgent: 'jest' });
      expect(result).toEqual({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 900,
        user: { id: 'user-1', is_anonymous: true },
      });
    });
  });

  describe('refresh', () => {
    it('reads the token from the body (mobile) and rotates the pair, forwarding the idempotency key', async () => {
      authService.refresh.mockResolvedValue({ accessToken: 'access', refreshToken: 'refresh', expiresInSeconds: 900 });
      const request = { cookies: {}, headers: {} } as unknown as Request;

      const result = await controller.refresh(
        { refresh_token: 'old-refresh' },
        { userAgent: 'jest', idempotencyKey: 'idem-1' },
        request,
      );

      expect(authService.refresh).toHaveBeenCalledWith({ refreshToken: 'old-refresh', idempotencyKey: 'idem-1' });
      expect(result).toEqual({
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'Bearer',
        expires_in: 900,
      });
    });
  });

  describe('logout', () => {
    it('revokes the current session and leaves cookies untouched for a mobile client', async () => {
      const request = { headers: {} } as unknown as Request;
      const response = createMock<Response>();

      await controller.logout({ id: 'session-1' }, request, response);

      expect(authService.logout).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(response.clearCookie).not.toHaveBeenCalled();
    });

    it('clears the refresh & CSRF cookies for a web client', async () => {
      const request = { headers: { 'x-client-type': 'web' } } as unknown as Request;
      const response = createMock<Response>();

      await controller.logout({ id: 'session-1' }, request, response);

      expect(response.clearCookie).toHaveBeenCalledTimes(2);
    });
  });
});
