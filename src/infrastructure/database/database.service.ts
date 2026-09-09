import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async runInTransaction<T>(handler: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.dataSource.transaction(handler);
  }

  async runInReadSnapshot<T>(handler: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.dataSource.transaction('REPEATABLE READ', handler);
  }
}
