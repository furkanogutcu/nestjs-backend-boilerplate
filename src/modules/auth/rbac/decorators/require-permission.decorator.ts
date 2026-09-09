import { SetMetadata } from '@nestjs/common';

import { Permission } from '../permission.enum';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

// * Listing several permissions requires all of them.
export const RequirePermission = (...permissions: [Permission, ...Permission[]]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
