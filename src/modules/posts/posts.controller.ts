import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post as HttpPost,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FindOptionsWhere } from 'typeorm';

import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Idempotent } from '@shared/decorators/idempotent.decorator';
import { OffsetPagination } from '@shared/decorators/offset-pagination.decorator';
import { Public } from '@shared/decorators/public.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import type { SearchParams } from '@shared/decorators/search.decorator';
import { Search } from '@shared/decorators/search.decorator';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import type { OffsetPaginationParams } from '@shared/schemas/offset-pagination.schema';

import { Post } from './entities/post.entity';
import type { CreatePostRequest, UpdatePostRequest } from './schemas/post.request';
import {
  CoverUploadResponse,
  coverUploadResponseSchema,
  PostResponse,
  postResponseSchema,
} from './schemas/post.response';
import { PostsService } from './services/posts.service';

// * The worked example for a domain module — see ARCHITECTURE "Domain module template".
@ApiTags('Posts')
@Controller()
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get('posts')
  @Public()
  @ApiOperation({ summary: 'List published posts', description: 'Public, paginated, searchable by title or slug.' })
  @ResponseDto({
    schema: postResponseSchema,
    offsetPaginated: true,
    description: 'A page of published posts.',
  })
  async list(
    @OffsetPagination() pagination: OffsetPaginationParams,
    @Search<Post>(['title', 'slug']) search: SearchParams<Post>,
  ): Promise<OffsetPaginated<PostResponse>> {
    const page = await this.postsService.listPublished({
      skip: pagination.skip,
      take: pagination.take,
      search: search as FindOptionsWhere<Post>[] | undefined,
    });

    return new OffsetPaginated(
      page.items.map((post) => this.toResponse(post)),
      page.meta,
    );
  }

  @Get('posts/:slug')
  @Public()
  @ApiOperation({ summary: 'Get a published post', description: 'Public and cached; drafts are not reachable here.' })
  @ResponseDto({
    schema: postResponseSchema,
    description: 'The published post.',
    errors: [HttpStatus.NOT_FOUND],
  })
  async getBySlug(@Param('slug') slug: string): Promise<PostResponse> {
    return this.toResponse(await this.postsService.getPublishedBySlug({ slug }));
  }

  @Get('me/posts')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my posts', description: 'Everything the caller wrote, drafts included.' })
  @ResponseDto({
    schema: postResponseSchema,
    offsetPaginated: true,
    description: 'A page of the caller’s posts.',
    errors: [HttpStatus.UNAUTHORIZED],
  })
  async listOwn(
    @CurrentUser() user: { id: string },
    @OffsetPagination() pagination: OffsetPaginationParams,
  ): Promise<OffsetPaginated<PostResponse>> {
    const page = await this.postsService.listOwn({
      authorId: user.id,
      skip: pagination.skip,
      take: pagination.take,
    });

    return new OffsetPaginated(
      page.items.map((post) => this.toResponse(post)),
      page.meta,
    );
  }

  @HttpPost('posts')
  @ApiBearerAuth()
  @Idempotent({ scope: 'posts:create', responseTtlSeconds: 600 })
  @ApiOperation({
    summary: 'Create a draft',
    description: 'Idempotent via Idempotency-Key: a retried create returns the first result instead of a duplicate.',
  })
  @ResponseDto({
    schema: postResponseSchema,
    status: HttpStatus.CREATED,
    description: 'The created draft.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.CONFLICT],
  })
  async create(@CurrentUser() user: { id: string }, @Body() body: CreatePostRequest): Promise<PostResponse> {
    return this.toResponse(
      await this.postsService.create({ authorId: user.id, slug: body.slug, title: body.title, body: body.body }),
    );
  }

  @Patch('posts/:postId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a post', description: 'Only the author can edit.' })
  @ResponseDto({
    schema: postResponseSchema,
    description: 'The updated post.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND],
  })
  async update(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: { id: string },
    @Body() body: UpdatePostRequest,
  ): Promise<PostResponse> {
    return this.toResponse(
      await this.postsService.update({ postId, authorId: user.id, title: body.title, body: body.body }),
    );
  }

  @HttpPost('posts/:postId/publication')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Publish a post', description: 'Makes a draft publicly readable.' })
  @ResponseDto({
    schema: postResponseSchema,
    description: 'The published post.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT],
  })
  async publish(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: { id: string },
  ): Promise<PostResponse> {
    return this.toResponse(await this.postsService.publish({ postId, authorId: user.id }));
  }

  @HttpPost('posts/:postId/cover-upload')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get a signed cover upload URL',
    description: 'The client PUTs the image straight to storage; the server never handles the bytes.',
  })
  @ResponseDto({
    schema: coverUploadResponseSchema,
    description: 'A short-lived signed upload URL.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.BAD_REQUEST],
  })
  async coverUpload(
    @Param('postId', ParseUUIDPipe) postId: string,
    @CurrentUser() user: { id: string },
  ): Promise<CoverUploadResponse> {
    const signed = await this.postsService.createCoverUpload({ postId, authorId: user.id });

    return {
      url: signed.url,
      key: signed.key,
      expires_in_seconds: signed.expiresInSeconds,
      required_headers: signed.requiredHeaders,
    };
  }

  @Delete('posts/:postId')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a post', description: 'Only the author can delete.' })
  async remove(@Param('postId', ParseUUIDPipe) postId: string, @CurrentUser() user: { id: string }): Promise<void> {
    await this.postsService.remove({ postId, authorId: user.id });
  }

  private toResponse(post: Post): PostResponse {
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      body: post.body,
      cover_image_url: this.postsService.coverUrl({ post }),
      published_at: post.publishedAt?.toISOString() ?? null,
      author_id: post.authorId,
      created_at: post.createdAt.toISOString(),
    };
  }
}
