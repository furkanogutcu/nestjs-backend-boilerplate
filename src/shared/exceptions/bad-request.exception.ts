import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppBadRequestException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'Bad request.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.BadRequest,
      httpCode: HttpStatus.BAD_REQUEST,
      details,
    });
  }
}
