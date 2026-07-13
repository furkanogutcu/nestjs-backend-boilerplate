import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Redis } from 'ioredis';

export function createMockRedis(): DeepMocked<Redis> {
  return createMock<Redis>();
}
