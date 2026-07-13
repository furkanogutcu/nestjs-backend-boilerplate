import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ResponseDto } from '@shared/decorators/response-dto.decorator';

import { CurrentUser } from '../decorators/current-user.decorator';
import { IUserView } from '../interfaces/user-view.interface';
import { UserResponse, userResponseSchema } from '../schemas/user.response';
import { ProfileService } from './profile.service';

@ApiTags('Auth')
@Controller('auth')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns the authenticated user profile, including anonymity status and any linked OAuth providers.',
  })
  @ResponseDto({
    schema: userResponseSchema,
    description: 'Current user profile with linked providers.',
    errors: [HttpStatus.UNAUTHORIZED],
  })
  async me(@CurrentUser() user: { id: string }): Promise<UserResponse> {
    const view = await this.profileService.getUserView({ userId: user.id });

    return this.toUserResponse(view);
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
