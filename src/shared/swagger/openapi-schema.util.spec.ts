import { z } from 'zod';

import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { ValidationErrorType } from '@shared/exceptions/enums/validation-error-type.enum';

import {
  cursorPaginatedEnvelopeSchemaObject,
  dataEnvelopeSchemaObject,
  errorResponseSchemaObject,
  messageEnvelopeSchemaObject,
  offsetPaginatedEnvelopeSchemaObject,
  zodToOpenApi,
} from './openapi-schema.util';

describe('openapi-schema.util', () => {
  const schema = z.object({ id: z.number().int().describe('Identifier'), name: z.string() });

  describe('zodToOpenApi', () => {
    it('converts a Zod schema into an OpenAPI 3.0 schema object, preserving descriptions', () => {
      const result = zodToOpenApi(schema);

      expect(result.type).toBe('object');
      expect(result.properties?.id).toMatchObject({ type: 'integer', description: 'Identifier' });
      expect(result.required).toEqual(expect.arrayContaining(['id', 'name']));
    });
  });

  describe('dataEnvelopeSchemaObject', () => {
    it('wraps the schema in a `{ data }` envelope', () => {
      const result = dataEnvelopeSchemaObject(schema);

      expect(result).toMatchObject({ type: 'object', required: ['data'] });
      expect(result.properties?.data).toMatchObject({ type: 'object' });
    });
  });

  describe('offsetPaginatedEnvelopeSchemaObject', () => {
    it('wraps the schema in a `{ data[], meta }` envelope', () => {
      const result = offsetPaginatedEnvelopeSchemaObject({ schema });

      expect(result.required).toEqual(['data', 'meta']);
      expect(result.properties?.data).toMatchObject({ type: 'array' });
      expect(result.properties?.meta).toMatchObject({ type: 'object', required: ['pagination'] });
    });
  });

  describe('cursorPaginatedEnvelopeSchemaObject', () => {
    it('wraps the schema in a `{ data[], meta.pagination }` envelope discriminated by type', () => {
      const result = cursorPaginatedEnvelopeSchemaObject({ schema });

      expect(result.required).toEqual(['data', 'meta']);
      expect(result.properties?.data).toMatchObject({ type: 'array' });
      expect(result.properties?.meta).toMatchObject({ type: 'object', required: ['pagination'] });
    });

    it('merges endpoint-specific extra meta alongside pagination when provided', () => {
      const extraMeta = z.object({ next_refresh_at: z.iso.datetime() });
      const result = cursorPaginatedEnvelopeSchemaObject({ schema, extraMeta });

      const meta = result.properties?.meta as { properties?: Record<string, unknown>; required?: string[] };

      expect(meta.properties).toHaveProperty('pagination');
      expect(meta.properties).toHaveProperty('next_refresh_at');
      expect(meta.required).toEqual(['pagination', 'next_refresh_at']);
    });
  });

  describe('messageEnvelopeSchemaObject', () => {
    it('describes a `{ message }` envelope', () => {
      expect(messageEnvelopeSchemaObject).toMatchObject({ type: 'object', required: ['message'] });
    });
  });

  describe('errorResponseSchemaObject', () => {
    it('builds the error envelope for a status with the code enum and example', () => {
      const schema = errorResponseSchemaObject({
        codes: [ExceptionCode.ResourceNotFound],
        message: 'Resource not found.',
      });
      const error = schema.properties?.error as {
        required: string[];
        properties: { code: { enum: string[]; example: string }; details?: unknown };
      };

      expect(error.required).toEqual(['code', 'message']);
      expect(error.properties.code.enum).toEqual([ExceptionCode.ResourceNotFound]);
      expect(error.properties.code.example).toBe(ExceptionCode.ResourceNotFound);
      expect(error.properties.details).toBeUndefined();
    });

    it('includes a details example only when provided', () => {
      const schema = errorResponseSchemaObject({
        codes: [ExceptionCode.ValidationFailed],
        message: 'Validation failed',
        details: [{ type: ValidationErrorType.MissingField, path: 'name', issue: 'Required' }],
      });
      const error = schema.properties?.error as { properties: { details?: unknown } };

      expect(error.properties.details).toBeDefined();
    });
  });
});
