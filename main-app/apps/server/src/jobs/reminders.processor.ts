import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import type { EventReminderJob } from '../reminders/event-reminder-planner.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { QUEUES } from './queues.js';

const SWEEP_EVERY_MS = 60_000;
/** Monday 9:00 in Vietnam, where the groups are (per-user time zones come with Phase 7). */
export const DEBT_REMINDER_SCHEDULE = { pattern: '0 9 * * 1', tz: 'Asia/Ho_Chi_Minh' };

/**
 * Reminders. "event" jobs wait (delayed) until a reminder is due; "sweep" catches any whose job
 * went missing; "debts" is the weekly nudge to people who still owe money.
 */
@Processor(QUEUES.reminders, { concurrency: 4 })
export class RemindersProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(
    private readonly reminders: RemindersService,
    @InjectQueue(QUEUES.reminders) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    // Idempotent: every worker task upserts the same schedulers, and BullMQ runs each once.
    await this.queue.upsertJobScheduler(
      'event-reminder-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep' },
    );
    await this.queue.upsertJobScheduler('debt-reminders', DEBT_REMINDER_SCHEDULE, {
      name: 'debts',
    });
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'event': {
        const { reminderId } = job.data as EventReminderJob;
        const outcome = await this.reminders.handleEventReminder(reminderId);
        if (outcome) this.logger.log({ reminderId, outcome }, 'Event reminder');
        return;
      }
      case 'sweep': {
        const handled = await this.reminders.sweepEventReminders();
        if (handled > 0) this.logger.log({ handled }, 'Event reminders swept');
        return;
      }
      case 'debts': {
        const sent = await this.reminders.sendDebtReminders();
        this.logger.log({ sent }, 'Debt reminders sent');
        return;
      }
      default:
        throw new Error(`Unknown job: ${job.name}`);
    }
  }
}
