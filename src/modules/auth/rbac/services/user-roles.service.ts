import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserRole } from '../entities/user-role.entity';

@Injectable()
export class UserRolesService {
  constructor(@InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>) {}

  // * Roles only carry administrative permissions, so "has any role" is what the MFA requirement turns on.
  async hasAnyRole({ userId }: { userId: string }): Promise<boolean> {
    return (await this.userRoles.countBy({ userId })) > 0;
  }
}
