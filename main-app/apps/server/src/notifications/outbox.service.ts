import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { NotificationData, NotificationType } from '@twg/shared';
import type { Queue } from 'bullmq';
import type { Prisma } from '../generated/prisma/client.js';
import { QUEUES } from '../jobs/queues.js';

/** Who should hear about it. The actor is always left out, and so is anyone not in the group. */
export type Audience = { kind: 'group' } | { kind: 'users'; userIds: string[] };

/** What a service writes to the outbox, inside its own transaction. */
export interface OutboxEvent {
  type: NotificationType;
  groupId: string | null;
  actorId: string | null;
  audience: Audience;
  /** Facts shared by every recipient. */
  data: NotificationData;
  /** Facts for one recipient only, e.g. their share of an expense. */
  perUser?: Record<string, Partial<NotificationData>>;
}

/**
 * The write side of the transactional outbox. Services call `add` inside the transaction that
 * makes the change, then `kick` after it commits so the worker picks it up straight away.
 * If the kick is lost (Redis down, process killed), the worker's 30-second sweep still finds it.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@InjectQueue(QUEUES.notifications) private readonly queue: Queue) {}

  async add(tx: Prisma.TransactionClient, event: OutboxEvent): Promise<void> {
    await tx.outbox.create({ data: { type: event.type, payload: event as object } });
  }

  /** Group and person names as they are now, so the notification reads right later. */
  async names(
    tx: Prisma.TransactionClient,
    groupId: string | null,
    actorId: string | null,
  ): Promise<{ groupName?: string; actorName?: string }> {
    const [group, actor] = await Promise.all([
      groupId ? tx.group.findUnique({ where: { id: groupId }, select: { name: true } }) : null,
      actorId ? tx.user.findUnique({ where: { id: actorId }, select: { name: true } }) : null,
    ]);
    return { groupName: group?.name, actorName: actor?.name };
  }

  /** Best effort, never throws: the change is already committed and the sweep is the backstop. */
  kick(): void {
    this.queue
      .add('sweep', {}, { removeOnComplete: true, removeOnFail: 100, attempts: 1 })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not queue outbox sweep'));
  }
}
