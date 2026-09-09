import { z } from 'zod';

import { decodeCursor } from '@shared/utils/cursor.util';

export const cursorPaginationSchema = z
  .object({
    page_size: z.coerce.number().int().min(1).max(100).optional().default(20),
    cursor: z.string().optional(),
  })

  .transform((value, ctx) => {
    const decoded = value.cursor ? decodeCursor(value.cursor) : undefined;

    if (value.cursor && !decoded) {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor', path: ['cursor'] });

      return z.NEVER;
    }

    return {
      take: value.page_size,
      cursor: decoded,
    };
  });

export type CursorPaginationParams = z.output<typeof cursorPaginationSchema>;
