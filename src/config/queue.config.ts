import { DefaultJobOptions } from 'bullmq';

export const defaultJobOptions: DefaultJobOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: true,
  removeOnFail: {
    age: 5 * 24 * 3600,
    count: 1000,
  },
};
