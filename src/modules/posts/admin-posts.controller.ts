import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermission } from '@modules/auth/rbac/decorators/require-permission.decorator';
import { Permission } from '@modules/auth/rbac/permission.enum';

import { PostsService } from './services/posts.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/posts')
export class AdminPostsController {
  constructor(private readonly postsService: PostsService) {}

  @Delete(':postId')
  @RequirePermission(Permission.PostsModerate)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove any post',
    description: 'Moderation route: bypasses ownership, requires a permission and is recorded in the audit log.',
  })
  async remove(@Param('postId', ParseUUIDPipe) postId: string, @CurrentUser() actor: { id: string }): Promise<void> {
    await this.postsService.removeAsModerator({ postId, actorUserId: actor.id });
  }
}
