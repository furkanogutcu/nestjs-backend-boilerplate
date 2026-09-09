import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Repository } from 'typeorm';

import { AuditAction } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { StorageVisibility } from '@infrastructure/storage/enums/storage-visibility.enum';
import { StorageService } from '@infrastructure/storage/services/storage.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { Post } from '../entities/post.entity';
import { PostsService } from './posts.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const AUTHOR = 'author-1';

function buildPost(overrides: Partial<Post> = {}): Post {
  return {
    id: 'p1',
    authorId: AUTHOR,
    slug: 'hello-world',
    title: 'Hello',
    body: 'Body',
    coverImageKey: null,
    publishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Post;
}

describe('PostsService', () => {
  let posts: DeepMocked<Repository<Post>>;
  let cacheService: DeepMocked<CacheService>;
  let storageService: DeepMocked<StorageService>;
  let auditService: DeepMocked<AuditService>;
  let service: PostsService;

  beforeEach(() => {
    posts = createMock<Repository<Post>>();
    cacheService = createMock<CacheService>();
    storageService = createMock<StorageService>();
    auditService = createMock<AuditService>();
    const clock = createMock<ClockService>();
    clock.date.mockReturnValue(NOW);

    posts.findOne.mockResolvedValue(buildPost());
    cacheService.get.mockResolvedValue(null);

    service = new PostsService(posts, cacheService, storageService, auditService, clock);
  });

  describe('getPublishedBySlug', () => {
    it('serves a cached post without hitting the database', async () => {
      cacheService.get.mockResolvedValue(buildPost({ publishedAt: NOW }));

      await service.getPublishedBySlug({ slug: 'hello-world' });

      expect(posts.findOne).not.toHaveBeenCalled();
    });

    it('reads through and caches on a miss', async () => {
      posts.findOne.mockResolvedValue(buildPost({ publishedAt: NOW }));

      await service.getPublishedBySlug({ slug: 'hello-world' });

      expect(cacheService.set).toHaveBeenCalledWith(expect.objectContaining({ ttl: 120 }));
    });

    it('rebuilds the timestamps a JSON cache round-trip flattened into strings', async () => {
      cacheService.get.mockResolvedValue(JSON.parse(JSON.stringify(buildPost({ publishedAt: NOW }))) as Post);

      const post = await service.getPublishedBySlug({ slug: 'hello-world' });

      expect(post.publishedAt).toBeInstanceOf(Date);
      expect(post.createdAt).toBeInstanceOf(Date);
      expect(post.publishedAt?.toISOString()).toBe(NOW.toISOString());
    });

    it('does not expose a draft through the public read path', async () => {
      posts.findOne.mockResolvedValue(null);

      await expect(service.getPublishedBySlug({ slug: 'draft' })).rejects.toBeInstanceOf(AppNotFoundException);
    });
  });

  describe('create', () => {
    it('rejects a duplicate slug', async () => {
      await expect(
        service.create({ authorId: AUTHOR, slug: 'hello-world', title: 'x', body: 'y' }),
      ).rejects.toBeInstanceOf(AppConflictException);
    });

    it('stores a draft, never a published post', async () => {
      posts.findOne.mockResolvedValueOnce(null).mockResolvedValue(buildPost());

      await service.create({ authorId: AUTHOR, slug: 'new-post', title: 'x', body: 'y' });

      expect(posts.insert).toHaveBeenCalledWith(expect.objectContaining({ publishedAt: null }));
    });
  });

  describe('ownership', () => {
    it('hides another author’s draft as not found', async () => {
      posts.findOne.mockResolvedValue(buildPost({ authorId: 'someone-else', publishedAt: null }));

      await expect(service.update({ postId: 'p1', authorId: AUTHOR, title: 'x' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });

    it('refuses another author’s published post as forbidden', async () => {
      posts.findOne.mockResolvedValue(buildPost({ authorId: 'someone-else', publishedAt: NOW }));

      await expect(service.update({ postId: 'p1', authorId: AUTHOR, title: 'x' })).rejects.toBeInstanceOf(
        AppForbiddenException,
      );
    });
  });

  describe('update', () => {
    it('writes only the supplied fields and drops the cached copy', async () => {
      await service.update({ postId: 'p1', authorId: AUTHOR, title: 'New title' });

      expect(posts.update).toHaveBeenCalledWith({ id: 'p1' }, { title: 'New title' });
      expect(cacheService.delete).toHaveBeenCalledWith({ key: expect.stringContaining('hello-world') });
    });
  });

  describe('publish', () => {
    it('stamps the publication time and invalidates the cache', async () => {
      await service.publish({ postId: 'p1', authorId: AUTHOR });

      expect(posts.update).toHaveBeenCalledWith({ id: 'p1' }, { publishedAt: NOW });
      expect(cacheService.delete).toHaveBeenCalled();
    });

    it('refuses to publish twice', async () => {
      posts.findOne.mockResolvedValue(buildPost({ publishedAt: NOW }));

      await expect(service.publish({ postId: 'p1', authorId: AUTHOR })).rejects.toBeInstanceOf(AppConflictException);
    });
  });

  describe('remove', () => {
    it('deletes the row, the cached copy and the cover object', async () => {
      posts.findOne.mockResolvedValue(buildPost({ coverImageKey: 'public/posts/p1/cover' }));
      Object.defineProperty(storageService, 'isConfigured', { get: () => true, configurable: true });

      await service.remove({ postId: 'p1', authorId: AUTHOR });

      expect(posts.delete).toHaveBeenCalledWith({ id: 'p1' });
      expect(storageService.delete).toHaveBeenCalledWith({ key: 'public/posts/p1/cover' });
    });

    it('skips the storage call when no cover was ever uploaded', async () => {
      await service.remove({ postId: 'p1', authorId: AUTHOR });

      expect(storageService.delete).not.toHaveBeenCalled();
    });
  });

  describe('removeAsModerator', () => {
    it('deletes without an ownership check and records who did it', async () => {
      posts.findOne.mockResolvedValue(buildPost({ authorId: 'someone-else' }));

      await service.removeAsModerator({ postId: 'p1', actorUserId: 'mod-1' });

      expect(posts.delete).toHaveBeenCalledWith({ id: 'p1' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.PostRemovedByModerator, actorUserId: 'mod-1' }),
      );
    });

    it('fails for a post that does not exist', async () => {
      posts.findOne.mockResolvedValue(null);

      await expect(service.removeAsModerator({ postId: 'ghost', actorUserId: 'mod-1' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });
  });

  describe('createCoverUpload', () => {
    it('signs a public upload bounded by the post-specific limits', async () => {
      storageService.createUploadUrl.mockResolvedValue({
        url: 'https://signed',
        key: 'public/posts/p1/cover',
        expiresInSeconds: 300,
        requiredHeaders: { 'Content-Type': 'image/png', 'Content-Length': '1' },
      });

      await service.createCoverUpload({ postId: 'p1', authorId: AUTHOR });

      expect(storageService.createUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: StorageVisibility.Public, maxBytes: 2 * 1024 * 1024 }),
      );
      expect(posts.update).toHaveBeenCalledWith({ id: 'p1' }, { coverImageKey: 'public/posts/p1/cover' });
    });
  });

  describe('coverUrl', () => {
    it('returns null when the post has no cover', () => {
      expect(service.coverUrl({ post: buildPost() })).toBeNull();
    });

    it('asks storage for the public URL when there is one', () => {
      storageService.publicUrl.mockReturnValue('https://cdn.example.com/public/posts/p1/cover');

      expect(service.coverUrl({ post: buildPost({ coverImageKey: 'public/posts/p1/cover' }) })).toBe(
        'https://cdn.example.com/public/posts/p1/cover',
      );
    });
  });

  describe('listPublished', () => {
    it('always constrains the query to published posts', async () => {
      await service.listPublished({ skip: 0, take: 10 });

      const [options] = posts.listWithOffsetPagination.mock.calls[0] as unknown as [
        { where: { publishedAt: unknown } },
      ];
      expect(options.where.publishedAt).toBeDefined();
    });

    it('keeps the published constraint on every search clause', async () => {
      await service.listPublished({ skip: 0, take: 10, search: [{ title: undefined }, { slug: undefined }] });

      const [options] = posts.listWithOffsetPagination.mock.calls[0] as unknown as [{ where: object[] }];
      expect(options.where.every((clause) => 'publishedAt' in clause)).toBe(true);
    });
  });
});
