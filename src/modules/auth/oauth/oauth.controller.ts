import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '@shared/decorators/public.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { SubjectRateLimit } from '@shared/decorators/subject-rate-limit.decorator';
import { SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

import { TOKEN_TYPE } from '../constants/auth.constant';
import { ClientHeaders } from '../decorators/client-headers.decorator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RefreshCookie } from '../interceptors/refresh-cookie.interceptor';
import type { IClientHeaders } from '../interfaces/client-headers.interface';
import { ISignInResult } from '../interfaces/sign-in-result.interface';
import { IUserView } from '../interfaces/user-view.interface';
import { LinkAppleRequest } from '../schemas/link-apple.request';
import { LinkGameCenterRequest } from '../schemas/link-game-center.request';
import { LinkGoogleRequest } from '../schemas/link-google.request';
import { LinkPlayGamesRequest } from '../schemas/link-play-games.request';
import { NonceResponse, nonceResponseSchema } from '../schemas/nonce.response';
import { SigninResponse, signinResponseSchema } from '../schemas/signin.response';
import { SigninAppleRequest } from '../schemas/signin-apple.request';
import { SigninGameCenterRequest } from '../schemas/signin-game-center.request';
import { SigninGoogleRequest } from '../schemas/signin-google.request';
import { SigninNonceResponse, signinNonceResponseSchema } from '../schemas/signin-nonce.response';
import { SigninPlayGamesRequest } from '../schemas/signin-play-games.request';
import { UserResponse, userResponseSchema } from '../schemas/user.response';
import { OAuthService } from './services/oauth.service';

@ApiTags('Auth')
@Controller('auth')
export class OAuthController {
  constructor(private readonly oauthService: OAuthService) {}

  @Post('link/nonce')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link nonce',
    description:
      'Step one of account linking: returns a single-use nonce the client embeds into the provider token before calling the matching /auth/link/* endpoint.',
  })
  @ResponseDto({ schema: nonceResponseSchema, description: 'Single-use linking nonce issued.' })
  async issueNonce(@CurrentUser() user: { id: string }): Promise<NonceResponse> {
    const nonce = await this.oauthService.issueNonce({ userId: user.id });

    return { nonce };
  }

  @Post('link/google')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link Google',
    description:
      'Links a Google identity to the authenticated user after verifying the ID token and the supplied refresh token as step-up proof. Conflicts if the identity is already linked to another user.',
  })
  @ResponseDto({
    schema: userResponseSchema,
    description: 'Google identity linked; updated user returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT],
  })
  async linkGoogle(@Body() body: LinkGoogleRequest): Promise<UserResponse> {
    const view = await this.oauthService.linkGoogle({ idToken: body.id_token, refreshToken: body.refresh_token });

    return this.toUserResponse(view);
  }

  @Post('link/apple')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link Apple',
    description:
      'Links an Apple identity to the authenticated user after verifying the ID token and the supplied refresh token as step-up proof. Conflicts if the identity is already linked to another user.',
  })
  @ResponseDto({
    schema: userResponseSchema,
    description: 'Apple identity linked; updated user returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT],
  })
  async linkApple(@Body() body: LinkAppleRequest): Promise<UserResponse> {
    const view = await this.oauthService.linkApple({
      idToken: body.id_token,
      refreshToken: body.refresh_token,
      name: body.name,
    });

    return this.toUserResponse(view);
  }

  @Post('link/game-center')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link Game Center',
    description:
      'Links a Game Center identity to the authenticated user after verifying the GameKit signature and the supplied refresh token as step-up proof. Conflicts if the identity is already linked to another user.',
  })
  @ResponseDto({
    schema: userResponseSchema,
    description: 'Game Center identity linked; updated user returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT],
  })
  async linkGameCenter(@Body() body: LinkGameCenterRequest): Promise<UserResponse> {
    const view = await this.oauthService.linkGameCenter({
      teamPlayerId: body.team_player_id,
      publicKeyUrl: body.public_key_url,
      signature: body.signature,
      salt: body.salt,
      timestamp: body.timestamp,
      refreshToken: body.refresh_token,
    });

    return this.toUserResponse(view);
  }

  @Post('link/play-games')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Link Play Games',
    description:
      'Links a Play Games identity to the authenticated user after exchanging the server auth code and verifying the supplied refresh token as step-up proof. Conflicts if the identity is already linked to another user.',
  })
  @ResponseDto({
    schema: userResponseSchema,
    description: 'Play Games identity linked; updated user returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT],
  })
  async linkPlayGames(@Body() body: LinkPlayGamesRequest): Promise<UserResponse> {
    const view = await this.oauthService.linkPlayGames({
      serverAuthCode: body.server_auth_code,
      refreshToken: body.refresh_token,
    });

    return this.toUserResponse(view);
  }

  @Post('signin/nonce')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign-in nonce',
    description:
      'Step one of provider sign-in: returns a short-lived single-use nonce the client embeds into the provider ID token before calling the matching /auth/signin/* endpoint.',
  })
  @ResponseDto({ schema: signinNonceResponseSchema, description: 'Single-use sign-in nonce issued with its TTL.' })
  async issueSignInNonce(): Promise<SigninNonceResponse> {
    const { nonce, expiresInSeconds } = await this.oauthService.issueSignInNonce();

    return { nonce, expires_in: expiresInSeconds };
  }

  @Post('signin/google')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      'Verifies a Google ID token bound to a prior /auth/signin/nonce nonce and returns the linked account token pair. Returns 404 if no account is linked to that Google identity.',
  })
  @ResponseDto({
    schema: signinResponseSchema,
    description: 'Signed in; token pair and user with linked providers returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND],
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (body + client headers)
  async signInWithGoogle(
    @Body() body: SigninGoogleRequest,
    @ClientHeaders() client: IClientHeaders,
  ): Promise<SigninResponse> {
    const result = await this.oauthService.signInWithGoogle({ idToken: body.id_token, userAgent: client.userAgent });

    return this.toSigninResponse(result);
  }

  @Post('signin/apple')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Apple',
    description:
      'Verifies an Apple ID token bound to a prior /auth/signin/nonce nonce and returns the linked account token pair. Returns 404 if no account is linked to that Apple identity.',
  })
  @ResponseDto({
    schema: signinResponseSchema,
    description: 'Signed in; token pair and user with linked providers returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND],
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (body + client headers)
  async signInWithApple(
    @Body() body: SigninAppleRequest,
    @ClientHeaders() client: IClientHeaders,
  ): Promise<SigninResponse> {
    const result = await this.oauthService.signInWithApple({ idToken: body.id_token, userAgent: client.userAgent });

    return this.toSigninResponse(result);
  }

  @Post('signin/game-center')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Game Center',
    description:
      'Verifies a Game Center GameKit signature and returns the linked account token pair. Returns 404 if no account is linked to that Game Center identity.',
  })
  @ResponseDto({
    schema: signinResponseSchema,
    description: 'Signed in; token pair and user with linked providers returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND],
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (body + client headers)
  async signInWithGameCenter(
    @Body() body: SigninGameCenterRequest,
    @ClientHeaders() client: IClientHeaders,
  ): Promise<SigninResponse> {
    const result = await this.oauthService.signInWithGameCenter({
      teamPlayerId: body.team_player_id,
      publicKeyUrl: body.public_key_url,
      signature: body.signature,
      salt: body.salt,
      timestamp: body.timestamp,
      userAgent: client.userAgent,
    });

    return this.toSigninResponse(result);
  }

  @Post('signin/play-games')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with Play Games',
    description:
      'Exchanges a Play Games server auth code and returns the linked account token pair. Returns 404 if no account is linked to that Play Games identity.',
  })
  @ResponseDto({
    schema: signinResponseSchema,
    description: 'Signed in; token pair and user with linked providers returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.NOT_FOUND],
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (body + client headers)
  async signInWithPlayGames(
    @Body() body: SigninPlayGamesRequest,
    @ClientHeaders() client: IClientHeaders,
  ): Promise<SigninResponse> {
    const result = await this.oauthService.signInWithPlayGames({
      serverAuthCode: body.server_auth_code,
      userAgent: client.userAgent,
    });

    return this.toSigninResponse(result);
  }

  private toSigninResponse(result: ISignInResult): SigninResponse {
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      token_type: TOKEN_TYPE,
      expires_in: result.expiresInSeconds,
      user: this.toUserResponse(result.user),
    };
  }

  private toUserResponse(view: IUserView): UserResponse {
    return {
      id: view.id,
      is_anonymous: view.isAnonymous,
      display_name: view.displayName,
      linked_providers: view.linkedProviders.map((provider) => ({
        provider: provider.provider,
        email: provider.email,
      })),
    };
  }
}
