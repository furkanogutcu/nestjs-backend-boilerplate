import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { env } from '@config/env.config';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { IOAuthIdentity } from '../../interfaces/oauth-identity.interface';

const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

@Injectable()
export class AppleTokenVerifier {
  private readonly jwks = createRemoteJWKSet(new URL(APPLE_JWKS_URL), {
    cacheMaxAge: 10 * 60 * 1000,
    cooldownDuration: 30 * 1000,
    timeoutDuration: 5 * 1000,
  });

  async verify({ idToken }: { idToken: string }): Promise<IOAuthIdentity> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        algorithms: ['RS256'],
        issuer: env.APPLE_OAUTH_ISSUER,
        audience: env.APPLE_OAUTH_CLIENT_IDS,
      });

      if (!payload.sub) {
        throw this.invalidToken();
      }

      // * Apple sends email only on the first authorization and may report email_verified as a string.
      const emailVerified = payload.email_verified === true || payload.email_verified === 'true';

      return {
        providerUserId: payload.sub,
        email: emailVerified && typeof payload.email === 'string' ? payload.email : undefined,
        nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
      };
    } catch (error) {
      if (error instanceof AppUnauthorizedException) {
        throw error;
      }

      throw this.invalidToken();
    }
  }

  private invalidToken(): AppUnauthorizedException {
    return new AppUnauthorizedException({ code: ExceptionCode.InvalidOauthToken, message: 'Invalid Apple ID token.' });
  }
}
