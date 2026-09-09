import { DeepMocked } from '@golevelup/ts-vitest';
import { DataSource, EntityManager } from 'typeorm';

import { createMockDataSource, createMockEntityManager } from '@test/helpers';

import { DatabaseService } from './database.service';

describe('DatabaseService', () => {
  let manager: EntityManager;
  let dataSource: DeepMocked<DataSource>;
  let service: DatabaseService;

  beforeEach(() => {
    manager = createMockEntityManager();
    dataSource = createMockDataSource(manager);
    service = new DatabaseService(dataSource);
  });

  describe('runInTransaction', () => {
    it('runs the handler with the entity manager under the default isolation level', async () => {
      const handler = vi.fn().mockResolvedValue('committed');

      await expect(service.runInTransaction(handler)).resolves.toBe('committed');
      expect(handler).toHaveBeenCalledWith(manager);
      expect(dataSource.transaction).toHaveBeenCalledWith(handler);
    });

    it('propagates errors thrown by the handler', async () => {
      const failure = new Error('rolled back');
      const handler = vi.fn().mockRejectedValue(failure);

      await expect(service.runInTransaction(handler)).rejects.toBe(failure);
    });
  });

  describe('runInReadSnapshot', () => {
    it('pins a REPEATABLE READ snapshot for the handler and returns its result', async () => {
      const handler = vi.fn().mockResolvedValue('snapshot');

      await expect(service.runInReadSnapshot(handler)).resolves.toBe('snapshot');
      expect(handler).toHaveBeenCalledWith(manager);
      expect(dataSource.transaction).toHaveBeenCalledWith('REPEATABLE READ', handler);
    });
  });
});
