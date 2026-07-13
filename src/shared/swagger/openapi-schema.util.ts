import { OpenAPIObject } from '@nestjs/swagger';
import { z, ZodType } from 'zod';

import { PaginationType } from '@shared/enums/pagination-type.enum';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { ValidationErrorType } from '@shared/exceptions/enums/validation-error-type.enum';
import { IValidationErrorDetails } from '@shared/exceptions/interfaces/validation-error-detail.interface';

type ComponentSchema = NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string];
type SchemaObject = Exclude<ComponentSchema, { $ref: string }>;

export function zodToOpenApi(schema: ZodType): SchemaObject {
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as SchemaObject;
}

const offsetPaginationMetaSchemaObject: SchemaObject = {
  type: 'object',
  properties: {
    pagination: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [PaginationType.Offset], example: PaginationType.Offset },
        page: { type: 'integer', example: 1 },
        page_size: { type: 'integer', example: 20 },
        total_count: { type: 'integer', example: 0 },
        total_pages: { type: 'integer', example: 0 },
      },
      required: ['type', 'page', 'page_size', 'total_count', 'total_pages'],
    },
  },
  required: ['pagination'],
};

export function dataEnvelopeSchemaObject(schema: ZodType): SchemaObject {
  return {
    type: 'object',
    properties: { data: zodToOpenApi(schema) },
    required: ['data'],
  };
}

// * Merge endpoint-specific meta properties into the base pagination meta, so a paginated list can attach extra
// * response-level metadata (e.g. a market-wide refresh time) alongside `pagination` in one typed `meta` object.
function withExtraMeta({ base, extraMeta }: { base: SchemaObject; extraMeta?: ZodType }): SchemaObject {
  if (!extraMeta) return base;

  const extra = zodToOpenApi(extraMeta);

  return {
    ...base,
    properties: { ...base.properties, ...extra.properties },
    required: [...(base.required ?? []), ...(extra.required ?? [])],
  };
}

export function offsetPaginatedEnvelopeSchemaObject({
  schema,
  extraMeta,
}: {
  schema: ZodType;
  extraMeta?: ZodType;
}): SchemaObject {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: zodToOpenApi(schema) },
      meta: withExtraMeta({ base: offsetPaginationMetaSchemaObject, extraMeta }),
    },
    required: ['data', 'meta'],
  };
}

const cursorPaginationMetaSchemaObject: SchemaObject = {
  type: 'object',
  properties: {
    pagination: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [PaginationType.Cursor], example: PaginationType.Cursor },
        page_size: { type: 'integer', example: 20 },
        next_cursor: { type: 'string', nullable: true },
        has_next: { type: 'boolean', example: false },
      },
      required: ['type', 'page_size', 'next_cursor', 'has_next'],
    },
  },
  required: ['pagination'],
};

export function cursorPaginatedEnvelopeSchemaObject({
  schema,
  extraMeta,
}: {
  schema: ZodType;
  extraMeta?: ZodType;
}): SchemaObject {
  return {
    type: 'object',
    properties: {
      data: { type: 'array', items: zodToOpenApi(schema) },
      meta: withExtraMeta({ base: cursorPaginationMetaSchemaObject, extraMeta }),
    },
    required: ['data', 'meta'],
  };
}

export const messageEnvelopeSchemaObject: SchemaObject = {
  type: 'object',
  properties: { message: { type: 'string' } },
  required: ['message'],
};

const validationErrorDetailSchemaObject: SchemaObject = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: Object.values(ValidationErrorType) },
    path: { type: 'string', example: 'name' },
    issue: { type: 'string', example: 'Required' },
  },
  required: ['type', 'path', 'issue'],
};

export interface IErrorResponseExample {
  codes: ExceptionCode[];
  message: string;
  details?: IValidationErrorDetails[];
}

export function errorResponseSchemaObject({ codes, message, details }: IErrorResponseExample): SchemaObject {
  const errorProperties: Record<string, SchemaObject> = {
    code: { type: 'string', enum: codes, example: codes[0] },
    message: { type: 'string', example: message },
    requestId: { type: 'string' },
    traceId: { type: 'string' },
  };

  if (details) {
    errorProperties.details = { type: 'array', items: validationErrorDetailSchemaObject, example: details };
  }

  return {
    type: 'object',
    properties: {
      error: {
        type: 'object',
        properties: errorProperties,
        required: ['code', 'message'],
      },
    },
    required: ['error'],
  };
}
