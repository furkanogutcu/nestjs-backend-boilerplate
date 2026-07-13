import { createMock, DeepMocked } from '@golevelup/ts-jest';
import * as Sentry from '@sentry/nestjs';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { createMockExecutionContext, createMockReflector, createMockRequest } from '@test/helpers';

import { RevocationService } from '../services/revocation.service';
import { TokenService } from '../services/token.service';
import { AuthGuard } from './auth.guard';

jest.mock('@sentry/nestjs');

describe('AuthGuard', () => {
  let tokenService: DeepMocked<TokenService>;
  let revocationService: DeepMocked<RevocationService>;

  beforeEach(() => {
    tokenService = createMock<TokenService>();
    revocationService = createMock<RevocationService>();
    revocationService.isRevoked.mockResolvedValue(false);
  });

  function buildGuard(isPublic: boolean | undefined): AuthGuard {
    return new AuthGuard(createMockReflector(isPublic), tokenService, revocationService);
  }

  it('allows public routes without verifying a token', async () => {
    const guard = buildGuard(true);
    const context = createMockExecutionContext({ request: createMockRequest() });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws when no Authorization header is present', async () => {
    const guard = buildGuard(undefined);
    const context = createMockExecutionContext({ request: createMockRequest() });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('throws when the Authorization header is not a Bearer token', async () => {
    const guard = buildGuard(undefined);
    const request = createMockRequest({ headers: { authorization: 'Basic abc' } });

    await expect(guard.canActivate(createMockExecutionContext({ request }))).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws when the Bearer scheme carries an empty token', async () => {
    const guard = buildGuard(undefined);
    const request = createMockRequest({ headers: { authorization: 'Bearer ' } });

    await expect(guard.canActivate(createMockExecutionContext({ request }))).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('verifies the token and attaches the user and session to the request', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      fid: 'family-1',
      exp: 1767225600,
    });
    const guard = buildGuard(undefined);
    const request = createMockRequest({ headers: { authorization: 'Bearer good-token' } });

    await expect(guard.canActivate(createMockExecutionContext({ request }))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1' });
    expect(request.session).toEqual({ id: 'session-1', familyId: 'family-1' });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('rejects a token whose session has been revoked and reports a security event', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      fid: 'family-1',
      exp: 1767225600,
    });
    revocationService.isRevoked.mockResolvedValue(true);
    const guard = buildGuard(undefined);
    const request = createMockRequest({ headers: { authorization: 'Bearer revoked-token' } });

    await expect(guard.canActivate(createMockExecutionContext({ request }))).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
    expect(revocationService.isRevoked).toHaveBeenCalledWith({ sessionId: 'session-1', familyId: 'family-1' });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'revoked_token_presented',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('propagates verification failures', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new AppUnauthorizedException());
    const guard = buildGuard(undefined);
    const request = createMockRequest({ headers: { authorization: 'Bearer bad-token' } });

    await expect(guard.canActivate(createMockExecutionContext({ request }))).rejects.toBeInstanceOf(
      AppUnauthorizedException,
    );
  });
});
