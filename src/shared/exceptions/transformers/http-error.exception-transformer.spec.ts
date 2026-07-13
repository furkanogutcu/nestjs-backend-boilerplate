import { HttpStatus } from '@nestjs/common';

import { AppException } from '../app.exception';
import { ExceptionCode } from '../enums/exception-code.enum';
import { HttpErrorExceptionTransformer } from './http-error.exception-transformer';

function httpError(overrides: Partial<{ statusCode: number; type: string; expose: boolean }>): Error {
  return Object.assign(new Error('http error'), {
    statusCode: 400,
    type: 'entity.parse.failed',
    expose: true,
    ...overrides,
  });
}

describe('HttpErrorExceptionTransformer', () => {
  it('maps a 400 body-parser error to bad_request', () => {
    const result = HttpErrorExceptionTransformer.transform(httpError({ statusCode: 400 }));

    expect(result).toBeInstanceOf(AppException);
    expect(result?.httpCode).toBe(HttpStatus.BAD_REQUEST);
    expect(result?.code).toBe(ExceptionCode.BadRequest);
    expect(result?.message).toBe('http error');
  });

  it('maps a 413 error to payload_too_large', () => {
    const result = HttpErrorExceptionTransformer.transform(httpError({ statusCode: 413 }));

    expect(result?.httpCode).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(result?.code).toBe(ExceptionCode.PayloadTooLarge);
  });

  it('maps a 415 error to unsupported_media_type', () => {
    const result = HttpErrorExceptionTransformer.transform(httpError({ statusCode: 415 }));

    expect(result?.httpCode).toBe(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    expect(result?.code).toBe(ExceptionCode.UnsupportedMediaType);
  });

  it('returns undefined for an http error with an unmapped status code', () => {
    expect(HttpErrorExceptionTransformer.transform(httpError({ statusCode: 418 }))).toBeUndefined();
  });

  it('returns undefined for a plain Error that is not an http error', () => {
    expect(HttpErrorExceptionTransformer.transform(new Error('plain'))).toBeUndefined();
  });

  it('returns undefined when expose is not true', () => {
    expect(HttpErrorExceptionTransformer.transform(httpError({ expose: false }))).toBeUndefined();
  });

  it('returns undefined when the type field is missing', () => {
    const error = Object.assign(new Error('no type'), { statusCode: 400, expose: true });

    expect(HttpErrorExceptionTransformer.transform(error)).toBeUndefined();
  });

  it('returns undefined when statusCode is not a number', () => {
    const error = Object.assign(new Error('bad status'), { statusCode: '400', type: 'x', expose: true });

    expect(HttpErrorExceptionTransformer.transform(error)).toBeUndefined();
  });

  it('returns undefined for a non-error value', () => {
    expect(HttpErrorExceptionTransformer.transform({ statusCode: 400, type: 'x', expose: true })).toBeUndefined();
  });
});
