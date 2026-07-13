import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { Server } from 'socket.io';

import { appConfig } from '@config/app.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';

import { RealtimeMetricsService } from '../observability/realtime-metrics.service';
import { RedisIoAdapter } from './redis-io.adapter';

type AllowRequestFn = (req: unknown, callback: (err: string | null | undefined, success: boolean) => void) => void;

jest.mock('ioredis', () => ({ Redis: jest.fn() }));
jest.mock('@socket.io/redis-adapter', () => ({ createAdapter: jest.fn() }));

// * The adapter is `new`ed in main.ts (outside DI), wraps the Nest IoAdapter and owns two raw ioredis connections.
// * These verify the two behaviours that carry real risk: the pub/sub pair is wired into socket.io under the app's
// * realtime key prefix (a dropped key would let two apps' rooms collide on the same Redis), and the graceful
// * shutdown quits both connections yet still tears the http server down even when a quit rejects (the allSettled
// * contract — a Promise.all here would leak the http server on an already-closed connection). ioredis, the redis
// * adapter factory and the IoAdapter superclass are mocked, so no real Redis or socket bind happens.
describe('RedisIoAdapter', () => {
  let adapter: RedisIoAdapter;
  let mockServer: { adapter: jest.Mock };
  let pubOn: jest.Mock;
  let pubQuit: jest.Mock;
  let subQuit: jest.Mock;
  let duplicate: jest.Mock;
  let pubClient: Redis;
  let subClient: Redis;
  let superCreateIOServer: jest.SpyInstance;
  let superClose: jest.SpyInstance;
  let loggerError: jest.SpyInstance;
  let rateLimitService: DeepMocked<RateLimitService>;
  let metrics: DeepMocked<RealtimeMetricsService>;

  beforeEach(() => {
    pubOn = jest.fn();
    pubQuit = jest.fn().mockResolvedValue('OK');
    subQuit = jest.fn().mockResolvedValue('OK');
    subClient = { on: jest.fn(), quit: subQuit } as unknown as Redis;
    duplicate = jest.fn().mockReturnValue(subClient);
    pubClient = { on: pubOn, quit: pubQuit, duplicate } as unknown as Redis;
    (Redis as unknown as jest.Mock).mockImplementation(() => pubClient);

    mockServer = { adapter: jest.fn() };
    (createAdapter as unknown as jest.Mock).mockReturnValue('adapter-factory');

    superCreateIOServer = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue(mockServer);
    superClose = jest.spyOn(IoAdapter.prototype, 'close').mockResolvedValue(undefined);
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    rateLimitService = createMock<RateLimitService>();
    metrics = createMock<RealtimeMetricsService>();
    const appContext = createMock<INestApplicationContext>();
    (appContext.get as unknown as jest.Mock).mockImplementation((token: unknown) => {
      if (token === RateLimitService) return rateLimitService;
      if (token === RealtimeMetricsService) return metrics;
      if (token === HttpAdapterHost) return { httpAdapter: { getInstance: () => ({ get: () => undefined }) } };

      return createMock();
    });

    adapter = new RedisIoAdapter(appContext);
  });

  function captureAllowRequest(): AllowRequestFn {
    adapter.createIOServer(3000);
    const options = superCreateIOServer.mock.calls.at(-1)?.[1] as { allowRequest: AllowRequestFn };

    return options.allowRequest;
  }

  async function runAllowRequest(allowRequest: AllowRequestFn): Promise<[string | null | undefined, boolean]> {
    const request = { socket: { remoteAddress: '198.51.100.7' }, headers: {} };

    return await new Promise((resolve) => {
      // eslint-disable-next-line no-restricted-syntax -- allowRequest callback signature is fixed (err, success)
      allowRequest(request, (err, ok) => resolve([err, ok]));
    });
  }

  it('wires the socket.io server to a duplicated pub/sub pair under the realtime key prefix', () => {
    const server = adapter.createIOServer(3000);

    expect(superCreateIOServer).toHaveBeenCalledWith(
      3000,
      expect.objectContaining({ connectTimeout: expect.any(Number), allowRequest: expect.any(Function) }),
    );
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(createAdapter).toHaveBeenCalledWith(pubClient, subClient, { key: appConfig.redis.keyPrefixes.realtime });
    expect(mockServer.adapter).toHaveBeenCalledWith('adapter-factory');
    expect(server).toBe(mockServer);
  });

  it('records an adapter-error metric and logs when a redis client errors, rather than throwing', () => {
    adapter.createIOServer(3000);
    const [, errorHandler] = pubOn.mock.calls[0] as [string, (error: Error) => void];

    expect(() => errorHandler(new Error('boom'))).not.toThrow();
    expect(metrics.recordAdapterError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalled();
  });

  describe('engine allowRequest gate (pre-allocation per-IP flood control)', () => {
    it('allows a request within the per-IP budget', async () => {
      rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>());

      await expect(runAllowRequest(captureAllowRequest())).resolves.toEqual([null, true]);
    });

    it("rejects with 'rate_limited' when the per-IP budget is exceeded", async () => {
      rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes());

      await expect(runAllowRequest(captureAllowRequest())).resolves.toEqual(['rate_limited', false]);
      expect(metrics.recordHandshake).toHaveBeenCalledWith({ outcome: 'rejected', reason: 'rate_limited' });
    });

    it('fails open (allows) when the limiter infrastructure errors', async () => {
      rateLimitService.consumeByKey.mockRejectedValue(new Error('redis down'));

      await expect(runAllowRequest(captureAllowRequest())).resolves.toEqual([null, true]);
    });
  });

  it('quits both redis clients and still closes the server when a quit rejects', async () => {
    pubQuit.mockRejectedValue(new Error('connection already closed'));
    adapter.createIOServer(3000);
    const server = {} as Server;

    await adapter.close(server);

    expect(pubQuit).toHaveBeenCalledTimes(1);
    expect(subQuit).toHaveBeenCalledTimes(1);
    expect(superClose).toHaveBeenCalledWith(server);
  });

  it('closes cleanly when no server was ever created (no clients to quit)', async () => {
    const server = {} as Server;

    await expect(adapter.close(server)).resolves.toBeUndefined();
    expect(pubQuit).not.toHaveBeenCalled();
    expect(superClose).toHaveBeenCalledWith(server);
  });
});
