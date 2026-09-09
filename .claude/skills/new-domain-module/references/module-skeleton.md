# Module skeleton (copy-paste)

Example domain: `articles` (plain CRUD — adapt it to your own domain). The file layout follows `ARCHITECTURE.md`
"Domain module template". Fields are `snake_case` on the wire, `camelCase` internally. Table names are **plural**.

```
src/modules/articles/
├─ articles.module.ts
├─ articles.controller.ts
├─ articles.service.ts
├─ articles.repository.ts
├─ entities/article.entity.ts
└─ schemas/
   ├─ create-article.request.ts
   ├─ update-article.request.ts
   └─ article.response.ts
```

## entities/article.entity.ts

```ts
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('articles')
export class Article {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  title!: string;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
```

> If you need a time-series table, apply the TimescaleDB hypertable convention from the `db-migration` skill
> instead of the default entity. DB column naming is automatic via `SnakeNamingStrategy` (`createdAt` → `created_at`).

## schemas/create-article.request.ts

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createArticleSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(1),
  })
  .strict();

export class CreateArticleRequest extends createZodDto(createArticleSchema) {}
```

## schemas/update-article.request.ts

```ts
import { createZodDto } from 'nestjs-zod';

import { createArticleSchema } from './create-article.request';

export const updateArticleSchema = createArticleSchema.partial();

export class UpdateArticleRequest extends createZodDto(updateArticleSchema) {}
```

## schemas/article.response.ts

The wire contract is snake_case. Put `.describe()` on every field (OpenAPI is generated from it) and
`.meta({ example })` where an example helps — not a comment.

```ts
import { z } from 'zod';

export const articleResponseSchema = z.object({
  id: z.uuid().describe('Article id'),
  title: z.string().describe('Article title'),
  content: z.string().describe('Article body'),
  created_at: z.iso.datetime().describe('Creation timestamp (ISO-8601)'),
});

export type ArticleResponse = z.infer<typeof articleResponseSchema>;
```

## articles.repository.ts

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { Article } from './entities/article.entity';

@Injectable()
export class ArticlesRepository extends Repository<Article> {
  constructor(dataSource: DataSource) {
    super(Article, dataSource.createEntityManager());
  }
}
```

> Because you extend `Repository`, `listWithOffsetPagination` / `listWithCursorPagination` (the TypeORM augment,
> `src/database/extensions/`) come ready on this class.

## articles.service.ts

```ts
import { Injectable } from '@nestjs/common';
import { FindOptionsOrder } from 'typeorm';

import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import { generateUuid } from '@shared/utils/uuid.util';

import { CreateArticleRequest } from './schemas/create-article.request';
import { Article } from './entities/article.entity';
import { ArticlesRepository } from './articles.repository';

@Injectable()
export class ArticlesService {
  constructor(private readonly articlesRepository: ArticlesRepository) {}

  async create(body: CreateArticleRequest): Promise<Article> {
    const article = this.articlesRepository.create({ id: generateUuid(), ...body });

    return await this.articlesRepository.save(article);
  }

  async findById(id: string): Promise<Article> {
    const article = await this.articlesRepository.findOne({ where: { id } });

    if (!article) {
      throw new AppNotFoundException({ resourceName: 'Article' });
    }

    return article;
  }

  async list({
    skip,
    take,
    order,
  }: {
    skip: number;
    take: number;
    order?: FindOptionsOrder<Article>;
  }): Promise<OffsetPaginated<Article>> {
    return await this.articlesRepository.listWithOffsetPagination({ skip, take, order });
  }
}
```

## articles.controller.ts

```ts
import { Body, Controller, Get, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { OffsetPagination } from '@shared/decorators/offset-pagination.decorator';
import { OrderBy, OrderByParam } from '@shared/decorators/order-by.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import { ApiOffsetPaginationQuery, ApiOrderByQuery } from '@shared/swagger/api-query.decorators';

import { CreateArticleRequest } from './schemas/create-article.request';
import { articleResponseSchema } from './schemas/article.response';
import { Article } from './entities/article.entity';
import { ArticlesService } from './articles.service';

@ApiTags('Articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Post()
  @ApiOperation({ summary: 'Create an article' })
  @ResponseDto({ schema: articleResponseSchema, status: HttpStatus.CREATED, errors: [HttpStatus.BAD_REQUEST] })
  async create(@Body() body: CreateArticleRequest): Promise<Article> {
    return await this.articlesService.create(body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an article by id' })
  @ResponseDto({ schema: articleResponseSchema, errors: [HttpStatus.NOT_FOUND] })
  async findById(@Param('id') id: string): Promise<Article> {
    return await this.articlesService.findById(id);
  }

  @Get()
  @ApiOperation({ summary: 'List articles' })
  @ResponseDto({ schema: articleResponseSchema, offsetPaginated: true })
  @ApiOffsetPaginationQuery()
  @ApiOrderByQuery(['createdAt', 'title'])
  async list(
    @OffsetPagination() pagination: { skip: number; take: number },
    @OrderBy<Article>(['createdAt', 'title']) order: OrderByParam<Article>,
  ) {
    return await this.articlesService.list({ ...pagination, order });
  }
}
```

> `ResponseInterceptor` serializes the returned entity per `articleResponseSchema` and wraps it in the `{ data }` /
> `{ data, meta }` envelope — the controller returns a plain entity/relation, do not build the envelope by hand.

## articles.module.ts

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Article } from './entities/article.entity';
import { ArticlesController } from './articles.controller';
import { ArticlesRepository } from './articles.repository';
import { ArticlesService } from './articles.service';

@Module({
  imports: [TypeOrmModule.forFeature([Article])],
  controllers: [ArticlesController],
  providers: [ArticlesService, ArticlesRepository],
  exports: [ArticlesService],
})
export class ArticlesModule {}
```

Finally, add the module to the aggregator (`ArticlesModule` in `src/app.module.ts`'s `imports`), generate the
migration (`pnpm db:migration:generate create-articles`), run `pnpm docs:generate`, and write the tests.
