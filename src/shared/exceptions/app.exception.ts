import { HttpStatus } from '@nestjs/common';

import { IErrorResponse } from './interfaces/error-response.interface';
import { IValidationErrorDetails } from './interfaces/validation-error-detail.interface';

export class AppException<TDetails = IValidationErrorDetails[]> extends Error {
  readonly code: string;
  readonly httpCode: HttpStatus;
  readonly details?: TDetails;

  constructor({
    message,
    httpCode,
    code,
    details,
  }: {
    message: string;
    httpCode: HttpStatus;
    code: string;
    details?: TDetails;
  }) {
    super(message);

    this.name = this.constructor.name;
    this.httpCode = httpCode;
    this.code = code;
    this.details = details;
  }

  toJSON(): IErrorResponse<TDetails> {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}
