import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { MAX_EMAIL_ATTEMPTS, MAX_OUTBOX_ATTEMPTS } from '../notifications/fanout.service.js';

/** Work older than this that should have been done already counts as backlog. */
const OVERDUE_MS = 5 * 60_000;

/**
 * Work the worker owes, counted from the database (the record), not from Redis. Logged with
 * every heartbeat; CloudWatch turns the numbers into metrics and alarms on them.
 */
export interface Backlog {
  /** Outbox rows still waiting after 5 minutes: fan-out is stuck or far behind. */
  outboxBacklog: number;
  /** Outbox rows given up on after too many attempts: need a human. */
  outboxFailed: number;
  /** Emails given up on after too many attempts. */
  emailFailed: number;
  /** Event reminders more than 5 minutes overdue. */
  reminderBacklog: number;
}

@Injectable()
export class BacklogService {
  constructor(private readonly prisma: PrismaService) {}

  async measure(now = new Date()): Promise<Backlog> {
    const overdue = new Date(now.getTime() - OVERDUE_MS);
    const [outboxBacklog, outboxFailed, emailFailed, reminderBacklog] = await Promise.all([
      this.prisma.outbox.count({
        where: {
          processedAt: null,
          attempts: { lt: MAX_OUTBOX_ATTEMPTS },
          createdAt: { lt: overdue },
        },
      }),
      this.prisma.outbox.count({
        where: { processedAt: null, attempts: { gte: MAX_OUTBOX_ATTEMPTS } },
      }),
      this.prisma.emailDelivery.count({
        where: { sentAt: null, attempts: { gte: MAX_EMAIL_ATTEMPTS } },
      }),
      this.prisma.eventReminder.count({ where: { handledAt: null, dueAt: { lt: overdue } } }),
    ]);
    return { outboxBacklog, outboxFailed, emailFailed, reminderBacklog };
  }
}
