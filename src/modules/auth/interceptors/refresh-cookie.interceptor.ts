import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

import { ClientType } from '../enums/client-type.enum';
import { setAuthCookies } from '../utils/auth-cookie.util';
import { resolveClientType } from '../utils/client-type.util';

interface IRefreshCarrier extends Record<string, unknown> {
  refresh_token?: string;
}

// * Moves refresh_token from the body into an HttpOnly cookie for web clients; mobile responses pass through.
@Injectable()
export class RefreshCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const isWeb = resolveClientType(request) === ClientType.Web;

    return next.handle().pipe(
      map((payload: unknown) => {
        if (!isWeb || !isRefreshCarrier(payload) || !payload.refresh_token) {
          return payload;
        }

        setAuthCookies({ response, refreshToken: payload.refresh_token });
        const { refresh_token: _movedToCookie, ...rest } = payload;

        return rest;
      }),
    );
  }
}

function isRefreshCarrier(payload: unknown): payload is IRefreshCarrier {
  return typeof payload === 'object' && payload !== null && 'refresh_token' in payload;
}

export const RefreshCookie = (): MethodDecorator & ClassDecorator => UseInterceptors(RefreshCookieInterceptor);
