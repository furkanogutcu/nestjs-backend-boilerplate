import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';
import { AppValidationException } from '../exceptions/validation.exception';
import { anonymousIdempotencyKeySchema, idempotencyKeySchema } from '../schemas/idempotency-key.schema';

export function validateIdempotencyKey({
  value,
  principalSource,
}: {
  value: string;
  principalSource?: IdempotencyPrincipalSource;
}): void {
  const schema =
    principalSource === IdempotencyPrincipalSource.Anonymous ? anonymousIdempotencyKeySchema : idempotencyKeySchema;
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new AppValidationException(result.error);
  }
}
