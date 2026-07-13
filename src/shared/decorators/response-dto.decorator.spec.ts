import { HttpStatus, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import { z } from 'zod';

import {
  cursorPaginatedEnvelopeSchemaObject,
  dataEnvelopeSchemaObject,
  offsetPaginatedEnvelopeSchemaObject,
} from '@shared/swagger/openapi-schema.util';

import { RESPONSE_SCHEMA, ResponseDto } from './response-dto.decorator';

interface IResponseDoc {
  description?: string;
  schema: Record<string, unknown>;
}

describe('ResponseDto', () => {
  const reflector = new Reflector();
  const schema = z.object({ id: z.number() });

  function documentedResponses(target: Type<unknown> | ((...args: never[]) => unknown)): Record<string, IResponseDoc> {
    return reflector.get<Record<string, IResponseDoc>>(DECORATORS.API_RESPONSE, target) ?? {};
  }

  it('attaches the response schema metadata to a handler', () => {
    class OrdersController {
      @ResponseDto({ schema })
      findOne(): void {}
    }

    expect(reflector.get(RESPONSE_SCHEMA, OrdersController.prototype.findOne)).toBe(schema);
  });

  it('attaches the response schema metadata at class level', () => {
    @ResponseDto({ schema })
    class OrdersController {}

    expect(reflector.get(RESPONSE_SCHEMA, OrdersController)).toBe(schema);
  });

  it('documents the custom status code with the offset-paginated envelope', () => {
    class OrdersController {
      @ResponseDto({ schema, offsetPaginated: true, status: 201, description: 'Created orders' })
      list(): void {}
    }

    const responses = documentedResponses(OrdersController.prototype.list);

    expect(responses[HttpStatus.CREATED].schema).toEqual(offsetPaginatedEnvelopeSchemaObject({ schema }));
    expect(responses[HttpStatus.OK]).toBeUndefined();
  });

  it('documents the cursor-paginated envelope for a cursor response', () => {
    class OrdersController {
      @ResponseDto({ schema, cursorPaginated: true })
      list(): void {}
    }

    const responses = documentedResponses(OrdersController.prototype.list);

    expect(responses[HttpStatus.OK].schema).toEqual(cursorPaginatedEnvelopeSchemaObject({ schema }));
    expect(responses[HttpStatus.OK].schema).not.toEqual(dataEnvelopeSchemaObject(schema));
  });

  it('threads a cursor endpoint-specific metaSchema into the documented envelope', () => {
    const metaSchema = z.object({ next_refresh_at: z.iso.datetime() });

    class OrdersController {
      @ResponseDto({ schema, cursorPaginated: true, metaSchema })
      list(): void {}
    }

    const responses = documentedResponses(OrdersController.prototype.list);

    expect(responses[HttpStatus.OK].schema).toEqual(
      cursorPaginatedEnvelopeSchemaObject({ schema, extraMeta: metaSchema }),
    );
  });

  it('adds the endpoint-specific error statuses to the documented responses', () => {
    class OrdersController {
      @ResponseDto({ schema, errors: [HttpStatus.NOT_FOUND, HttpStatus.CONFLICT] })
      findOne(): void {}
    }

    const responses = documentedResponses(OrdersController.prototype.findOne);

    expect(responses[HttpStatus.NOT_FOUND]).toBeDefined();
    expect(responses[HttpStatus.CONFLICT]).toBeDefined();
    expect(responses[HttpStatus.OK].schema).toEqual(dataEnvelopeSchemaObject(schema));
  });
});
