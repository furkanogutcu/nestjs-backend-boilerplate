import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { appDataSourceOptions } from '@database/typeorm.data-source';

import { DatabaseService } from './database.service';

@Module({
  imports: [TypeOrmModule.forRoot(appDataSourceOptions)],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
