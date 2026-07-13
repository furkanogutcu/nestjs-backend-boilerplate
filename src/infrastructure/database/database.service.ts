import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async runInTransaction<T>(handler: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.dataSource.transaction(handler);
  }

  // * Read-only snapshot transaction: REPEATABLE READ pins one consistent snapshot for a multi-statement read,
  // * so a concurrent commit between two reads cannot tear the result (e.g. a facility read post-settle but its
  // * lines pre-settle). Write paths use runInTransaction (default isolation) and lock the rows they mutate.
  async runInReadSnapshot<T>(handler: (manager: EntityManager) => Promise<T>): Promise<T> {
    return await this.dataSource.transaction('REPEATABLE READ', handler);
  }
}
