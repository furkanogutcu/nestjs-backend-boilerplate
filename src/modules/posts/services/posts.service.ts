import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';

import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { StorageVisibility } from '@infrastructure/storage/enums/storage-visibility.enum';
import { ISignedUpload, StorageService } from '@infrastructure/storage/services/storage.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import { CacheKey } from '@shared/utils/cache-key.util';
import { generateUuid } from '@shared/utils/uuid.util';

import { Post } from '../entities/post.entity';
import { POST_COVER_CONTENT_TYPES, POST_COVER_MAX_BYTES, PUBLISHED_POST_CACHE_TTL_SECONDS } from '../posts.constant';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post) private readonly posts: Repository<Post>,
    private readonly cacheService: CacheService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly clock: ClockService,
  ) {}

  async listPublished(params: {
    skip: number;
    take: number;
    search?: FindOptionsWhere<Post>[];
  }): Promise<OffsetPaginated<Post>> {
    const { skip, take, search } = params;
    const published: FindOptionsWhere<Post> = { publishedAt: Not(IsNull()) };

    return await this.posts.listWithOffsetPagination({
      where: search ? search.map((clause) => ({ ...clause, ...published })) : published,
      skip,
      take,
      order: { publishedAt: 'DESC' },
    });
  }

  async listOwn(params: { authorId: string; skip: number; take: number }): Promise<OffsetPaginated<Post>> {
    const { authorId, skip, take } = params;

    return await this.posts.listWithOffsetPagination({
      where: { authorId },
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }

  // * Read-through cache on the public read path only; a draft is never cached because only its author can see
  // * it and the entry would be a per-user cache masquerading as a shared one.
  async getPublishedBySlug({ slug }: { slug: string }): Promise<Post> {
    const cached = await this.cacheService.get<Post>({ key: this.slugKey(slug) });

    if (cached) {
      return this.reviveDates(cached);
    }

    const post = await this.posts.findOne({ where: { slug, publishedAt: Not(IsNull()) } });

    if (!post) {
      throw new AppNotFoundException({ resourceName: 'Post' });
    }

    await this.cacheService.set({ key: this.slugKey(slug), data: post, ttl: PUBLISHED_POST_CACHE_TTL_SECONDS });

    return post;
  }

  async create(params: { authorId: string; title: string; body: string; slug: string }): Promise<Post> {
    const { authorId, title, body, slug } = params;

    if (await this.posts.findOne({ where: { slug }, select: { id: true } })) {
      throw new AppConflictException({ conflictedFields: ['slug'], message: 'A post with this slug already exists.' });
    }

    const post = { id: generateUuid(), authorId, title, body, slug, coverImageKey: null, publishedAt: null };
    await this.posts.insert(post);

    return await this.requireOwned({ postId: post.id, authorId });
  }

  async update(params: { postId: string; authorId: string; title?: string; body?: string }): Promise<Post> {
    const { postId, authorId, title, body } = params;
    const post = await this.requireOwned({ postId, authorId });

    await this.posts.update({ id: postId }, { ...(title && { title }), ...(body && { body }) });
    await this.invalidate(post);

    return await this.requireOwned({ postId, authorId });
  }

  async publish({ postId, authorId }: { postId: string; authorId: string }): Promise<Post> {
    const post = await this.requireOwned({ postId, authorId });

    if (post.publishedAt) {
      throw new AppConflictException({ conflictedFields: ['publishedAt'], message: 'Post is already published.' });
    }

    await this.posts.update({ id: postId }, { publishedAt: this.clock.date() });
    await this.invalidate(post);

    return await this.requireOwned({ postId, authorId });
  }

  async remove({ postId, authorId }: { postId: string; authorId: string }): Promise<void> {
    const post = await this.requireOwned({ postId, authorId });

    await this.posts.delete({ id: postId });
    await this.invalidate(post);
    await this.deleteCover(post);
  }

  // * Moderation path: no ownership check, but a permission check upstream and an audit record here.
  async removeAsModerator({ postId, actorUserId }: { postId: string; actorUserId: string }): Promise<void> {
    const post = await this.posts.findOne({ where: { id: postId } });

    if (!post) {
      throw new AppNotFoundException({ resourceName: 'Post' });
    }

    await this.posts.delete({ id: postId });
    await this.invalidate(post);
    await this.deleteCover(post);

    await this.auditService.record({
      action: AuditAction.PostRemovedByModerator,
      actorUserId,
      subjectType: AuditSubjectType.Post,
      subjectId: postId,
      metadata: { slug: post.slug, authorId: post.authorId },
    });
  }

  async createCoverUpload({ postId, authorId }: { postId: string; authorId: string }): Promise<ISignedUpload> {
    const post = await this.requireOwned({ postId, authorId });
    const key = `posts/${post.id}/cover`;

    const signed = await this.storageService.createUploadUrl({
      key,
      // * The client tells us what it is about to send; the signature makes the claim binding.
      contentType: POST_COVER_CONTENT_TYPES[0],
      contentLength: POST_COVER_MAX_BYTES,
      allowedContentTypes: POST_COVER_CONTENT_TYPES,
      visibility: StorageVisibility.Public,
      maxBytes: POST_COVER_MAX_BYTES,
    });

    await this.posts.update({ id: postId }, { coverImageKey: signed.key });
    await this.invalidate(post);

    return signed;
  }

  coverUrl({ post }: { post: Post }): string | null {
    return post.coverImageKey ? this.storageService.publicUrl({ key: post.coverImageKey }) : null;
  }

  private async requireOwned({ postId, authorId }: { postId: string; authorId: string }): Promise<Post> {
    const post = await this.posts.findOne({ where: { id: postId } });

    if (!post) {
      throw new AppNotFoundException({ resourceName: 'Post' });
    }

    // ! Not found vs forbidden: telling a stranger that a draft exists is itself a leak, so ownership failures
    // ! on a draft look identical to a missing post.
    if (post.authorId !== authorId) {
      if (post.publishedAt) {
        throw new AppForbiddenException({ message: 'You can only modify your own posts.' });
      }

      throw new AppNotFoundException({ resourceName: 'Post' });
    }

    return post;
  }

  private async invalidate(post: Post): Promise<void> {
    await this.cacheService.delete({ key: this.slugKey(post.slug) });
  }

  private async deleteCover(post: Post): Promise<void> {
    if (post.coverImageKey && this.storageService.isConfigured) {
      await this.storageService.delete({ key: post.coverImageKey });
    }
  }

  // ! The cache round-trips through JSON, which turns every Date into a string. Callers type the result as a
  // ! Post and call Date methods on it, so the timestamps have to be rebuilt or the first cache hit throws.
  private reviveDates(post: Post): Post {
    return {
      ...post,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      createdAt: new Date(post.createdAt),
      updatedAt: new Date(post.updatedAt),
    };
  }

  private slugKey(slug: string): string {
    return CacheKey.join('post', slug);
  }
}
