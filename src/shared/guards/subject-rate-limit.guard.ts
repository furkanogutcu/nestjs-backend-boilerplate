import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';

import { subjectRateLimitConfig } from '@config/rate-limit.config';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { RateLimitingResponseHeadersKey } from '@shared/enums/rate-limit.enum';

import { SUBJECT_RATE_LIMIT_KEY } from '../decorators/subject-rate-limit.decorator';
import { AppTooManyRequestException } from '../exceptions/too-many-request.exception';
import { RateLimitContext, SubjectRateLimitPolicy } from '../interfaces/rate-limit-rule.interface';
import { ISubjectRateLimitRule } from '../interfaces/rate-limit-rule.interface';

@Injectable()
export class SubjectRateLimiterGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let rule = this.reflector.getAllAndOverride<ISubjectRateLimitRule>(SUBJECT_RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (rule?.policy === SubjectRateLimitPolicy.Off) {
      return true;
    }

    if (!rule) {
      rule = {
        policy: SubjectRateLimitPolicy.Standard,
        options: subjectRateLimitConfig[SubjectRateLimitPolicy.Standard],
      };
    }

    const request: Request = context.switchToHttp().getRequest();
    const response: Response = context.switchToHttp().getResponse();

    const rateLimitContext = this.buildRateLimitContext(request);

    try {
      const { consumedPoints, msBeforeNext } = await this.rateLimitService.consume({
        options: rule.options,
        rateLimitContext,
      });

      if (response) {
        const { points } = rule.options;

        this.setRateLimitHeaders({ response, points, consumedPoints, msBeforeNext });
      }

      return true;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        this.setRateLimitHeaders({
          response,
          points: rule.options.points,
          consumedPoints: rule.options.points,
          msBeforeNext: error.msBeforeNext,
          retryAfter: Math.ceil(error.msBeforeNext / 1000),
        });

        throw new AppTooManyRequestException();
      }

      throw error;
    }
  }

  private buildRateLimitContext(request: Request): RateLimitContext {
    return {
      request: {
        ip_address: request.context.ipAddress,
        path: request.path || request.url,
        method: request.method,
        user_id: request.user?.id,
      },
    };
  }

  private setRateLimitHeaders({
    response,
    points,
    consumedPoints,
    msBeforeNext,
    retryAfter,
  }: {
    response: Response;
    points: number;
    consumedPoints: number;
    msBeforeNext: number;
    retryAfter?: number;
  }): void {
    response.setHeader(RateLimitingResponseHeadersKey.Limit, points);
    response.setHeader(RateLimitingResponseHeadersKey.Remaining, Math.max(0, points - consumedPoints));
    response.setHeader(RateLimitingResponseHeadersKey.Reset, Math.ceil(msBeforeNext / 1000));

    if (retryAfter !== undefined) {
      response.setHeader(RateLimitingResponseHeadersKey.RetryAfter, retryAfter);
    }
  }
}
