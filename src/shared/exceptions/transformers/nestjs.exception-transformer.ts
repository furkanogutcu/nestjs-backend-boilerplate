import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  MethodNotAllowedException,
  NotAcceptableException,
  NotFoundException,
  PayloadTooLargeException,
  PreconditionFailedException,
  RequestTimeoutException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';

import { AppException } from '../app.exception';

const HTTP_EXCEPTION_CODE_MAP: ReadonlyArray<[new (...args: never[]) => HttpException, ExceptionCode]> = [
  [BadRequestException, ExceptionCode.BadRequest],
  [UnauthorizedException, ExceptionCode.Unauthorized],
  [ForbiddenException, ExceptionCode.InsufficientPermissions],
  [NotFoundException, ExceptionCode.ResourceNotFound],
  [NotAcceptableException, ExceptionCode.NotAcceptable],
  [RequestTimeoutException, ExceptionCode.RequestTimeout],
  [ConflictException, ExceptionCode.Conflict],
  [GoneException, ExceptionCode.Gone],
  [PreconditionFailedException, ExceptionCode.PreconditionFailed],
  [PayloadTooLargeException, ExceptionCode.PayloadTooLarge],
  [UnsupportedMediaTypeException, ExceptionCode.UnsupportedMediaType],
  [MethodNotAllowedException, ExceptionCode.MethodNotAllowed],
  [UnprocessableEntityException, ExceptionCode.UnprocessableEntity],
];

export class NestJSExceptionTransformer {
  static transform(exception: HttpException): AppException<unknown> | undefined {
    for (const [ExceptionType, code] of HTTP_EXCEPTION_CODE_MAP) {
      if (exception instanceof ExceptionType) {
        return new AppException({
          httpCode: exception.getStatus(),
          message: exception.message,
          code,
        });
      }
    }

    return undefined;
  }
}
