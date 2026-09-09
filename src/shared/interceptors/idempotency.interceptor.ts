import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Request } from 'express';
import { firstValueFrom, from, Observable } from 'rxjs';

import { IDEMPOTENCY_LOCK_TTL_SECONDS } from '@infrastructure/idempotency/idempotency.constant';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';

import { IDEMPOTENT_KEY, IIdempotentOptions } from '../decorators/idempotent.decorator';
import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';
import { AppBadRequestException } from '../exceptions/bad-request.exception';
import { ExceptionCode } from '../exceptions/enums/exception-code.enum';
import { AppInternalException } from '../exceptions/internal.exception';
import { validateIdempotencyKey } from '../utils/idempotency-key.util';
import { parseClientIp } from '../utils/ip.util';
import { stableStringify } from '../utils/stable-stringify.util';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<IIdempotentOptions | undefined>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKey = this.singleHeader(request.headers['idempotency-key']);

    if (idempotencyKey === undefined) {
      if (options.required) {
        throw new AppBadRequestException({
          message: 'This endpoint requires an Idempotency-Key header.',
          code: ExceptionCode.IdempotencyKeyRequired,
        });
      }

      return next.handle();
    }

    validateIdempotencyKey({ value: idempotencyKey, principalSource: options.principalSource });

    const principal = this.resolvePrincipal({ request, source: options.principalSource });
    // ! `params` must stay in the fingerprint: without it two resources on a body-less :id route share one entry.
    const fingerprint = createHash('sha256')
      .update(
        stableStringify({
          params: request.params ?? null,
          body: request.body ?? null,
          query: request.query ?? null,
        }),
      )
      .digest('hex');

    return from(
      this.idempotencyService.execute({
        scope: options.scope,
        principal,
        key: idempotencyKey,
        fingerprint,
        lockTtlSeconds: IDEMPOTENCY_LOCK_TTL_SECONDS,
        responseTtlSeconds: options.responseTtlSeconds,
        compute: async () => await firstValueFrom(next.handle()),
      }),
    );
  }

  private resolvePrincipal({ request, source }: { request: Request; source: IdempotencyPrincipalSource }): string {
    if (source === IdempotencyPrincipalSource.Anonymous) {
      // ! Bind the shared anonymous namespace to IP+UA, or a colliding key returns another client's token pair.
      const ip = parseClientIp({ req: request });
      const userAgent = request.headers['user-agent'] ?? '';

      return createHash('sha256').update(`${ip}:${userAgent}`).digest('hex');
    }

    const userId = request.user?.id;

    if (!userId) {
      throw new AppInternalException({
        message: 'Idempotent user-scoped route requires an authenticated user on the request.',
      });
    }

    return userId;
  }

  private singleHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}
