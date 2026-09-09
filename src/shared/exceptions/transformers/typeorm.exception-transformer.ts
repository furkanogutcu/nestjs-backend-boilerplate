import { EntityNotFoundError, QueryFailedError, TypeORMError } from 'typeorm';

import { AppException } from '../app.exception';
import { AppConflictException } from '../conflict.exception';
import { AppNotFoundException } from '../not-found.exception';
import { AppUnprocessableEntityException } from '../unprocessable-entity.exception';

export class TypeORMExceptionTransformer {
  static transform(exception: TypeORMError): AppException<unknown> | undefined {
    if (exception instanceof EntityNotFoundError) {
      return this.transformEntityNotFoundError();
    }

    if (exception instanceof QueryFailedError) {
      const { code } = exception.driverError as { code?: string };
      const transformer = code ? this.postgresQueryFailedExceptionMapper[code] : undefined;

      return transformer?.(exception);
    }

    return undefined;
  }

  private static readonly postgresQueryFailedExceptionMapper: Record<
    string,
    (exception: QueryFailedError) => AppException<unknown> | undefined
  > = {
    '22003': TypeORMExceptionTransformer.transformNumericOverflowError,
    '23505': TypeORMExceptionTransformer.transformConflictError,
  };

  private static transformEntityNotFoundError(): AppNotFoundException {
    // ! Generic on purpose: EntityNotFoundError.message embeds the entity class name.
    return new AppNotFoundException();
  }

  private static transformConflictError(): AppConflictException {
    // ! Empty on purpose: the driver detail carries the conflicting column and its value ("Key (email)=(a@b.com)").
    return new AppConflictException({ conflictedFields: [] });
  }

  private static transformNumericOverflowError(): AppUnprocessableEntityException {
    return new AppUnprocessableEntityException({
      message: 'Numeric field is outside the allowed range',
    });
  }
}
