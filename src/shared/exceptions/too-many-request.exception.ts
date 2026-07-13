import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppTooManyRequestException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'You have exceeded the number of allowed requests. Please try again later.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.RateLimit,
      httpCode: HttpStatus.TOO_MANY_REQUESTS,
      details,
    });
  }
}
