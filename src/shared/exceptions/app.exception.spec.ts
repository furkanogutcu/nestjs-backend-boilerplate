import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';

describe('AppException', () => {
  it('exposes the provided message, code and httpCode', () => {
    const exception = new AppException({ message: 'Boom', code: 'boom', httpCode: HttpStatus.BAD_REQUEST });

    expect(exception.message).toBe('Boom');
    expect(exception.code).toBe('boom');
    expect(exception.httpCode).toBe(HttpStatus.BAD_REQUEST);
  });

  it('is an Error whose name matches the concrete class', () => {
    const exception = new AppException({ message: 'x', code: 'x', httpCode: HttpStatus.I_AM_A_TEAPOT });

    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe('AppException');
  });

  it('serializes to the standard error envelope including details', () => {
    const details = ['first', 'second'];

    const exception = new AppException<string[]>({
      message: 'Boom',
      code: 'boom',
      httpCode: HttpStatus.BAD_REQUEST,
      details,
    });

    expect(exception.toJSON()).toEqual({ error: { code: 'boom', message: 'Boom', details } });
  });

  it('serializes with undefined details when none are provided', () => {
    const exception = new AppException({ message: 'Boom', code: 'boom', httpCode: HttpStatus.BAD_REQUEST });

    expect(exception.toJSON()).toEqual({ error: { code: 'boom', message: 'Boom', details: undefined } });
  });
});
