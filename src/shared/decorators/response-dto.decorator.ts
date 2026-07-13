import { applyDecorators, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ZodType } from 'zod';

import { ApiStandardErrors } from '@shared/swagger/api-standard-errors.decorator';
import {
  cursorPaginatedEnvelopeSchemaObject,
  dataEnvelopeSchemaObject,
  offsetPaginatedEnvelopeSchemaObject,
} from '@shared/swagger/openapi-schema.util';

export const RESPONSE_SCHEMA = 'response_schema';

export interface IResponseDtoOptions {
  offsetPaginated?: boolean;
  cursorPaginated?: boolean;
  metaSchema?: ZodType;
  status?: number;
  description?: string;
  errors?: HttpStatus[];
}

export interface IResponseDtoParams extends IResponseDtoOptions {
  schema: ZodType;
}

function envelopeSchemaObject(params: IResponseDtoParams) {
  const { schema, offsetPaginated, cursorPaginated, metaSchema } = params;

  if (cursorPaginated) return cursorPaginatedEnvelopeSchemaObject({ schema, extraMeta: metaSchema });
  if (offsetPaginated) return offsetPaginatedEnvelopeSchemaObject({ schema, extraMeta: metaSchema });

  return dataEnvelopeSchemaObject(schema);
}

export const ResponseDto = (params: IResponseDtoParams) => {
  const { schema, status, description, errors } = params;

  return applyDecorators(
    SetMetadata(RESPONSE_SCHEMA, schema),
    ApiResponse({
      status: status ?? 200,
      description,
      schema: envelopeSchemaObject(params),
    }),
    ApiStandardErrors(errors),
  );
};
