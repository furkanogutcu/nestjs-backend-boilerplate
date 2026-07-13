import { Injectable } from '@nestjs/common';

import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import type { IAccessTokenVerifier, IVerifiedIdentity } from '@shared/interfaces/access-token-verifier.interface';

import { RevocationService } from './revocation.service';
import { TokenService } from './token.service';

// * Adapter behind the shared ACCESS_TOKEN_VERIFIER port: authenticates a connection's access token the SAME way
// * the HTTP AuthGuard does — verify the JWT (signature/iss/aud/exp) AND reject a revoked session/family — then
// * maps the raw claims (sub/sid/fid) to the meaning-named identity. Consumed by the realtime WS gateway, whose
// * handshake is the ONLY auth for a socket (the HTTP guard chain does not run on upgrades), so parity with the
// * guard is a security requirement: a logged-out session must not open a socket on a not-yet-expired token.
@Injectable()
export class AccessTokenVerifierService implements IAccessTokenVerifier {
  constructor(
    private readonly tokenService: TokenService,
    private readonly revocationService: RevocationService,
  ) {}

  async verify({ token }: { token: string }): Promise<IVerifiedIdentity> {
    const claims = await this.tokenService.verifyAccessToken({ token });

    if (await this.revocationService.isRevoked({ sessionId: claims.sid, familyId: claims.fid })) {
      throw new AppUnauthorizedException();
    }

    return {
      userId: claims.sub,
      sessionId: claims.sid,
      familyId: claims.fid,
      tokenExpiresAtEpochMillis: claims.exp * 1000,
    };
  }
}
