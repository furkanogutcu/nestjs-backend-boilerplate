import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { PaginationType } from '@shared/enums/pagination-type.enum';
import { IOffsetPaginationMeta, OffsetPaginated } from '@shared/responses/offset-paginated.response';

import { Post } from './entities/post.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './services/posts.service';

const AT = new Date('2026-01-01T00:00:00.000Z');
const user = { id: 'author-1' };
const meta: IOffsetPaginationMeta = {
  pagination: { type: PaginationType.Offset, page: 1, page_size: 10, total_count: 1, total_pages: 1 },
};

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    authorId: 'author-1',
    slug: 'hello-world',
    title: 'Hello',
    body: 'Body',
    coverImageKey: null,
    publishedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  } as Post;
}

describe('PostsController', () => {
  let postsService: DeepMocked<PostsService>;
  let controller: PostsController;

  beforeEach(() => {
    postsService = createMock<PostsService>();
    postsService.coverUrl.mockReturnValue(null);
    controller = new PostsController(postsService);
  });

  it('maps a post to the wire format', async () => {
    postsService.getPublishedBySlug.mockResolvedValue(buildPost({ publishedAt: AT }));

    await expect(controller.getBySlug('hello-world')).resolves.toEqual({
      id: 'p1',
      slug: 'hello-world',
      title: 'Hello',
      body: 'Body',
      cover_image_url: null,
      published_at: AT.toISOString(),
      author_id: 'author-1',
      created_at: AT.toISOString(),
    });
  });

  it('reports a draft with a null publication date', async () => {
    postsService.listOwn.mockResolvedValue(new OffsetPaginated([buildPost()], meta));

    const page = await controller.listOwn(user, { skip: 0, take: 10 });

    expect(page.items[0].published_at).toBeNull();
  });

  it('surfaces the cover URL the service resolves', async () => {
    postsService.coverUrl.mockReturnValue('https://cdn.example.com/public/posts/p1/cover');
    postsService.getPublishedBySlug.mockResolvedValue(buildPost({ coverImageKey: 'public/posts/p1/cover' }));

    await expect(controller.getBySlug('hello-world')).resolves.toMatchObject({
      cover_image_url: 'https://cdn.example.com/public/posts/p1/cover',
    });
  });

  it('keeps the pagination meta when listing published posts', async () => {
    postsService.listPublished.mockResolvedValue(new OffsetPaginated([buildPost({ publishedAt: AT })], meta));

    const page = await controller.list({ skip: 0, take: 10 }, undefined);

    expect(page.meta).toBe(meta);
    expect(page.items).toHaveLength(1);
  });

  it('creates a draft for the authenticated author', async () => {
    postsService.create.mockResolvedValue(buildPost());

    await controller.create(user, { slug: 'hello-world', title: 'Hello', body: 'Body' });

    expect(postsService.create).toHaveBeenCalledWith({
      authorId: 'author-1',
      slug: 'hello-world',
      title: 'Hello',
      body: 'Body',
    });
  });

  it('updates only the supplied fields', async () => {
    postsService.update.mockResolvedValue(buildPost());

    await controller.update('p1', user, { title: 'New' });

    expect(postsService.update).toHaveBeenCalledWith({
      postId: 'p1',
      authorId: 'author-1',
      title: 'New',
      body: undefined,
    });
  });

  it('publishes a post', async () => {
    postsService.publish.mockResolvedValue(buildPost({ publishedAt: AT }));

    await controller.publish('p1', user);

    expect(postsService.publish).toHaveBeenCalledWith({ postId: 'p1', authorId: 'author-1' });
  });

  it('maps the signed cover upload to the wire format', async () => {
    postsService.createCoverUpload.mockResolvedValue({
      url: 'https://signed',
      key: 'public/posts/p1/cover',
      expiresInSeconds: 300,
      requiredHeaders: { 'Content-Type': 'image/png', 'Content-Length': '10' },
    });

    await expect(controller.coverUpload('p1', user)).resolves.toEqual({
      url: 'https://signed',
      key: 'public/posts/p1/cover',
      expires_in_seconds: 300,
      required_headers: { 'Content-Type': 'image/png', 'Content-Length': '10' },
    });
  });

  it('deletes a post as its author', async () => {
    await controller.remove('p1', user);

    expect(postsService.remove).toHaveBeenCalledWith({ postId: 'p1', authorId: 'author-1' });
  });
});
