import type { BullRootModuleOptions } from '@nestjs/bullmq';
import type { AppConfig } from '../infra/config/env.schema.js';

/** Queue names. Later phases add `notifications`, `email`, `reminders`. */
export const QUEUES = {
  system: 'system',
} as const;

export function bullRootOptions(config: AppConfig): BullRootModuleOptions {
  return {
    // BullMQ workers need maxRetriesPerRequest: null so blocking commands never time out.
    connection: { url: config.redisUrl, maxRetriesPerRequest: null },
    prefix: 'twg',
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  };
}
