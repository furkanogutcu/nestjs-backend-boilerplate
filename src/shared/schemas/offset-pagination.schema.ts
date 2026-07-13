import { z } from 'zod';

export const offsetPaginationSchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    page_size: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .transform(({ page, page_size }) => {
    return {
      skip: (page - 1) * page_size,
      take: page_size,
    };
  });

export type OffsetPaginationParams = z.output<typeof offsetPaginationSchema>;
