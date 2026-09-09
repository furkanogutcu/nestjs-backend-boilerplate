import { RedisService } from './redis.service';

describe('RedisService', () => {
  let service: RedisService;

  afterEach(async () => {
    await service.onApplicationShutdown();
  });

  it('configures the general client to fail fast when Redis is unreachable (no offline queue)', () => {
    service = new RedisService();

    expect(service.getClient().options.enableOfflineQueue).toBe(false);
  });

  it('leaves the BullMQ client on the default offline queue', () => {
    service = new RedisService();

    expect(service.getBullConnection().options.enableOfflineQueue).not.toBe(false);
  });
});
