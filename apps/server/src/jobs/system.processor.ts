import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { QUEUES } from './queues.js';

const HEARTBEAT_EVERY_MS = 60_000;

/**
 * Phase 0 placeholder processor. The heartbeat proves end to end that the worker
 * is connected to Redis and consuming jobs (visible in CloudWatch Logs).
 */
@Processor(QUEUES.system)
export class SystemProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(@InjectQueue(QUEUES.system) private readonly queue: Queue) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Idempotent: every worker task upserts the same scheduler, BullMQ runs it once per interval.
    await this.queue.upsertJobScheduler(
      'heartbeat',
      { every: HEARTBEAT_EVERY_MS },
      { name: 'heartbeat' },
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'heartbeat':
        this.logger.log({ jobId: job.id }, 'Worker heartbeat');
        return;
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
