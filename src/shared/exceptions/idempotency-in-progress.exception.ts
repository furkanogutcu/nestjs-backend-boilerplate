import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppIdempotencyInProgressException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'A request with this idempotency key is already being processed.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.IdempotencyRequestInProgress,
      httpCode: HttpStatus.CONFLICT,
      details,
    });
  }
}
