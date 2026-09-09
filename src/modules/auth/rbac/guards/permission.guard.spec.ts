import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Reflector } from '@nestjs/core';

import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { createMockExecutionContext, createMockRequest } from '@test/helpers';

import { Permission } from '../permission.enum';
import { UserPermissionsService } from '../services/user-permissions.service';
import { PermissionGuard } from './permission.guard';

describe('PermissionGuard', () => {
  let reflector: DeepMocked<Reflector>;
  let userPermissions: DeepMocked<UserPermissionsService>;
  let guard: PermissionGuard;

  function contextFor(user?: { id: string }): ReturnType<typeof createMockExecutionContext> {
    const request = createMockRequest();
    Object.assign(request, { user });

    return createMockExecutionContext({ request });
  }

  beforeEach(() => {
    reflector = createMock<Reflector>();
    userPermissions = createMock<UserPermissionsService>();
    guard = new PermissionGuard(reflector, userPermissions);
  });

  it('allows a route that declares no permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
    expect(userPermissions.forUser).not.toHaveBeenCalled();
  });

  it('allows a route whose declared permission list is empty', async () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    await expect(guard.canActivate(contextFor())).resolves.toBe(true);
  });

  it('rejects an unauthenticated request on a protected route', async () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.UsersRead]);

    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(AppUnauthorizedException);
  });

  it('allows a user holding the required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.UsersRead]);
    userPermissions.forUser.mockResolvedValue(new Set([Permission.UsersRead]));

    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).resolves.toBe(true);
    expect(userPermissions.forUser).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('rejects a user missing the required permission', async () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.UsersSuspend]);
    userPermissions.forUser.mockResolvedValue(new Set([Permission.UsersRead]));

    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).rejects.toBeInstanceOf(AppForbiddenException);
  });

  it('requires every listed permission, not just one', async () => {
    reflector.getAllAndOverride.mockReturnValue([Permission.UsersRead, Permission.UsersSuspend]);
    userPermissions.forUser.mockResolvedValue(new Set([Permission.UsersRead]));

    await expect(guard.canActivate(contextFor({ id: 'user-1' }))).rejects.toBeInstanceOf(AppForbiddenException);
  });
});
