import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client.js';
import { QUEUES } from '../jobs/queues.js';

/** How long before the start each reminder goes out. */
export const REMINDER_OFFSETS_MS = { '24h': 24 * 3600_000, '1h': 3600_000 } as const;
export type ReminderKind = keyof typeof REMINDER_OFFSETS_MS;

/** A reminder due sooner than this isn't planned: the "new event" notification covers it. */
const MIN_LEAD_MS = 60_000;

export interface EventReminderJob {
  reminderId: string;
}

/** What changed in a transaction, so the jobs can follow once it commits. */
export interface ReminderChange {
  added: { id: string; dueAt: Date }[];
  removed: string[];
}

/**
 * Plans an event's reminders. The rows are the record and are written inside the event's
 * transaction; the delayed jobs are only for timing, added after the commit. A lost job just
 * means the worker's sweep sends that reminder a minute or so late.
 */
@Injectable()
export class EventReminderPlanner {
  private readonly logger = new Logger(EventReminderPlanner.name);

  constructor(@InjectQueue(QUEUES.reminders) private readonly queue: Queue<EventReminderJob>) {}

  /**
   * Replaces the event's reminders that haven't gone out yet. With `startsAt` null (a
   * cancelled event) it only removes them. Reminders already handled stay, as history.
   */
  async plan(
    tx: Prisma.TransactionClient,
    eventId: string,
    startsAt: Date | null,
    now = new Date(),
  ): Promise<ReminderChange> {
    // A reminder the worker is sending right now is locked; this waits for it, and then
    // leaves it alone because it's no longer unhandled.
    const removed = await tx.$queryRaw<{ id: string }[]>`
      DELETE FROM event_reminders
      WHERE event_id = ${eventId}::uuid AND handled_at IS NULL
      RETURNING id`;
    const added: ReminderChange['added'] = [];
    if (startsAt) {
      for (const [kind, offset] of Object.entries(REMINDER_OFFSETS_MS)) {
        const dueAt = new Date(startsAt.getTime() - offset);
        if (dueAt.getTime() - now.getTime() < MIN_LEAD_MS) continue;
        const row = await tx.eventReminder.create({
          data: { eventId, kind, dueAt },
          select: { id: true, dueAt: true },
        });
        added.push(row);
      }
    }
    return { added, removed: removed.map((r) => r.id) };
  }

  /** After the commit. Best effort, never throws: the sweep is the backstop. */
  async schedule(change: ReminderChange): Promise<void> {
    for (const id of change.removed) {
      try {
        await this.queue.remove(id);
      } catch (error) {
        // A job that fires for a deleted reminder finds nothing and does nothing.
        this.logger.warn({ err: error, reminderId: id }, 'Could not remove reminder job');
      }
    }
    for (const { id, dueAt } of change.added) {
      try {
        await this.queue.add(
          'event',
          { reminderId: id },
          { jobId: id, delay: Math.max(0, dueAt.getTime() - Date.now()) },
        );
      } catch (error) {
        this.logger.warn({ err: error, reminderId: id }, 'Could not queue reminder');
      }
    }
  }
}
