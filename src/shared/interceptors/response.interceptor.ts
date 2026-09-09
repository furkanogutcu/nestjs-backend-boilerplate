import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { ZodType } from 'zod';

import { RESPONSE_SCHEMA } from '../decorators/response-dto.decorator';
import { AppInternalException } from '../exceptions/internal.exception';
import { CursorPaginated } from '../responses/cursor-paginated.response';
import { MessageResponse } from '../responses/message.response';
import { OffsetPaginated } from '../responses/offset-paginated.response';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.getAllAndOverride<ZodType | undefined>(RESPONSE_SCHEMA, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(map((payload: unknown) => this.toEnvelope({ payload, schema })));
  }

  private toEnvelope(params: { payload: unknown; schema?: ZodType }): unknown {
    const { payload, schema } = params;

    if (payload === undefined) {
      return undefined;
    }

    if (payload instanceof MessageResponse) {
      return { message: payload.message };
    }

    if (!schema) {
      throw new AppInternalException({
        message: 'Response schema is required for non-empty API responses',
      });
    }

    if (payload instanceof OffsetPaginated || payload instanceof CursorPaginated) {
      return { data: this.serialize({ data: payload.items, schema }), meta: payload.meta };
    }

    return { data: this.serialize({ data: payload, schema }) };
  }

  private serialize(params: { data: unknown; schema: ZodType }): unknown {
    const { data, schema } = params;

    try {
      return Array.isArray(data) ? data.map((item) => schema.parse(item)) : schema.parse(data);
    } catch (error) {
      throw new AppInternalException({
        message: 'Response does not match its schema',
        error: error instanceof Error ? error : undefined,
      });
    }
  }
}
