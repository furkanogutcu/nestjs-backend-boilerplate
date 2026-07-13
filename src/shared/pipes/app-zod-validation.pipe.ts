import { ArgumentMetadata, Injectable } from '@nestjs/common';
import { ZodValidationException, ZodValidationPipe } from 'nestjs-zod';
import z from 'zod';

import { AppValidationException } from '../exceptions/validation.exception';

@Injectable()
export class AppZodValidationPipe extends ZodValidationPipe {
  // eslint-disable-next-line no-restricted-syntax -- NestJS PipeTransform.transform signature is fixed (value, metadata)
  transform(value: unknown, metadata: ArgumentMetadata) {
    try {
      return super.transform(value, metadata);
    } catch (error) {
      if (error instanceof ZodValidationException) {
        const zodError = error.getZodError();

        if (zodError instanceof z.ZodError) {
          throw new AppValidationException(zodError);
        }
      }

      throw error;
    }
  }
}
