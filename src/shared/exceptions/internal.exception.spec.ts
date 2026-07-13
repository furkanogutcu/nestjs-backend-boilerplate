import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';
import { ExceptionCode } from './enums/exception-code.enum';
import { AppInternalException } from './internal.exception';

describe('AppInternalException', () => {
  it('uses sensible defaults', () => {
    const exception = new AppInternalException();

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.message).toBe('An unexpected error occurred.');
    expect(exception.code).toBe(ExceptionCode.UnexpectedError);
    expect(exception.httpCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(exception.originalError).toBeUndefined();
  });

  it('captures the original error', () => {
    const original = new Error('database exploded');

    const exception = new AppInternalException({ error: original });

    expect(exception.originalError).toBe(original);
  });

  it('allows overriding the message and code', () => {
    const exception = new AppInternalException({ message: 'Custom failure', code: 'custom_failure' });

    expect(exception.message).toBe('Custom failure');
    expect(exception.code).toBe('custom_failure');
  });

  it('serializes details when provided', () => {
    const exception = new AppInternalException<string[]>({ details: ['context'] });

    expect(exception.toJSON()).toEqual({
      error: { code: ExceptionCode.UnexpectedError, message: 'An unexpected error occurred.', details: ['context'] },
    });
  });
});
