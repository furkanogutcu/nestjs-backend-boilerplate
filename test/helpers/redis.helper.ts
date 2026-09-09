import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Redis } from 'ioredis';

export function createMockRedis(): DeepMocked<Redis> {
  return createMock<Redis>();
}
