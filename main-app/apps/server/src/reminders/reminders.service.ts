import { Injectable, Logger } from '@nestjs/common';
import { simplifyDebts } from '@twg/shared';
import { netBalances } from '../expenses/ledger.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import { REMINDER_OFFSETS_MS } from './event-reminder-planner.service.js';

/** A delayed job can fire a moment early; that still counts as due. */
const EARLY_MS = 5_000;
const BATCH = 100;
/** Someone reminded about a group more recently than this is skipped. */
export const DEBT_COOLDOWN_MS = 6 * 24 * 3600_000;

export type ReminderOutcome = 'sent' | 'skipped';

/**
 * Worker side of reminders. Both kinds go through the outbox like every other notification,
 * so preferences, email and the live push all work the same way.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- Event reminders ----------

  /**
   * Handles one reminder once it's due. Null: nothing done (already handled, being handled by
   * another worker, deleted because the event moved, or not due yet).
   */
  async handleEventReminder(reminderId: string, now = new Date()): Promise<ReminderOutcome | null> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Lock the event first, in the same order as an edit (event, then its reminders).
      // An edit in flight finishes first, and its replanning has then already deleted this
      // row; an edit that starts later waits until this reminder is handled. FOR SHARE never
      // blocks other reminders or RSVPs, which also take it.
      const [target] = await tx.$queryRaw<{ event_id: string }[]>`
        SELECT event_id FROM event_reminders WHERE id = ${reminderId}::uuid`;
      if (!target) return null;
      await tx.$queryRaw`SELECT 1 FROM events WHERE id = ${target.event_id}::uuid FOR SHARE`;
      const [row] = await tx.$queryRaw<
        { id: string; event_id: string; kind: string; due_at: Date }[]
      >`
        SELECT id, event_id, kind, due_at FROM event_reminders
        WHERE id = ${reminderId}::uuid AND handled_at IS NULL
        FOR UPDATE SKIP LOCKED`;
      if (!row || row.due_at.getTime() > now.getTime() + EARLY_MS) return null;

      const event = await tx.event.findUniqueOrThrow({
        where: { id: row.event_id },
        include: { group: { select: { name: true, archivedAt: true } } },
      });
      const startsIn = event.startsAt.getTime() - now.getTime();
      // A late 24-hour reminder that would land after the 1-hour one is due adds nothing.
      const send =
        event.status === 'scheduled' &&
        !event.group.archivedAt &&
        startsIn > 0 &&
        (row.kind !== '24h' || startsIn > REMINDER_OFFSETS_MS['1h']);

      if (send) {
        // Everyone going or maybe; fan-out drops anyone who has left the group since.
        const attending = await tx.eventRsvp.findMany({
          where: { eventId: event.id, status: { in: ['going', 'maybe'] } },
          select: { userId: true },
        });
        if (attending.length > 0) {
          await this.outbox.add(tx, {
            type: 'event.reminder',
            groupId: event.groupId,
            actorId: null,
            audience: { kind: 'users', userIds: attending.map((r) => r.userId) },
            data: {
              groupId: event.groupId,
              groupName: event.group.name,
              eventId: event.id,
              title: event.title,
              startsAt: event.startsAt.toISOString(),
              ...(event.location && { location: event.location }),
            },
          });
        }
      }
      const result: ReminderOutcome = send ? 'sent' : 'skipped';
      await tx.eventReminder.update({
        where: { id: row.id },
        data: { handledAt: now, outcome: result },
      });
      return result;
    });
    if (outcome === 'sent') this.outbox.kick();
    return outcome;
  }

  /** Every due reminder still waiting: the backstop for jobs that went missing. */
  async sweepEventReminders(now = new Date()): Promise<number> {
    let handled = 0;
    for (;;) {
      const due = await this.prisma.eventReminder.findMany({
        where: { handledAt: null, dueAt: { lte: new Date(now.getTime() + EARLY_MS) } },
        orderBy: { dueAt: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      let progressed = false;
      for (const { id } of due) {
        try {
          if (await this.handleEventReminder(id, now)) {
            handled++;
            progressed = true;
          }
        } catch (error) {
          this.logger.error({ err: error, reminderId: id }, 'Event reminder failed');
        }
      }
      // Whatever is left is locked by another worker or failing: try again next sweep.
      if (due.length < BATCH || !progressed) return handled;
    }
  }

  // ---------- Debt reminders ----------

  /**
   * Reminds everyone who owes money in a group, at most once per DEBT_COOLDOWN_MS per group.
   * Skips archived groups, people who have left, and anyone with a payment already pending
   * in that group (they're on it). Returns how many reminders were written.
   */
  async sendDebtReminders(now = new Date()): Promise<number> {
    let sent = 0;
    let failed = 0;
    let after: string | undefined;
    for (;;) {
      const groups = await this.prisma.group.findMany({
        where: {
          archivedAt: null,
          expenses: { some: { deletedAt: null } },
          ...(after && { id: { gt: after } }),
        },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: BATCH,
      });
      for (const { id } of groups) {
        try {
          sent += await this.remindGroup(id, now);
        } catch (error) {
          // One bad group never stops the rest.
          failed++;
          this.logger.error({ err: error, groupId: id }, 'Debt reminders failed for a group');
        }
      }
      if (groups.length < BATCH) break;
      after = groups.at(-1)!.id;
    }
    if (sent > 0) this.outbox.kick();
    // Fail the job so BullMQ retries it; the cooldown makes the retry skip everyone already
    // reminded, so only the groups that failed are tried again.
    if (failed > 0) throw new Error(`Debt reminders failed for ${failed} group(s)`);
    return sent;
  }

  /** One group, in one transaction: who owes, who to, and a cooldown claim per person. */
  async remindGroup(groupId: string, now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const group = await tx.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { name: true, currency: true },
      });
      const nets = await netBalances(tx, groupId);
      const transfers = simplifyDebts([...nets].map(([userId, net]) => ({ userId, net })));
      if (transfers.length === 0) return 0;

      const debtorIds = [...new Set(transfers.map((t) => t.fromUserId))];
      const [active, paying] = await Promise.all([
        tx.groupMember.findMany({
          where: { groupId, leftAt: null, userId: { in: debtorIds } },
          select: { userId: true },
        }),
        tx.settlement.findMany({
          where: { groupId, status: 'pending', fromUserId: { in: debtorIds } },
          select: { fromUserId: true },
        }),
      ]);
      const skip = new Set(paying.map((p) => p.fromUserId));
      const toRemind = active.map((m) => m.userId).filter((id) => !skip.has(id));
      if (toRemind.length === 0) return 0;

      const creditorIds = [...new Set(transfers.map((t) => t.toUserId))];
      const names = new Map(
        (
          await tx.user.findMany({
            where: { id: { in: creditorIds } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name]),
      );

      const cutoff = new Date(now.getTime() - DEBT_COOLDOWN_MS);
      let sent = 0;
      for (const userId of toRemind) {
        // Claims this week's reminder. Nothing comes back if they were reminded recently, so
        // a second run (a retry, or two workers) never reminds anyone twice.
        const claimed = await tx.$queryRaw<{ user_id: string }[]>`
          INSERT INTO debt_reminders (group_id, user_id, last_sent_at)
          VALUES (${groupId}::uuid, ${userId}::uuid, ${now})
          ON CONFLICT (group_id, user_id) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
          WHERE debt_reminders.last_sent_at <= ${cutoff}
          RETURNING user_id`;
        if (claimed.length === 0) continue;

        const mine = transfers
          .filter((t) => t.fromUserId === userId)
          .sort((a, b) => b.amount - a.amount);
        await this.outbox.add(tx, {
          type: 'debt.reminder',
          groupId,
          actorId: null,
          audience: { kind: 'users', userIds: [userId] },
          data: {
            groupId,
            groupName: group.name,
            amount: -(nets.get(userId) ?? 0),
            currency: group.currency,
            creditorNames: mine.map((t) => names.get(t.toUserId) ?? 'Someone'),
          },
        });
        sent++;
      }
      return sent;
    });
  }
}
