import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { Idempotent } from '@shared/decorators/idempotent.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { SubjectRateLimit } from '@shared/decorators/subject-rate-limit.decorator';
import { IdempotencyPrincipalSource } from '@shared/enums/idempotency-principal-source.enum';
import { SubjectRateLimitPolicy } from '@shared/interfaces/rate-limit-rule.interface';

import { IDEMPOTENCY_GUEST_TTL_SECONDS, TOKEN_TYPE } from './constants/auth.constant';
import { ClientHeaders } from './decorators/client-headers.decorator';
import { CurrentSession } from './decorators/current-session.decorator';
import { ClientType } from './enums/client-type.enum';
import { RefreshCookie } from './interceptors/refresh-cookie.interceptor';
import type { IClientHeaders } from './interfaces/client-headers.interface';
import { GuestResponse, guestResponseSchema } from './schemas/guest.response';
import { RefreshRequest } from './schemas/refresh.request';
import { TokenPairResponse, tokenPairResponseSchema } from './schemas/token-pair.response';
import { AuthService } from './services/auth.service';
import { clearAuthCookies, resolveRefreshToken, setCsrfCookie } from './utils/auth-cookie.util';
import { resolveClientType } from './utils/client-type.util';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('csrf')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Standard })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'CSRF token',
    description:
      'Issues (or rotates) the readable CSRF cookie for web clients. Call it on app load before any cookie-authenticated request (e.g. /auth/refresh): read the csrf_token cookie and echo its value in the X-CSRF-Token header. Harmless for mobile clients, which ignore it. Returns 204.',
  })
  csrf(@Res({ passthrough: true }) response: Response): void {
    setCsrfCookie({ response });
  }

  @Post('guest')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @Idempotent({
    scope: 'auth:guest',
    principalSource: IdempotencyPrincipalSource.Anonymous,
    responseTtlSeconds: IDEMPOTENCY_GUEST_TTL_SECONDS,
  })
  @ApiOperation({
    summary: 'Guest login',
    description:
      'Entry point for first launch: creates an anonymous user and returns an access/refresh token pair so the device can call authenticated endpoints. Pass the optional Idempotency-Key header to make retries safe.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional high-entropy key (24-128 chars, base64url/hex/UUID) to safely retry guest creation without creating duplicate users. High entropy is required because guest requests share an anonymous namespace.',
  })
  @ResponseDto({
    schema: guestResponseSchema,
    status: HttpStatus.CREATED,
    description: 'Guest user created; token pair and user summary returned.',
    errors: [HttpStatus.BAD_REQUEST],
  })
  async createGuest(@ClientHeaders() client: IClientHeaders): Promise<GuestResponse> {
    const { user, accessToken, refreshToken, expiresInSeconds } = await this.authService.createGuest({
      userAgent: client.userAgent,
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: TOKEN_TYPE,
      expires_in: expiresInSeconds,
      user: { id: user.id, is_anonymous: user.isAnonymous },
    };
  }

  @Post('refresh')
  @Public()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Strict })
  @RefreshCookie()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh tokens',
    description:
      'Exchanges a valid refresh token for a fresh token pair and invalidates the old one (rotation). Mobile clients send the token in the body; web clients (X-Client-Type: web) send it via the refresh cookie plus the X-CSRF-Token header, and receive the rotated token as a cookie. Replaying a consumed refresh token triggers reuse detection; pass the optional Idempotency-Key header to retry a dropped response safely.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional opaque key (16-128 chars, no whitespace) to safely retry this refresh without triggering reuse detection.',
  })
  @ResponseDto({
    schema: tokenPairResponseSchema,
    description: 'Refresh token rotated; new token pair returned.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (body + client headers + request)
  async refresh(
    @Body() body: RefreshRequest,
    @ClientHeaders() client: IClientHeaders,
    @Req() request: Request,
  ): Promise<TokenPairResponse> {
    const refreshToken = resolveRefreshToken({ request, bodyToken: body.refresh_token });
    const {
      accessToken,
      refreshToken: rotatedToken,
      expiresInSeconds,
    } = await this.authService.refresh({
      refreshToken,
      idempotencyKey: client.idempotencyKey,
    });

    return {
      access_token: accessToken,
      refresh_token: rotatedToken,
      token_type: TOKEN_TYPE,
      expires_in: expiresInSeconds,
    };
  }

  @Post('logout')
  @ApiBearerAuth()
  @SubjectRateLimit({ policy: SubjectRateLimitPolicy.Sensitive })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout',
    description:
      'Revokes the session behind the supplied access token, invalidating its refresh token. For web clients it also clears the refresh & CSRF cookies. Returns 204.',
  })
  // eslint-disable-next-line no-restricted-syntax -- route handler composes framework param decorators (session + request + response)
  async logout(
    @CurrentSession() session: { id: string },
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout({ sessionId: session.id });

    if (resolveClientType(request) === ClientType.Web) {
      clearAuthCookies({ response });
    }
  }
}
