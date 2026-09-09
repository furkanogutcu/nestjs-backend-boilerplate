import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { ValidationErrorType } from '@shared/exceptions/enums/validation-error-type.enum';

import { errorResponseSchemaObject, IErrorResponseExample } from './openapi-schema.util';

interface IStandardErrorDoc extends IErrorResponseExample {
  description: string;
}

const ERROR_DOCS: Partial<Record<HttpStatus, IStandardErrorDoc>> = {
  [HttpStatus.BAD_REQUEST]: {
    description: 'Validation failed or the request was malformed',
    codes: [ExceptionCode.ValidationFailed, ExceptionCode.BadRequest],
    message: 'Validation failed',
    details: [{ type: ValidationErrorType.MissingField, path: 'name', issue: 'Required' }],
  },
  [HttpStatus.UNAUTHORIZED]: {
    description: 'Authentication is required or has failed',
    codes: [ExceptionCode.Unauthorized],
    message: 'Authentication is required',
  },
  [HttpStatus.FORBIDDEN]: {
    description: 'The caller lacks permission for this resource',
    codes: [ExceptionCode.InsufficientPermissions],
    message: 'You do not have permission to perform this action',
  },
  [HttpStatus.NOT_FOUND]: {
    description: 'The requested resource was not found',
    codes: [ExceptionCode.ResourceNotFound],
    message: 'Resource not found.',
  },
  [HttpStatus.CONFLICT]: {
    description: 'The request conflicts with the current state',
    codes: [ExceptionCode.SomeFieldsAlreadyExists, ExceptionCode.Conflict],
    message: 'A resource with these fields already exists',
    details: [{ type: ValidationErrorType.AlreadyExists, path: 'name', issue: 'Already exists' }],
  },
  [HttpStatus.UNPROCESSABLE_ENTITY]: {
    description: 'The request was well-formed but semantically invalid',
    codes: [ExceptionCode.UnprocessableEntity],
    message: 'The request could not be processed',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    description: 'Rate limit exceeded',
    codes: [ExceptionCode.RateLimit],
    message: 'Too many requests, please try again later',
  },
  [HttpStatus.INTERNAL_SERVER_ERROR]: {
    description: 'An unexpected error occurred',
    codes: [ExceptionCode.UnexpectedError],
    message: 'An unexpected error occurred',
  },
};

const CROSS_CUTTING_ERROR_STATUSES: HttpStatus[] = [
  HttpStatus.BAD_REQUEST,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.INTERNAL_SERVER_ERROR,
];

export function ApiStandardErrors(extraStatuses: HttpStatus[] = []): MethodDecorator & ClassDecorator {
  const statuses = [...new Set([...CROSS_CUTTING_ERROR_STATUSES, ...extraStatuses])].sort((a, b) => a - b);

  return applyDecorators(
    ...statuses.map((status) => {
      const doc = ERROR_DOCS[status] ?? ERROR_DOCS[HttpStatus.INTERNAL_SERVER_ERROR]!;

      return ApiResponse({ status, description: doc.description, schema: errorResponseSchemaObject(doc) });
    }),
  );
}
