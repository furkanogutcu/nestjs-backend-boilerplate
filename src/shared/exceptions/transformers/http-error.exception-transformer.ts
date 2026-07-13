import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from '../app.exception';

interface IHttpError extends Error {
  statusCode: number;
  expose: boolean;
  type: string;
}

const STATUS_CODE_MAP: Readonly<Record<number, ExceptionCode>> = {
  400: ExceptionCode.BadRequest,
  413: ExceptionCode.PayloadTooLarge,
  415: ExceptionCode.UnsupportedMediaType,
};

function isHttpError(error: unknown): error is IHttpError {
  return (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    'type' in error &&
    typeof error.type === 'string' &&
    'expose' in error &&
    error.expose === true
  );
}

export class HttpErrorExceptionTransformer {
  static transform(exception: unknown): AppException<unknown> | undefined {
    if (!isHttpError(exception)) {
      return undefined;
    }

    const code = STATUS_CODE_MAP[exception.statusCode];

    if (!code) {
      return undefined;
    }

    return new AppException({ httpCode: exception.statusCode, message: exception.message, code });
  }
}
