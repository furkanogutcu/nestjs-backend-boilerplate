import { CallHandler, ExecutionContext, Injectable, NestInterceptor, UseInterceptors } from '@nestjs/common';
import { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

import { ClientType } from '../enums/client-type.enum';
import { setAuthCookies } from '../utils/auth-cookie.util';
import { resolveClientType } from '../utils/client-type.util';

interface IRefreshCarrier extends Record<string, unknown> {
  refresh_token?: string;
}

// * Applied to the token-issuing handlers. For a web client it moves the freshly issued refresh_token out of the
// * JSON body into an HttpOnly cookie (+ a CSRF cookie) so browser JS never touches it; mobile responses pass
// * through untouched (token stays in the body). Runs at the handler level, so it sees the raw snake_case payload
// * before the global response envelope wraps it — the response schema keeps refresh_token optional to allow its
// * absence for web.
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
