import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppUnprocessableEntityException<TDetails = undefined> extends AppException<TDetails> {
  constructor({
    message = 'Unprocessable entity.',
    code,
    details,
  }: { message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message,
      code: code || ExceptionCode.UnprocessableEntity,
      httpCode: HttpStatus.UNPROCESSABLE_ENTITY,
      details,
    });
  }
}
