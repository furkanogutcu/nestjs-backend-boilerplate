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

import { AppException } from '../app.exception';
import { ExceptionCode } from '../enums/exception-code.enum';
import { NestJSExceptionTransformer } from './nestjs.exception-transformer';

type NestExceptionCase = { name: string; exception: HttpException; code: ExceptionCode };

const cases: NestExceptionCase[] = [
  { name: 'BadRequestException', exception: new BadRequestException(), code: ExceptionCode.BadRequest },
  { name: 'UnauthorizedException', exception: new UnauthorizedException(), code: ExceptionCode.Unauthorized },
  { name: 'ForbiddenException', exception: new ForbiddenException(), code: ExceptionCode.InsufficientPermissions },
  { name: 'NotFoundException', exception: new NotFoundException(), code: ExceptionCode.ResourceNotFound },
  { name: 'NotAcceptableException', exception: new NotAcceptableException(), code: ExceptionCode.NotAcceptable },
  { name: 'RequestTimeoutException', exception: new RequestTimeoutException(), code: ExceptionCode.RequestTimeout },
  { name: 'ConflictException', exception: new ConflictException(), code: ExceptionCode.Conflict },
  { name: 'GoneException', exception: new GoneException(), code: ExceptionCode.Gone },
  {
    name: 'PreconditionFailedException',
    exception: new PreconditionFailedException(),
    code: ExceptionCode.PreconditionFailed,
  },
  {
    name: 'PayloadTooLargeException',
    exception: new PayloadTooLargeException(),
    code: ExceptionCode.PayloadTooLarge,
  },
  {
    name: 'UnsupportedMediaTypeException',
    exception: new UnsupportedMediaTypeException(),
    code: ExceptionCode.UnsupportedMediaType,
  },
  {
    name: 'MethodNotAllowedException',
    exception: new MethodNotAllowedException(),
    code: ExceptionCode.MethodNotAllowed,
  },
  {
    name: 'UnprocessableEntityException',
    exception: new UnprocessableEntityException(),
    code: ExceptionCode.UnprocessableEntity,
  },
];

describe('NestJSExceptionTransformer', () => {
  describe.each(cases)('$name', ({ exception, code }) => {
    it('maps to an AppException preserving status and message', () => {
      const result = NestJSExceptionTransformer.transform(exception);

      expect(result).toBeInstanceOf(AppException);
      expect(result?.code).toBe(code);
      expect(result?.httpCode).toBe(exception.getStatus());
      expect(result?.message).toBe(exception.message);
    });
  });

  it('returns undefined for an unmapped HttpException', () => {
    expect(NestJSExceptionTransformer.transform(new HttpException('I am a teapot', 418))).toBeUndefined();
  });
});
