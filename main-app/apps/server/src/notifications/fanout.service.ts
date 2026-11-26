import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  describeNotification,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  type NotificationType,
  toLocale,
} from '@twg/shared';
import type { Queue } from 'bullmq';
import { personSelect } from '../expenses/expense-mappers.js';
import type { Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { QUEUES } from '../jobs/queues.js';
import { type OutgoingEmail, renderNotificationEmail } from './email.js';
import { toNotificationResponse } from './notification-mappers.js';
import type { OutboxEvent } from './outbox.service.js';
import { RealtimePublisher } from './realtime-publisher.service.js';

/** After this many failures a row is left alone (and visible in last_error) for a human. */
export const MAX_OUTBOX_ATTEMPTS = 10;
export const MAX_EMAIL_ATTEMPTS = 8;
const BATCH = 50;
/** An email still unsent after this long probably lost its job: queue it again. */
const EMAIL_STALE_MS = 2 * 60 * 1000;

interface FanOutResult {
  /** In-app notifications created, to push to open browsers. */
  notificationIds: string[];
  /** Email deliveries recorded, to queue for sending. */
  emailIds: string[];
}

/**
 * Turns outbox rows into notifications: who gets it, in-app rows, emails, and a live push.
 *
 * Each row is handled once, in its own transaction, with FOR UPDATE SKIP LOCKED so several
 * workers can sweep at the same time without doing anything twice. Everything the row produces
 * (notifications and email deliveries) is written in that transaction; emails are queued and
 * pushes sent only after it commits, so nothing goes out for a fan-out that rolled back.
 */
@Injectable()
export class FanoutService {
  private readonly logger = new Logger(FanoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimePublisher,
    @InjectQueue(QUEUES.email) private readonly emailQueue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Processes everything waiting. Returns how many rows were handled. */
  async processPending(): Promise<number> {
    await this.requeueStaleEmails();
    let handled = 0;
    for (;;) {
      const ids = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM outbox
        WHERE processed_at IS NULL AND attempts < ${MAX_OUTBOX_ATTEMPTS}
        ORDER BY created_at
        LIMIT ${BATCH}`;
      if (ids.length === 0) return handled;
      let progressed = false;
      for (const { id } of ids) {
        if (await this.processOne(id)) {
          handled++;
          progressed = true;
        }
      }
      // Everything left is locked by another worker or failing: stop until the next sweep.
      if (!progressed) return handled;
    }
  }

  /** True when this call handled the row (false: someone else has it, or it failed). */
  async processOne(outboxId: string): Promise<boolean> {
    let result: FanOutResult = { notificationIds: [], emailIds: [] };
    try {
      const done = await this.prisma.$transaction(async (tx) => {
        const [row] = await tx.$queryRaw<{ id: string; payload: OutboxEvent }[]>`
          SELECT id, payload FROM outbox
          WHERE id = ${outboxId}::uuid AND processed_at IS NULL
          FOR UPDATE SKIP LOCKED`;
        if (!row) return false;
        result = await this.fanOut(tx, row.id, row.payload);
        await tx.outbox.update({ where: { id: row.id }, data: { processedAt: new Date() } });
        return true;
      });
      if (done) {
        await this.queueEmails(result.emailIds);
        await this.push(result.notificationIds);
      }
      return done;
    } catch (error) {
      this.logger.error({ err: error, outboxId }, 'Outbox fan-out failed');
      await this.prisma.outbox.update({
        where: { id: outboxId },
        data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 500) },
      });
      return false;
    }
  }

  /**
   * Sends one recorded email. Skips it if it was already sent (a retried job) and records the
   * send straight away. Throws on failure so BullMQ retries with backoff. A crash between the
   * provider accepting it and sent_at being written can still repeat it: email is at-least-once.
   */
  async sendEmail(
    deliveryId: string,
    send: (email: OutgoingEmail) => Promise<void>,
  ): Promise<void> {
    const delivery = await this.prisma.emailDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery || delivery.sentAt || delivery.attempts >= MAX_EMAIL_ATTEMPTS) return;
    try {
      await send({
        to: delivery.toAddress,
        subject: delivery.subject,
        text: delivery.text,
        html: delivery.html,
      });
    } catch (error) {
      await this.prisma.emailDelivery.update({
        where: { id: deliveryId },
        data: { attempts: { increment: 1 }, lastError: String(error).slice(0, 500) },
      });
      throw error;
    }
    await this.prisma.emailDelivery.update({
      where: { id: deliveryId },
      data: { sentAt: new Date(), attempts: { increment: 1 } },
    });
  }

  private async fanOut(
    tx: Prisma.TransactionClient,
    outboxId: string,
    event: OutboxEvent,
  ): Promise<FanOutResult> {
    const result: FanOutResult = { notificationIds: [], emailIds: [] };
    if (!(NOTIFICATION_TYPES as readonly string[]).includes(event.type)) {
      this.logger.warn({ outboxId, type: event.type }, 'Unknown notification type; skipped');
      return result;
    }
    const recipients = await this.recipients(tx, event);
    if (recipients.length === 0) return result;

    const overrides = await tx.notificationPreference.findMany({
      where: { type: event.type, userId: { in: recipients.map((r) => r.id) } },
    });
    const prefs = new Map(overrides.map((p) => [p.userId, p]));
    const defaults = NOTIFICATION_DEFAULTS[event.type];

    for (const user of recipients) {
      const pref = prefs.get(user.id);
      const data = { ...event.data, ...event.perUser?.[user.id] };

      if (pref?.inApp ?? defaults.inApp) {
        const id = randomUUID();
        // Unique per (outbox row, user): a retried fan-out adds nothing.
        const created = await tx.notification.createMany({
          data: [{ id, userId: user.id, type: event.type, actorId: event.actorId, data, outboxId }],
          skipDuplicates: true,
        });
        if (created.count > 0) result.notificationIds.push(id);
      }

      if (pref?.email ?? defaults.email) {
        const reader = { locale: toLocale(user.locale), timeZone: user.timeZone };
        const { text, link } = describeNotification(event.type as NotificationType, data, reader);
        const email = renderNotificationEmail({
          to: user.email,
          name: user.name,
          locale: reader.locale,
          text,
          url: `${this.config.appOrigin}${link}`,
          settingsUrl: `${this.config.appOrigin}/settings/notifications`,
        });
        const id = randomUUID();
        const created = await tx.emailDelivery.createMany({
          data: [
            {
              id,
              outboxId,
              userId: user.id,
              toAddress: email.to,
              subject: email.subject,
              text: email.text,
              html: email.html,
            },
          ],
          skipDuplicates: true,
        });
        if (created.count > 0) result.emailIds.push(id);
      }
    }
    return result;
  }

  /**
   * Current group members (never people who have left), minus whoever did it. For a targeted
   * audience, only those people, and still only if they're in the group.
   */
  private async recipients(tx: Prisma.TransactionClient, event: OutboxEvent) {
    if (event.audience.kind === 'group' && !event.groupId) return [];
    const notActor = event.actorId ? { not: event.actorId } : undefined;
    const targeted = event.audience.kind === 'users' ? { in: event.audience.userIds } : undefined;
    const inGroup = event.groupId
      ? { memberships: { some: { groupId: event.groupId, leftAt: null } } }
      : {};
    return tx.user.findMany({
      where: { id: { ...targeted, ...notActor }, ...inGroup },
      select: { id: true, email: true, name: true, locale: true, timeZone: true },
    });
  }

  /** One job per email, keyed by its row: queuing the same email twice is harmless. */
  private async queueEmails(ids: string[]): Promise<void> {
    for (const id of ids) {
      try {
        await this.emailQueue.add('send', { deliveryId: id }, { jobId: id });
      } catch (error) {
        // The next sweep queues anything still unsent.
        this.logger.warn({ err: error, deliveryId: id }, 'Could not queue email');
      }
    }
  }

  /** Backstop for emails whose job never got queued (Redis down at the wrong moment). */
  private async requeueStaleEmails(): Promise<void> {
    const stale = await this.prisma.emailDelivery.findMany({
      where: {
        sentAt: null,
        attempts: { lt: MAX_EMAIL_ATTEMPTS },
        createdAt: { lt: new Date(Date.now() - EMAIL_STALE_MS) },
      },
      select: { id: true },
      take: BATCH,
    });
    await this.queueEmails(stale.map((e) => e.id));
  }

  /** Tells connected browsers. Lost pushes are fine: the feed is the record. */
  private async push(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;
    try {
      const rows = await this.prisma.notification.findMany({
        where: { id: { in: notificationIds } },
      });
      const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id) => id !== null))];
      const [actorRows, readerRows] = await Promise.all([
        this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: personSelect }),
        this.prisma.user.findMany({
          where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
          select: { id: true, locale: true, timeZone: true },
        }),
      ]);
      const actors = new Map(actorRows.map((a) => [a.id, a]));
      const readers = new Map(
        readerRows.map((u) => [u.id, { locale: toLocale(u.locale), timeZone: u.timeZone }]),
      );
      for (const row of rows) {
        const unreadCount = await this.prisma.notification.count({
          where: { userId: row.userId, readAt: null },
        });
        this.realtime.notify(row.userId, {
          notification: toNotificationResponse(
            row,
            row.actorId ? (actors.get(row.actorId) ?? null) : null,
            readers.get(row.userId),
          ),
          unreadCount,
        });
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Realtime push failed');
    }
  }
}
