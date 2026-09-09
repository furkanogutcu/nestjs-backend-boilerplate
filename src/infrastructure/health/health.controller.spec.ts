import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { HttpStatus, Logger } from '@nestjs/common';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Response } from 'express';

import { ClockService } from '@infrastructure/clock/clock.service';
import { ShutdownStateService } from '@infrastructure/lifecycle/shutdown-state.service';
import { createMockResponse } from '@test/helpers';

import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health-indicator';

describe('HealthController', () => {
  let healthCheckService: DeepMocked<HealthCheckService>;
  let databaseIndicator: DeepMocked<TypeOrmHealthIndicator>;
  let redisIndicator: DeepMocked<RedisHealthIndicator>;
  let shutdownState: ShutdownStateService;
  let clock: DeepMocked<ClockService>;
  let controller: HealthController;
  let response: DeepMocked<Response>;
  let now: number;

  beforeEach(() => {
    healthCheckService = createMock<HealthCheckService>();
    databaseIndicator = createMock<TypeOrmHealthIndicator>();
    redisIndicator = createMock<RedisHealthIndicator>();
    shutdownState = new ShutdownStateService();
    clock = createMock<ClockService>();
    now = 1000;
    clock.epochMillis.mockImplementation(() => now);
    controller = new HealthController(healthCheckService, databaseIndicator, redisIndicator, shutdownState, clock);
    response = createMockResponse();
  });

  describe('liveness', () => {
    it('responds 200 with an ok status', () => {
      controller.liveness(response);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(response.json).toHaveBeenCalledWith({ status: 'ok' });
    });
  });

  describe('readiness while draining', () => {
    it('reports unavailable once the drain has begun', async () => {
      shutdownState.beginDrain();

      await controller.readiness(response);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(response.json).toHaveBeenCalledWith({ status: 'error' });
    });

    it('does not run the dependency checks at all while draining', async () => {
      shutdownState.beginDrain();

      await controller.readiness(response);

      expect(healthCheckService.check).not.toHaveBeenCalled();
    });

    it('ignores a cached healthy result so the balancer stops routing immediately', async () => {
      healthCheckService.check.mockResolvedValue({} as HealthCheckResult);

      await controller.readiness(response);
      expect(response.status).toHaveBeenLastCalledWith(HttpStatus.OK);

      shutdownState.beginDrain();
      await controller.readiness(response);

      expect(response.status).toHaveBeenLastCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });
  });

  describe('readiness', () => {
    it('checks the database and redis and responds 200 when healthy', async () => {
      healthCheckService.check.mockImplementation(async (indicators: HealthIndicatorFunction[]) => {
        await Promise.all(indicators.map(async (indicator) => await indicator()));

        return {} as HealthCheckResult;
      });

      await controller.readiness(response);

      expect(databaseIndicator.pingCheck).toHaveBeenCalledWith('database');
      expect(redisIndicator.isHealthy).toHaveBeenCalledWith('redis');
      expect(response.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(response.json).toHaveBeenCalledWith({ status: 'ok' });
    });

    it('responds 503 and warns when a check fails with an Error', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      healthCheckService.check.mockRejectedValue(new Error('database down'));

      await controller.readiness(response);

      expect(warn).toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(response.json).toHaveBeenCalledWith({ status: 'error' });
    });

    it('responds 503 for a non-Error failure', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      healthCheckService.check.mockRejectedValue('boom');

      await controller.readiness(response);

      expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      expect(response.json).toHaveBeenCalledWith({ status: 'error' });
    });

    it('serves a cached result within the TTL without re-running the check', async () => {
      healthCheckService.check.mockResolvedValue({} as HealthCheckResult);

      await controller.readiness(response);
      now = 2500;
      const cachedResponse = createMockResponse();
      await controller.readiness(cachedResponse);

      expect(healthCheckService.check).toHaveBeenCalledTimes(1);
      expect(cachedResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(cachedResponse.json).toHaveBeenCalledWith({ status: 'ok' });
    });

    it('re-runs the check once the cache TTL has elapsed', async () => {
      healthCheckService.check.mockResolvedValue({} as HealthCheckResult);

      await controller.readiness(response);
      now = 3000;
      await controller.readiness(createMockResponse());

      expect(healthCheckService.check).toHaveBeenCalledTimes(2);
    });

    it('shares a single check across concurrent readiness calls', async () => {
      let resolveCheck!: (value: HealthCheckResult) => void;
      healthCheckService.check.mockReturnValue(
        new Promise<HealthCheckResult>((resolve) => {
          resolveCheck = resolve;
        }),
      );

      const first = controller.readiness(createMockResponse());
      const second = controller.readiness(createMockResponse());
      resolveCheck({} as HealthCheckResult);
      await Promise.all([first, second]);

      expect(healthCheckService.check).toHaveBeenCalledTimes(1);
    });

    it('refreshes a cached unhealthy result to healthy after the TTL', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      healthCheckService.check
        .mockRejectedValueOnce(new Error('database down'))
        .mockResolvedValueOnce({} as HealthCheckResult);

      const downResponse = createMockResponse();
      await controller.readiness(downResponse);
      expect(downResponse.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);

      now = 3500;
      const upResponse = createMockResponse();
      await controller.readiness(upResponse);

      expect(upResponse.status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(healthCheckService.check).toHaveBeenCalledTimes(2);
    });
  });
});
