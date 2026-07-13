import { HttpStatus } from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { ValidationErrorType } from '@shared/exceptions/enums/validation-error-type.enum';

import { AppException } from './app.exception';
import { IValidationErrorDetails } from './interfaces/validation-error-detail.interface';

export class AppConflictException extends AppException<IValidationErrorDetails[]> {
  readonly conflictedFields: string[];

  constructor({
    conflictedFields,
    message = 'Some fields already exists.',
    code,
  }: {
    conflictedFields: string[];
    message?: string;
    code?: string;
  }) {
    super({
      message,
      code: code || ExceptionCode.SomeFieldsAlreadyExists,
      httpCode: HttpStatus.CONFLICT,
      details: AppConflictException.buildDetails(conflictedFields),
    });

    this.conflictedFields = conflictedFields;
  }

  private static buildDetails(conflictedFields: string[]): IValidationErrorDetails[] {
    return conflictedFields.map((field): IValidationErrorDetails => {
      return {
        type: ValidationErrorType.AlreadyExists,
        path: field,
        issue: `${field} already exists`,
      };
    });
  }
}
