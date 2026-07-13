import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

import { env } from '@config/env.config';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';

@Injectable()
export class RequireHttpsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (env.NODE_ENV !== 'production') {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();

    if (!request.secure) {
      throw new AppForbiddenException({ message: 'HTTPS is required.' });
    }

    return true;
  }
}
