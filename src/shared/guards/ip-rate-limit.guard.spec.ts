import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { ExecutionContext } from '@nestjs/common';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';

import { ipRateLimitConfig } from '@config/rate-limit.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { RateLimitingResponseHeadersKey } from '@shared/enums/rate-limit.enum';
import { createMockExecutionContext, createMockRequest, createMockResponse } from '@test/helpers';

import { AppTooManyRequestException } from '../exceptions/too-many-request.exception';
import { IpRateLimiterGuard } from './ip-rate-limit.guard';

describe('IpRateLimiterGuard', () => {
  let rateLimitService: DeepMocked<RateLimitService>;
  let response: DeepMocked<Response>;
  let guard: IpRateLimiterGuard;

  function contextWith(): ReturnType<typeof createMockExecutionContext> {
    const request = createMockRequest({ method: 'POST', path: '/auth/logout' });
    request.context.ipAddress = '1.2.3.4';

    return createMockExecutionContext({ request, response });
  }

  beforeEach(() => {
    rateLimitService = createMock<RateLimitService>();
    response = createMockResponse();
    guard = new IpRateLimiterGuard(rateLimitService);
  });

  it('consumes a per-IP budget keyed by ip alone and allows the request on success', async () => {
    rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>({ msBeforeNext: 1000 }));

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
    expect(rateLimitService.consumeByKey).toHaveBeenCalledWith({ options: ipRateLimitConfig, key: '1.2.3.4' });
  });

  it('does not set RateLimit headers on success so the subject layer owns them', async () => {
    rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>({ msBeforeNext: 1000 }));

    await guard.canActivate(contextWith());

    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('sets Retry-After and throws when the per-IP budget is exceeded', async () => {
    rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes(0, 5000, ipRateLimitConfig.points));

    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(AppTooManyRequestException);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Limit', ipRateLimitConfig.points);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', 0);
    expect(response.setHeader).toHaveBeenCalledWith(RateLimitingResponseHeadersKey.Reset, 5);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 5);
  });

  it('still throws when the budget is exceeded but no HTTP response is available, without crashing on headers', async () => {
    rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes(0, 5000, ipRateLimitConfig.points));

    const request = createMockRequest({ method: 'POST', path: '/auth/logout' });
    request.context.ipAddress = '1.2.3.4';
    const httpHost = createMock<HttpArgumentsHost>();
    httpHost.getRequest.mockReturnValue(request);
    httpHost.getResponse.mockReturnValue(undefined);
    const context = createMock<ExecutionContext>();
    context.switchToHttp.mockReturnValue(httpHost);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(AppTooManyRequestException);
  });

  it('rethrows unexpected errors from the rate-limit service', async () => {
    const failure = new Error('redis unavailable');
    rateLimitService.consumeByKey.mockRejectedValue(failure);

    await expect(guard.canActivate(contextWith())).rejects.toBe(failure);
  });
});
