import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';
import { AppConflictException } from './conflict.exception';
import { ExceptionCode } from './enums/exception-code.enum';
import { ValidationErrorType } from './enums/validation-error-type.enum';

describe('AppConflictException', () => {
  it('builds an already_exists detail for every conflicted field', () => {
    const exception = new AppConflictException({ conflictedFields: ['email', 'username'] });

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.httpCode).toBe(HttpStatus.CONFLICT);
    expect(exception.code).toBe(ExceptionCode.SomeFieldsAlreadyExists);
    expect(exception.message).toBe('Some fields already exists.');
    expect(exception.conflictedFields).toEqual(['email', 'username']);
    expect(exception.toJSON().error.details).toEqual([
      { type: ValidationErrorType.AlreadyExists, path: 'email', issue: 'email already exists' },
      { type: ValidationErrorType.AlreadyExists, path: 'username', issue: 'username already exists' },
    ]);
  });

  it('produces no details for an empty field list', () => {
    const exception = new AppConflictException({ conflictedFields: [] });

    expect(exception.toJSON().error.details).toEqual([]);
  });

  it('allows overriding the message and code', () => {
    const exception = new AppConflictException({
      conflictedFields: ['slug'],
      message: 'Slug taken',
      code: 'slug_taken',
    });

    expect(exception.message).toBe('Slug taken');
    expect(exception.code).toBe('slug_taken');
  });
});
