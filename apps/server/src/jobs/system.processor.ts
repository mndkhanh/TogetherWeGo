import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { BacklogService } from './backlog.service.js';
import { QUEUES } from './queues.js';

const HEARTBEAT_EVERY_MS = 60_000;

/**
 * The heartbeat: once a minute (across all worker tasks), proves the worker is connected to
 * Redis and consuming jobs, and logs how much work is overdue. In AWS, CloudWatch metric filters
 * on this "Worker heartbeat" line drive the backlog alarms, and its absence the "worker silent"
 * alarm, so keep the message and field names stable.
 */
@Processor(QUEUES.system)
export class SystemProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SystemProcessor.name);

  constructor(
    @InjectQueue(QUEUES.system) private readonly queue: Queue,
    private readonly backlog: BacklogService,
  ) {
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
        this.logger.log({ jobId: job.id, ...(await this.backlog.measure()) }, 'Worker heartbeat');
        return;
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
