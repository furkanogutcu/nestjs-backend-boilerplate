import { z } from 'zod';

import { AppValidationException } from '../exceptions/validation.exception';
import { parseClientInput } from './parse-client-input.util';

describe('parseClientInput', () => {
  const schema = z.object({ page: z.coerce.number().int().min(1) });

  it('returns the coerced output for valid input', () => {
    expect(parseClientInput({ schema, value: { page: '3' } })).toEqual({ page: 3 });
  });

  it('throws an AppValidationException (client 400) for invalid input', () => {
    expect(() => parseClientInput({ schema, value: { page: '0' } })).toThrow(AppValidationException);
  });
});
