import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';

import { ApiStandardErrors } from './api-standard-errors.decorator';

interface IResponseDoc {
  description: string;
  schema: Record<string, unknown>;
}

const reflector = new Reflector();

function documentedStatuses(decorator: MethodDecorator): Record<string, IResponseDoc> {
  class Probe {
    handler(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'handler') as PropertyDescriptor;
  decorator(Probe.prototype, 'handler', descriptor);

  return reflector.get<Record<string, IResponseDoc>>(DECORATORS.API_RESPONSE, descriptor.value) ?? {};
}

describe('ApiStandardErrors', () => {
  it('documents only the cross-cutting error statuses by default', () => {
    const statuses = Object.keys(documentedStatuses(ApiStandardErrors())).map(Number);

    expect(statuses).toEqual([HttpStatus.BAD_REQUEST, HttpStatus.TOO_MANY_REQUESTS, HttpStatus.INTERNAL_SERVER_ERROR]);
  });

  it('merges endpoint-specific statuses with the cross-cutting ones, deduplicated and sorted', () => {
    const statuses = Object.keys(
      documentedStatuses(ApiStandardErrors([HttpStatus.NOT_FOUND, HttpStatus.CONFLICT, HttpStatus.BAD_REQUEST])),
    ).map(Number);

    expect(statuses).toEqual([
      HttpStatus.BAD_REQUEST,
      HttpStatus.NOT_FOUND,
      HttpStatus.CONFLICT,
      HttpStatus.TOO_MANY_REQUESTS,
      HttpStatus.INTERNAL_SERVER_ERROR,
    ]);
  });

  it('falls back to the 500 envelope for a status without its own error doc', () => {
    const responses = documentedStatuses(ApiStandardErrors([HttpStatus.I_AM_A_TEAPOT]));

    expect(responses[HttpStatus.I_AM_A_TEAPOT]).toEqual(responses[HttpStatus.INTERNAL_SERVER_ERROR]);
  });
});
