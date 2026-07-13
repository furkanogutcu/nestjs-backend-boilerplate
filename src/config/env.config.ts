import { config } from 'dotenv';
import { z } from 'zod';

import { ENVSchema } from '@config/env.schema';

config({ quiet: true });

export type ENV = z.infer<typeof ENVSchema>;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((nested) => deepFreeze(nested));
  }

  return Object.freeze(value);
}

const parsed = ENVSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`❌ Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  process.exit(1);
}

export const env: Readonly<ENV> = deepFreeze(parsed.data);
