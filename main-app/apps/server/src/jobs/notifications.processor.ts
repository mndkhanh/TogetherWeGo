import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { MailerService } from '../notifications/mailer.service.js';
import { FanoutService } from '../notifications/fanout.service.js';
import { QUEUES } from './queues.js';

const SWEEP_EVERY_MS = 30_000;

/**
 * Sweeps the outbox. The API queues a sweep right after each commit; this schedule is the
 * safety net for any kick that got lost.
 */
@Processor(QUEUES.notifications, { concurrency: 2 })
export class NotificationsProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly fanout: FanoutService,
    @InjectQueue(QUEUES.notifications) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'outbox-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep' },
    );
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'sweep') throw new Error(`Unknown job: ${job.name}`);
    const handled = await this.fanout.processPending();
    if (handled > 0) this.logger.log({ handled }, 'Outbox swept');
  }
}

/** Sends one email per job; BullMQ retries with backoff if the mail server is unhappy. */
@Processor(QUEUES.email, { concurrency: 4 })
export class EmailProcessor extends WorkerHost {
  constructor(
    private readonly fanout: FanoutService,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  /** The job only carries the delivery id; the email itself was written with its notification. */
  async process(job: Job<{ deliveryId: string }>): Promise<void> {
    await this.fanout.sendEmail(job.data.deliveryId, (email) => this.mailer.send(email));
  }
}
