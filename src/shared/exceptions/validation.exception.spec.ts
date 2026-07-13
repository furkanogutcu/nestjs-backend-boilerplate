import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';

import { AppException } from './app.exception';
import { ExceptionCode } from './enums/exception-code.enum';
import { ValidationErrorType } from './enums/validation-error-type.enum';
import { AppValidationException } from './validation.exception';

function zodErrorFrom({ schema, value }: { schema: z.ZodType; value: unknown }): z.ZodError {
  const result = schema.safeParse(value);

  if (result.success) {
    throw new Error('Expected the schema to reject the value');
  }

  return result.error;
}

describe('AppValidationException', () => {
  it('uses validation defaults and no details when constructed without an error', () => {
    const exception = new AppValidationException();

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.httpCode).toBe(HttpStatus.BAD_REQUEST);
    expect(exception.code).toBe(ExceptionCode.ValidationFailed);
    expect(exception.message).toBe('Invalid request payload.');
    expect(exception.details).toBeUndefined();
    expect(exception.zodError).toBeUndefined();
  });

  it('retains the originating ZodError', () => {
    const error = zodErrorFrom({ schema: z.object({ name: z.string() }), value: {} });

    const exception = new AppValidationException(error);

    expect(exception.zodError).toBe(error);
  });

  it('classifies a missing required field as missing_field', () => {
    const error = zodErrorFrom({ schema: z.object({ email: z.string() }), value: {} });

    const [detail] = new AppValidationException(error).details ?? [];

    expect(detail).toMatchObject({ type: ValidationErrorType.MissingField, path: 'email' });
  });

  it('classifies a wrong type as invalid', () => {
    const error = zodErrorFrom({ schema: z.object({ age: z.number() }), value: { age: 'not-a-number' } });

    const [detail] = new AppValidationException(error).details ?? [];

    expect(detail).toMatchObject({ type: ValidationErrorType.Invalid, path: 'age' });
  });

  it('classifies non-type issues as invalid', () => {
    const error = zodErrorFrom({ schema: z.object({ name: z.string().min(3) }), value: { name: 'ab' } });

    const [detail] = new AppValidationException(error).details ?? [];

    expect(detail).toMatchObject({ type: ValidationErrorType.Invalid, path: 'name' });
  });

  it('joins nested paths with a dot', () => {
    const error = zodErrorFrom({ schema: z.object({ user: z.object({ name: z.string() }) }), value: { user: {} } });

    const [detail] = new AppValidationException(error).details ?? [];

    expect(detail).toMatchObject({ type: ValidationErrorType.MissingField, path: 'user.name' });
  });

  it('emits one unrecognized detail per unknown key', () => {
    const error = zodErrorFrom({ schema: z.strictObject({ name: z.string() }), value: { name: 'ok', foo: 1, bar: 2 } });

    const details = new AppValidationException(error).details ?? [];

    expect(details).toEqual([
      { type: ValidationErrorType.Unrecognized, path: 'foo', issue: 'This key is not recognized' },
      { type: ValidationErrorType.Unrecognized, path: 'bar', issue: 'This key is not recognized' },
    ]);
  });
});
