import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import { Request } from 'express';

import { IS_PUBLIC_KEY } from '@shared/decorators/public.decorator';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { RevocationService } from '../services/revocation.service';
import { TokenService } from '../services/token.service';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly revocationService: RevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new AppUnauthorizedException();
    }

    const claims = await this.tokenService.verifyAccessToken({ token });

    if (await this.revocationService.isRevoked({ sessionId: claims.sid, familyId: claims.fid })) {
      this.logger.warn(`Revoked access token presented (session_id=${claims.sid})`);
      Sentry.captureMessage('revoked_token_presented', {
        level: 'warning',
        tags: { session_id: claims.sid, user_id: claims.sub },
      });
      throw new AppUnauthorizedException();
    }

    request.user = { id: claims.sub };
    request.session = { id: claims.sid, familyId: claims.fid };

    // * Attribute subsequent errors to the user on this request's isolation scope (id only, no PII).
    Sentry.setUser({ id: claims.sub });

    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (!header) {
      return null;
    }

    const [scheme, value] = header.split(' ');

    if (scheme !== 'Bearer' || !value) {
      return null;
    }

    return value;
  }
}
