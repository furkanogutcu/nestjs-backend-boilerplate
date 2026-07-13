import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppServiceUnavailableException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'Service temporarily unavailable.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.ServiceUnavailable,
      httpCode: HttpStatus.SERVICE_UNAVAILABLE,
      details,
    });
  }
}
