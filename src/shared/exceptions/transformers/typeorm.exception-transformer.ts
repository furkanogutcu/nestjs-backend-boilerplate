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

  // * Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
  private static readonly postgresQueryFailedExceptionMapper: Record<
    string,
    (exception: QueryFailedError) => AppException<unknown> | undefined
  > = {
    '22003': TypeORMExceptionTransformer.transformNumericOverflowError,
    '23505': TypeORMExceptionTransformer.transformConflictError,
  };

  private static transformEntityNotFoundError(): AppNotFoundException {
    // * EntityNotFoundError.message embeds the TypeORM entity class name; echoing it as resourceName would
    // * leak internal model names to the client, so the not-found is reported with the generic resource label.
    return new AppNotFoundException();
  }

  private static transformConflictError(): AppConflictException {
    // * 23505 is unique_violation. The driver detail carries the conflicting column names and the offending
    // * value ("Key (email)=(a@b.com) already exists"); surfacing either would leak the schema and user data,
    // * so the conflict is reported generically with no field list.
    return new AppConflictException({ conflictedFields: [] });
  }

  private static transformNumericOverflowError(): AppUnprocessableEntityException {
    return new AppUnprocessableEntityException({
      message: 'Numeric field is outside the allowed range',
    });
  }
}
