import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';
import { AppBadRequestException } from './bad-request.exception';
import { ExceptionCode } from './enums/exception-code.enum';
import { AppForbiddenException } from './forbidden.exception';
import { AppIdempotencyInProgressException } from './idempotency-in-progress.exception';
import { AppServiceUnavailableException } from './service-unavailable.exception';
import { AppTooManyRequestException } from './too-many-request.exception';
import { AppUnauthorizedException } from './unauthorized.exception';
import { AppUnprocessableEntityException } from './unprocessable-entity.exception';

type SimpleExceptionCtor = new (args?: { message?: string; code?: string }) => AppException<unknown>;

type SimpleExceptionCase = {
  name: string;
  Ctor: SimpleExceptionCtor;
  httpCode: HttpStatus;
  code: ExceptionCode;
  message: string;
};

const cases: SimpleExceptionCase[] = [
  {
    name: 'AppBadRequestException',
    Ctor: AppBadRequestException,
    httpCode: HttpStatus.BAD_REQUEST,
    code: ExceptionCode.BadRequest,
    message: 'Bad request.',
  },
  {
    name: 'AppUnauthorizedException',
    Ctor: AppUnauthorizedException,
    httpCode: HttpStatus.UNAUTHORIZED,
    code: ExceptionCode.Unauthorized,
    message: 'Access denied.',
  },
  {
    name: 'AppForbiddenException',
    Ctor: AppForbiddenException,
    httpCode: HttpStatus.FORBIDDEN,
    code: ExceptionCode.InsufficientPermissions,
    message: 'You do not have permission to access this resource.',
  },
  {
    name: 'AppUnprocessableEntityException',
    Ctor: AppUnprocessableEntityException,
    httpCode: HttpStatus.UNPROCESSABLE_ENTITY,
    code: ExceptionCode.UnprocessableEntity,
    message: 'Unprocessable entity.',
  },
  {
    name: 'AppTooManyRequestException',
    Ctor: AppTooManyRequestException,
    httpCode: HttpStatus.TOO_MANY_REQUESTS,
    code: ExceptionCode.RateLimit,
    message: 'You have exceeded the number of allowed requests. Please try again later.',
  },
  {
    name: 'AppServiceUnavailableException',
    Ctor: AppServiceUnavailableException,
    httpCode: HttpStatus.SERVICE_UNAVAILABLE,
    code: ExceptionCode.ServiceUnavailable,
    message: 'Service temporarily unavailable.',
  },
  {
    name: 'AppIdempotencyInProgressException',
    Ctor: AppIdempotencyInProgressException,
    httpCode: HttpStatus.CONFLICT,
    code: ExceptionCode.IdempotencyRequestInProgress,
    message: 'A request with this idempotency key is already being processed.',
  },
];

describe.each(cases)('$name', ({ Ctor, httpCode, code, message }) => {
  it('uses its documented defaults', () => {
    const exception = new Ctor();

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.httpCode).toBe(httpCode);
    expect(exception.code).toBe(code);
    expect(exception.message).toBe(message);
  });

  it('allows overriding the message and code', () => {
    const exception = new Ctor({ message: 'Custom message', code: 'custom_code' });

    expect(exception.message).toBe('Custom message');
    expect(exception.code).toBe('custom_code');
    expect(exception.httpCode).toBe(httpCode);
  });

  it('serializes to the standard error envelope', () => {
    const exception = new Ctor();

    expect(exception.toJSON()).toEqual({ error: { code, message, details: undefined } });
  });
});
