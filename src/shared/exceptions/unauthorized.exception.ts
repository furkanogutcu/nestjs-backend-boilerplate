import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppUnauthorizedException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'Access denied.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.Unauthorized,
      httpCode: HttpStatus.UNAUTHORIZED,
      details,
    });
  }
}
