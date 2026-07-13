import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from './app.exception';

export class AppNotFoundException<TDetails = undefined> extends AppException<TDetails> {
  readonly resourceName: string;

  constructor({
    resourceName = 'Resource',
    message,
    code,
    details,
  }: { resourceName?: string; message?: string; code?: string; details?: TDetails } = {}) {
    super({
      message: message || `${resourceName} not found.`,
      code: code || ExceptionCode.ResourceNotFound,
      httpCode: HttpStatus.NOT_FOUND,
      details,
    });

    this.resourceName = resourceName;
  }
}
