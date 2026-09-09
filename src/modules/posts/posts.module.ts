import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AdminPostsController } from './admin-posts.controller';
import { Post } from './entities/post.entity';
import { PostsController } from './posts.controller';
import { PostsService } from './services/posts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Post])],
  controllers: [PostsController, AdminPostsController],
  providers: [PostsService],
})
export class PostsModule {}
