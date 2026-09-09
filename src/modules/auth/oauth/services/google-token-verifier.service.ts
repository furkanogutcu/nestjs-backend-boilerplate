import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { env } from '@config/env.config';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { IOAuthIdentity } from '../../interfaces/oauth-identity.interface';

@Injectable()
export class GoogleTokenVerifier {
  private readonly client = new OAuth2Client();

  async verify({ idToken }: { idToken: string }): Promise<IOAuthIdentity> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: env.GOOGLE_OAUTH_CLIENT_IDS });
      const payload = ticket.getPayload();

      if (!payload?.sub) {
        throw this.invalidToken();
      }

      // ! verifyIdToken pins `aud`; this `azp` check closes the multi-audience token-substitution gap.
      if (payload.azp && !env.GOOGLE_OAUTH_CLIENT_IDS.includes(payload.azp)) {
        throw this.invalidToken();
      }

      return {
        providerUserId: payload.sub,
        email: payload.email_verified === true ? (payload.email ?? undefined) : undefined,
        name: payload.name,
        nonce: payload.nonce,
      };
    } catch (error) {
      if (error instanceof AppUnauthorizedException) {
        throw error;
      }

      throw this.invalidToken();
    }
  }

  private invalidToken(): AppUnauthorizedException {
    return new AppUnauthorizedException({ code: ExceptionCode.InvalidOauthToken, message: 'Invalid Google ID token.' });
  }
}
