import { createMock, DeepMocked } from '@golevelup/ts-jest';

import { OAuthProvider } from '../enums/oauth-provider.enum';
import { IClientHeaders } from '../interfaces/client-headers.interface';
import { ISignInResult } from '../interfaces/sign-in-result.interface';
import { IUserView } from '../interfaces/user-view.interface';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './services/oauth.service';

const userView: IUserView = {
  id: 'user-1',
  isAnonymous: false,
  displayName: 'Captain Nova',
  linkedProviders: [{ provider: OAuthProvider.Google, email: 'user@example.com' }],
};

const expectedUserResponse = {
  id: 'user-1',
  is_anonymous: false,
  display_name: 'Captain Nova',
  linked_providers: [{ provider: 'google', email: 'user@example.com' }],
};

const signInResult: ISignInResult = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresInSeconds: 900,
  user: userView,
};

const expectedSignInResponse = {
  access_token: 'access',
  refresh_token: 'refresh',
  token_type: 'Bearer',
  expires_in: 900,
  user: expectedUserResponse,
};

const client: IClientHeaders = { userAgent: 'jest', idempotencyKey: undefined };

const gameCenterBody = {
  team_player_id: 'A:_team',
  public_key_url: 'https://static.gc.apple.com/public-key/gc-prod.cer',
  signature: 'sig',
  salt: 'salt',
  timestamp: 1717000000000,
  refresh_token: 'refresh',
};

describe('OAuthController', () => {
  let oauthService: DeepMocked<OAuthService>;
  let controller: OAuthController;

  beforeEach(() => {
    oauthService = createMock<OAuthService>();
    controller = new OAuthController(oauthService);
  });

  describe('nonce issuance', () => {
    it('issues a link nonce for the current user', async () => {
      oauthService.issueNonce.mockResolvedValue('nonce-1');

      const result = await controller.issueNonce({ id: 'user-1' });

      expect(oauthService.issueNonce).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(result).toEqual({ nonce: 'nonce-1' });
    });

    it('issues a sign-in nonce with its lifetime', async () => {
      oauthService.issueSignInNonce.mockResolvedValue({ nonce: 'nonce-1', expiresInSeconds: 300 });

      const result = await controller.issueSignInNonce();

      expect(result).toEqual({ nonce: 'nonce-1', expires_in: 300 });
    });
  });

  describe('account linking', () => {
    it('links Google, mapping the body to the service call', async () => {
      oauthService.linkGoogle.mockResolvedValue(userView);

      const result = await controller.linkGoogle({ id_token: 'id', refresh_token: 'refresh' });

      expect(oauthService.linkGoogle).toHaveBeenCalledWith({ idToken: 'id', refreshToken: 'refresh' });
      expect(result).toEqual(expectedUserResponse);
    });

    it('links Apple, forwarding the optional name', async () => {
      oauthService.linkApple.mockResolvedValue(userView);

      const result = await controller.linkApple({ id_token: 'id', refresh_token: 'refresh', name: 'Nova' });

      expect(oauthService.linkApple).toHaveBeenCalledWith({ idToken: 'id', refreshToken: 'refresh', name: 'Nova' });
      expect(result).toEqual(expectedUserResponse);
    });

    it('links Game Center, mapping the signature bundle', async () => {
      oauthService.linkGameCenter.mockResolvedValue(userView);

      const result = await controller.linkGameCenter(gameCenterBody);

      expect(oauthService.linkGameCenter).toHaveBeenCalledWith({
        teamPlayerId: 'A:_team',
        publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod.cer',
        signature: 'sig',
        salt: 'salt',
        timestamp: 1717000000000,
        refreshToken: 'refresh',
      });
      expect(result).toEqual(expectedUserResponse);
    });

    it('links Play Games, mapping the server auth code', async () => {
      oauthService.linkPlayGames.mockResolvedValue(userView);

      const result = await controller.linkPlayGames({ server_auth_code: 'code', refresh_token: 'refresh' });

      expect(oauthService.linkPlayGames).toHaveBeenCalledWith({ serverAuthCode: 'code', refreshToken: 'refresh' });
      expect(result).toEqual(expectedUserResponse);
    });
  });

  describe('provider sign-in', () => {
    it('signs in with Google, forwarding the user agent', async () => {
      oauthService.signInWithGoogle.mockResolvedValue(signInResult);

      const result = await controller.signInWithGoogle({ id_token: 'id' }, client);

      expect(oauthService.signInWithGoogle).toHaveBeenCalledWith({ idToken: 'id', userAgent: 'jest' });
      expect(result).toEqual(expectedSignInResponse);
    });

    it('signs in with Apple, forwarding the user agent', async () => {
      oauthService.signInWithApple.mockResolvedValue(signInResult);

      const result = await controller.signInWithApple({ id_token: 'id' }, client);

      expect(oauthService.signInWithApple).toHaveBeenCalledWith({ idToken: 'id', userAgent: 'jest' });
      expect(result).toEqual(expectedSignInResponse);
    });

    it('signs in with Game Center, mapping the signature bundle', async () => {
      oauthService.signInWithGameCenter.mockResolvedValue(signInResult);

      const { refresh_token: _ignored, ...signinBody } = gameCenterBody;
      const result = await controller.signInWithGameCenter(signinBody, client);

      expect(oauthService.signInWithGameCenter).toHaveBeenCalledWith({
        teamPlayerId: 'A:_team',
        publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod.cer',
        signature: 'sig',
        salt: 'salt',
        timestamp: 1717000000000,
        userAgent: 'jest',
      });
      expect(result).toEqual(expectedSignInResponse);
    });

    it('signs in with Play Games, mapping the server auth code', async () => {
      oauthService.signInWithPlayGames.mockResolvedValue(signInResult);

      const result = await controller.signInWithPlayGames({ server_auth_code: 'code' }, client);

      expect(oauthService.signInWithPlayGames).toHaveBeenCalledWith({ serverAuthCode: 'code', userAgent: 'jest' });
      expect(result).toEqual(expectedSignInResponse);
    });
  });
});
