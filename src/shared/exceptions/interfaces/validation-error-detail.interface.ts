import { ValidationErrorType } from '@shared/exceptions/enums/validation-error-type.enum';

export interface IValidationErrorDetails {
  type: ValidationErrorType;
  path: string;
  issue: string;
}
