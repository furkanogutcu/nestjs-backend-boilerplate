import { HttpStatus } from '@nestjs/common';

import { AppException } from './app.exception';
import { ExceptionCode } from './enums/exception-code.enum';
import { AppNotFoundException } from './not-found.exception';

describe('AppNotFoundException', () => {
  it('defaults to a generic "Resource" name and message', () => {
    const exception = new AppNotFoundException();

    expect(exception).toBeInstanceOf(AppException);
    expect(exception.httpCode).toBe(HttpStatus.NOT_FOUND);
    expect(exception.code).toBe(ExceptionCode.ResourceNotFound);
    expect(exception.resourceName).toBe('Resource');
    expect(exception.message).toBe('Resource not found.');
  });

  it('builds the message from the resource name', () => {
    const exception = new AppNotFoundException({ resourceName: 'User' });

    expect(exception.resourceName).toBe('User');
    expect(exception.message).toBe('User not found.');
  });

  it('allows overriding the message, code and details', () => {
    const exception = new AppNotFoundException<string[]>({
      resourceName: 'User',
      message: 'No such user',
      code: 'user_missing',
      details: ['id=1'],
    });

    expect(exception.message).toBe('No such user');
    expect(exception.code).toBe('user_missing');
    expect(exception.toJSON().error.details).toEqual(['id=1']);
  });
});
