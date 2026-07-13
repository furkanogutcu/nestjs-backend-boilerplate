import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';

import { ipRateLimitConfig } from '@config/rate-limit.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { RateLimitingResponseHeadersKey } from '@shared/enums/rate-limit.enum';

import { AppTooManyRequestException } from '../exceptions/too-many-request.exception';

@Injectable()
export class IpRateLimiterGuard implements CanActivate {
  constructor(private readonly rateLimitService: RateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    const response: Response = context.switchToHttp().getResponse();

    try {
      await this.rateLimitService.consumeByKey({ options: ipRateLimitConfig, key: request.context.ipAddress });

      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        this.setBlockedHeaders({ response, msBeforeNext: error.msBeforeNext });

        throw new AppTooManyRequestException();
      }

      throw error;
    }
  }

  private setBlockedHeaders({ response, msBeforeNext }: { response: Response; msBeforeNext: number }): void {
    if (!response) {
      return;
    }

    const retryAfterSeconds = Math.ceil(msBeforeNext / 1000);

    response.setHeader(RateLimitingResponseHeadersKey.Limit, ipRateLimitConfig.points);
    response.setHeader(RateLimitingResponseHeadersKey.Remaining, 0);
    response.setHeader(RateLimitingResponseHeadersKey.Reset, retryAfterSeconds);
    response.setHeader(RateLimitingResponseHeadersKey.RetryAfter, retryAfterSeconds);
  }
}
