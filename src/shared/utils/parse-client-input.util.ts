import { z } from 'zod';

import { AppValidationException } from '../exceptions/validation.exception';

// * Parses client-supplied input (query params, raw request fragments) and converts a failure into an
// * AppValidationException (HTTP 400). Use this wherever client input is parsed outside the request DTO
// * pipe — it keeps the "bad input is a client error" classification at the source, so a raw ZodError
// * never escapes to the global filter (where it is treated as a server-side data fault: 500).
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
