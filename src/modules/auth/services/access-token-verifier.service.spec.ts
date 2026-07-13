import { createMock } from '@golevelup/ts-jest';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { AccessTokenVerifierService } from './access-token-verifier.service';
import { RevocationService } from './revocation.service';
import { TokenService } from './token.service';

// * The WS handshake's ONLY auth (the HTTP guard chain does not run on socket upgrades), so these lock its parity
// * with the HTTP AuthGuard: a valid-but-revoked token is rejected, a verified token maps to the right identity,
// * and a signature failure short-circuits before the revocation lookup.
describe('AccessTokenVerifierService', () => {
  let tokenService: ReturnType<typeof createMock<TokenService>>;
  let revocationService: ReturnType<typeof createMock<RevocationService>>;
  let service: AccessTokenVerifierService;

  beforeEach(() => {
    tokenService = createMock<TokenService>();
    revocationService = createMock<RevocationService>();
    service = new AccessTokenVerifierService(tokenService, revocationService);
  });

  it('maps the verified claims (sub/sid/fid/exp) to the meaning-named identity', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'user-1', sid: 'sess-1', fid: 'fam-1', exp: 1767225600 });
    revocationService.isRevoked.mockResolvedValue(false);

    await expect(service.verify({ token: 'jwt' })).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'sess-1',
      familyId: 'fam-1',
      tokenExpiresAtEpochMillis: 1767225600000,
    });
    expect(revocationService.isRevoked).toHaveBeenCalledWith({ sessionId: 'sess-1', familyId: 'fam-1' });
  });

  it('rejects a revoked session even when the token signature is valid (parity with the HTTP guard)', async () => {
    tokenService.verifyAccessToken.mockResolvedValue({ sub: 'user-1', sid: 'sess-1', fid: 'fam-1', exp: 1767225600 });
    revocationService.isRevoked.mockResolvedValue(true);

    await expect(service.verify({ token: 'jwt' })).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('propagates a token verification failure without consulting the revocation denylist', async () => {
    tokenService.verifyAccessToken.mockRejectedValue(new Error('invalid signature'));

    await expect(service.verify({ token: 'jwt' })).rejects.toThrow();
    expect(revocationService.isRevoked).not.toHaveBeenCalled();
  });
});
