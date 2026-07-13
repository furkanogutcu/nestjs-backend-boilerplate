import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppInternalException<TDetails = undefined> extends AppException<TDetails> {
  readonly originalError?: Error;

  constructor({
    message = 'An unexpected error occurred.',
    code,
    error,
    details,
  }: { message?: string; code?: string; error?: Error; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.UnexpectedError,
      httpCode: HttpStatus.INTERNAL_SERVER_ERROR,
      details,
    });

    this.originalError = error;
  }
}
