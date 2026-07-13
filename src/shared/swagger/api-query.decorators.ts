import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

export function ApiOffsetPaginationQuery(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      schema: { type: 'integer', minimum: 1, default: 1 },
      description: 'Page number (1-based)',
    }),
    ApiQuery({
      name: 'page_size',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      description: 'Items per page (max 100)',
    }),
  );
}

export function ApiCursorPaginationQuery(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiQuery({
      name: 'cursor',
      required: false,
      schema: { type: 'string' },
      description: 'Opaque cursor returned as meta.pagination.next_cursor by the previous page',
    }),
    ApiQuery({
      name: 'page_size',
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      description: 'Items per page (max 100)',
    }),
  );
}

export function ApiSearchQuery(): MethodDecorator & ClassDecorator {
  return ApiQuery({
    name: 'q',
    required: false,
    schema: { type: 'string', maxLength: 100 },
    description: 'Free-text search query',
  });
}

export function ApiOrderByQuery(fields: string[]): MethodDecorator & ClassDecorator {
  return ApiQuery({
    name: 'order_by',
    required: false,
    schema: { type: 'string' },
    description: `Sort by one of: ${fields.join(', ')}. Prefix with "-" for descending order (e.g. "-${fields[0] ?? 'field'}").`,
  });
}
