import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';

const DEFAULT_CACHE_CONTROL = 'no-store';

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // * Deny-by-default: every response is non-cacheable unless a handler later overrides Cache-Control
    // * (e.g. the catalog's ETag routes). Set in the pre-phase so it also lands on thrown errors and on
    // * idempotency replays that short-circuit the handler. The header survives because handler/inner
    // * interceptors run afterwards and only the few cacheable routes call setHeader again.
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', DEFAULT_CACHE_CONTROL);

    return next.handle();
  }
}
