import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

const DEFAULT_CACHE_CONTROL = 'no-store';

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // * Deny-by-default in the pre-phase, so it lands on errors and idempotency replays too; cacheable routes override.
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', DEFAULT_CACHE_CONTROL);

    return next.handle();
  }
}
