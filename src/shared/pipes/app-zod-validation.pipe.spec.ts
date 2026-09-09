import { ArgumentMetadata } from '@nestjs/common';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

import { AppValidationException } from '../exceptions/validation.exception';
import { AppZodValidationPipe } from './app-zod-validation.pipe';

const metadata: ArgumentMetadata = { type: 'body' };
const schema = z.object({ name: z.string() });

describe('AppZodValidationPipe', () => {
  it('returns the parsed value for valid input', () => {
    const pipe = new AppZodValidationPipe(schema);

    expect(pipe.transform({ name: 'wheat' }, metadata)).toEqual({ name: 'wheat' });
  });

  it('translates a ZodValidationException into an AppValidationException', () => {
    const pipe = new AppZodValidationPipe(schema);

    expect(() => pipe.transform({ name: 123 }, metadata)).toThrow(AppValidationException);
  });

  it('rethrows non-ZodValidationException errors untouched', () => {
    const failure = new Error('unexpected pipe failure');
    vi.spyOn(ZodValidationPipe.prototype, 'transform').mockImplementation(() => {
      throw failure;
    });
    const pipe = new AppZodValidationPipe(schema);

    expect(() => pipe.transform({ name: 'x' }, metadata)).toThrow(failure);
  });

  it('rethrows a ZodValidationException that does not carry a ZodError', () => {
    const exception = new ZodValidationException(new z.ZodError([]));
    vi.spyOn(exception, 'getZodError').mockReturnValue({});
    vi.spyOn(ZodValidationPipe.prototype, 'transform').mockImplementation(() => {
      throw exception;
    });
    const pipe = new AppZodValidationPipe(schema);

    expect(() => pipe.transform({ name: 'x' }, metadata)).toThrow(exception);
  });
});
