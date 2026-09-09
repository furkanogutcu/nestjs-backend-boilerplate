import { z } from 'zod';

import { AppValidationException } from '../exceptions/validation.exception';

// * Classifies bad client input as 400 at the source; a raw ZodError reaching the global filter is treated as a 500.
export function parseClientInput<TSchema extends z.ZodType>({
  schema,
  value,
}: {
  schema: TSchema;
  value: unknown;
}): z.output<TSchema> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppValidationException(result.error);
  }

  return result.data;
}
