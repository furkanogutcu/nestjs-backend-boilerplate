import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

import { env } from '@config/env.config';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { isResponseWithinSizeCap } from '@shared/utils/http.util';

import {
  PLAY_GAMES_FETCH_TIMEOUT_MS,
  PLAY_GAMES_PLAYER_URL,
  PLAY_GAMES_RESPONSE_MAX_BYTES,
} from '../../constants/auth.constant';
import { IOAuthIdentity } from '../../interfaces/oauth-identity.interface';

interface IPlayGamesPlayer {
  playerId?: string;
  displayName?: string;
}

@Injectable()
export class PlayGamesVerifier {
  private readonly client = new OAuth2Client({
    clientId: env.PLAY_GAMES_OAUTH_CLIENT_ID,
    clientSecret: env.PLAY_GAMES_OAUTH_CLIENT_SECRET,
  });

  async verify({ serverAuthCode }: { serverAuthCode: string }): Promise<IOAuthIdentity> {
    try {
      const { tokens } = await this.client.getToken(serverAuthCode);

      if (!tokens.access_token) {
        throw this.invalidToken();
      }

      const player = await this.fetchPlayer(tokens.access_token);

      if (!player.playerId) {
        throw this.invalidToken();
      }

      return { providerUserId: player.playerId, name: player.displayName };
    } catch (error) {
      if (error instanceof AppUnauthorizedException) {
        throw error;
      }

      throw this.invalidToken();
    }
  }

  private async fetchPlayer(accessToken: string): Promise<IPlayGamesPlayer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PLAY_GAMES_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(PLAY_GAMES_PLAYER_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
        // ! Never follow a redirect off the pinned endpoint — it would be an SSRF primitive.
        redirect: 'error',
      });

      if (!response.ok) {
        throw this.invalidToken();
      }

      if (!isResponseWithinSizeCap({ response, maxBytes: PLAY_GAMES_RESPONSE_MAX_BYTES })) {
        throw this.invalidToken();
      }

      return (await response.json()) as IPlayGamesPlayer;
    } finally {
      clearTimeout(timeout);
    }
  }

  private invalidToken(): AppUnauthorizedException {
    return new AppUnauthorizedException({
      code: ExceptionCode.InvalidOauthToken,
      message: 'Invalid Play Games server auth code.',
    });
  }
}
