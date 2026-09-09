import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { Permission } from '../permission.enum';
import { UserPermissionsService } from '../services/user-permissions.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userPermissions: UserPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();

    // ! Runs after AuthGuard in the APP_GUARD chain. A @Public route that also declares @RequirePermission has
    // ! no authenticated user, so it is rejected rather than silently allowed.
    if (!request.user) {
      throw new AppUnauthorizedException();
    }

    const granted = await this.userPermissions.forUser({ userId: request.user.id });

    if (required.some((permission) => !granted.has(permission))) {
      throw new AppForbiddenException();
    }

    return true;
  }
}
