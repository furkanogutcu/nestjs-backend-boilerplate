import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { AdminPostsController } from './admin-posts.controller';
import { PostsService } from './services/posts.service';

describe('AdminPostsController', () => {
  let postsService: DeepMocked<PostsService>;
  let controller: AdminPostsController;

  beforeEach(() => {
    postsService = createMock<PostsService>();
    controller = new AdminPostsController(postsService);
  });

  it('removes a post as a moderator, passing the acting operator', async () => {
    await controller.remove('p1', { id: 'mod-1' });

    expect(postsService.removeAsModerator).toHaveBeenCalledWith({ postId: 'p1', actorUserId: 'mod-1' });
  });
});
