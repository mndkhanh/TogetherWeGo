import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CommentPageResponse,
  type CommentResponse,
  type CreateCommentInput,
  type createEventSchema,
  DEFAULT_EVENT_HOURS,
  type EventDetailResponse,
  type EventPageResponse,
  type GroupRole,
  type ListCommentsQuery,
  type ListEventsQuery,
  roleAtLeast,
  type RsvpStatus,
  type updateEventSchema,
} from '@twg/shared';
import type { z } from 'zod';
import { toPerson } from '../expenses/expense-mappers.js';
import { lockActiveMembers, lockGroup } from '../expenses/ledger.js';
import type { Prisma } from '../generated/prisma/client.js';
import { GroupAccessService } from '../groups/group-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  EventReminderPlanner,
  type ReminderChange,
} from '../reminders/event-reminder-planner.service.js';
import { personSelect } from '../expenses/expense-mappers.js';
import {
  canEditEvent,
  decodeCursor,
  encodeCursor,
  eventInclude,
  type EventWithPeople,
  eventSnapshot,
  toEventSummary,
} from './event-mappers.js';

const NOT_FOUND = 'Event not found';
const COMMENT_NOT_FOUND = 'Comment not found';
const CONFLICT = 'Someone else changed this event. Reload to see the latest version.';
const CANCELLED = 'This event was cancelled';

type Tx = Prisma.TransactionClient;
type EventInput = z.output<typeof createEventSchema>;
type EventUpdate = z.output<typeof updateEventSchema>;

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly outbox: OutboxService,
    private readonly reminders: EventReminderPlanner,
  ) {}

  /**
   * Upcoming: not over yet, soonest first. Past: over, most recent first. An event with no
   * end time counts as over DEFAULT_EVENT_HOURS after it starts.
   */
  async list(groupId: string, userId: string, query: ListEventsQuery): Promise<EventPageResponse> {
    const { membership } = await this.access.require(groupId, userId);
    const now = new Date();
    const assumedStart = new Date(now.getTime() - DEFAULT_EVENT_HOURS * 3600 * 1000);
    const notOver: Prisma.EventWhereInput = {
      OR: [{ endsAt: { gte: now } }, { endsAt: null, startsAt: { gte: assumedStart } }],
    };
    // Spelled out rather than NOT(notOver): with ends_at NULL, "ends_at >= now" is NULL, and
    // NOT(NULL OR FALSE) is NULL, so events without an end time would vanish from both lists.
    const over: Prisma.EventWhereInput = {
      OR: [{ endsAt: { lt: now } }, { endsAt: null, startsAt: { lt: assumedStart } }],
    };
    const upcoming = query.when === 'upcoming';
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const after: Prisma.EventWhereInput | undefined = cursor
      ? upcoming
        ? {
            OR: [{ startsAt: { gt: cursor.at } }, { startsAt: cursor.at, id: { gt: cursor.id } }],
          }
        : {
            OR: [{ startsAt: { lt: cursor.at } }, { startsAt: cursor.at, id: { lt: cursor.id } }],
          }
      : undefined;

    const [rows, activeIds] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          groupId,
          AND: [upcoming ? notOver : over, ...(after ? [after] : [])],
        },
        include: eventInclude,
        orderBy: upcoming
          ? [{ startsAt: 'asc' }, { id: 'asc' }]
          : [{ startsAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.activeIds(groupId),
    ]);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((e) => toEventSummary(e, { userId, role: membership.role }, activeIds)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.startsAt, last.id) : null,
    };
  }

  async get(eventId: string, userId: string): Promise<EventDetailResponse> {
    const { event, membership, group } = await this.load(eventId, userId);
    const [activeIds, spending] = await Promise.all([
      this.activeIds(event.groupId),
      this.prisma.expense.aggregate({
        where: { eventId, deletedAt: null },
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    return {
      ...toEventSummary(event, { userId, role: membership.role }, activeIds),
      description: event.description,
      rsvps: event.rsvps
        .filter((r) => activeIds.has(r.userId))
        .map((r) => ({
          ...toPerson(r.user),
          status: r.status,
          updatedAt: r.updatedAt.toISOString(),
        })),
      spending: {
        count: spending._count,
        total: Number(spending._sum.amount ?? 0n),
        currency: group.currency,
      },
      updatedAt: event.updatedAt.toISOString(),
    };
  }

  /** Any member can plan something. The person who creates it is going. */
  async create(groupId: string, userId: string, input: EventInput): Promise<EventDetailResponse> {
    await this.access.require(groupId, userId, { requireActive: true });
    let planned: ReminderChange | undefined;
    const id = await this.prisma.$transaction(async (tx) => {
      await this.requireOpenGroup(tx, groupId, userId);
      const event = await tx.event.create({
        data: {
          groupId,
          title: input.title,
          description: input.description,
          location: input.location,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          createdBy: userId,
          rsvps: { create: { userId, status: 'going' } },
        },
      });
      await this.log(tx, event.groupId, userId, 'event.created', event.id, {
        after: eventSnapshot(event),
      });
      await this.notify(tx, 'event.created', userId, event);
      planned = await this.reminders.plan(tx, event.id, event.startsAt);
      return event.id;
    });
    this.outbox.kick();
    if (planned) await this.reminders.schedule(planned);
    return this.get(id, userId);
  }

  async update(eventId: string, userId: string, input: EventUpdate): Promise<EventDetailResponse> {
    const { event } = await this.load(eventId, userId);
    let planned: ReminderChange | undefined;
    await this.prisma.$transaction(async (tx) => {
      const role = await this.requireOpenGroup(tx, event.groupId, userId);
      this.assertCanEdit(event, userId, role);
      if (event.status === 'cancelled') throw new ConflictException(CANCELLED);

      const { count } = await tx.event.updateMany({
        where: { id: eventId, version: input.version, status: 'scheduled' },
        data: {
          title: input.title,
          description: input.description,
          location: input.location,
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          version: { increment: 1 },
        },
      });
      if (count === 0) throw new ConflictException(CONFLICT);
      const after = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
      await this.log(tx, event.groupId, userId, 'event.updated', eventId, {
        before: eventSnapshot(event),
        after: eventSnapshot(after),
      });
      // Only changes people need to act on: when and where. A reworded title isn't news.
      const moved =
        after.startsAt.getTime() !== event.startsAt.getTime() ||
        after.endsAt?.getTime() !== event.endsAt?.getTime() ||
        after.location !== event.location;
      if (moved) await this.notify(tx, 'event.updated', userId, after);
      if (after.startsAt.getTime() !== event.startsAt.getTime()) {
        planned = await this.reminders.plan(tx, eventId, after.startsAt);
      }
    });
    this.outbox.kick();
    if (planned) await this.reminders.schedule(planned);
    return this.get(eventId, userId);
  }

  /** Cancelling keeps the event, its comments and its expenses; nobody can RSVP any more. */
  async cancel(eventId: string, userId: string): Promise<EventDetailResponse> {
    const { event } = await this.load(eventId, userId);
    let planned: ReminderChange | undefined;
    await this.prisma.$transaction(async (tx) => {
      const role = await this.requireOpenGroup(tx, event.groupId, userId);
      this.assertCanEdit(event, userId, role);
      const { count } = await tx.event.updateMany({
        where: { id: eventId, status: 'scheduled' },
        data: { status: 'cancelled', cancelledAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictException('This event is already cancelled');
      await this.log(tx, event.groupId, userId, 'event.cancelled', eventId, {
        before: eventSnapshot(event),
      });
      await this.notify(tx, 'event.cancelled', userId, event);
      planned = await this.reminders.plan(tx, eventId, null);
    });
    this.outbox.kick();
    if (planned) await this.reminders.schedule(planned);
    return this.get(eventId, userId);
  }

  async rsvp(eventId: string, userId: string, status: RsvpStatus): Promise<EventDetailResponse> {
    const { event } = await this.load(eventId, userId);
    await this.prisma.$transaction(async (tx) => {
      await this.requireOpenGroup(tx, event.groupId, userId);
      // FOR SHARE: waits for a cancel or edit in flight, and blocks one from starting.
      const [locked] = await tx.$queryRaw<{ status: string }[]>`
        SELECT status::text FROM events WHERE id = ${eventId}::uuid FOR SHARE`;
      if (!locked) throw new NotFoundException(NOT_FOUND);
      if (locked.status === 'cancelled') throw new ConflictException(CANCELLED);
      await tx.eventRsvp.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { eventId, userId, status },
        update: { status },
      });
    });
    return this.get(eventId, userId);
  }

  // ---------- Comments ----------

  async comments(
    eventId: string,
    userId: string,
    query: ListCommentsQuery,
  ): Promise<CommentPageResponse> {
    const { membership } = await this.load(eventId, userId);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.prisma.eventComment.findMany({
      where: {
        eventId,
        deletedAt: null,
        ...(cursor && {
          OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
        }),
      },
      include: { author: { select: personSelect } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((c) => this.toComment(c, userId, membership.role)),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  async addComment(
    eventId: string,
    userId: string,
    input: CreateCommentInput,
  ): Promise<CommentResponse> {
    const { event } = await this.load(eventId, userId);
    const comment = await this.prisma.$transaction(async (tx) => {
      const role = await this.requireOpenGroup(tx, event.groupId, userId);
      const created = await tx.eventComment.create({
        data: { eventId, authorId: userId, body: input.body },
        include: { author: { select: personSelect } },
      });
      // The planner and anyone going or maybe; not everyone in the group.
      const attending = await tx.eventRsvp.findMany({
        where: { eventId, status: { in: ['going', 'maybe'] } },
        select: { userId: true },
      });
      await this.notify(tx, 'event.commented', userId, event, {
        userIds: [event.createdBy, ...attending.map((r) => r.userId)],
        excerpt: input.body.length > 80 ? `${input.body.slice(0, 79)}…` : input.body,
      });
      return { created, role };
    });
    this.outbox.kick();
    return this.toComment(comment.created, userId, comment.role);
  }

  /** The author can delete their comment; admins can delete any (moderation). */
  async deleteComment(commentId: string, userId: string): Promise<void> {
    const comment = await this.prisma.eventComment.findFirst({
      where: { id: commentId, deletedAt: null },
      include: { event: { select: { groupId: true } } },
    });
    if (!comment) throw new NotFoundException(COMMENT_NOT_FOUND);
    const { membership } = await this.requireMember(
      comment.event.groupId,
      userId,
      COMMENT_NOT_FOUND,
    );
    if (comment.authorId !== userId && !roleAtLeast(membership.role, 'admin')) {
      throw new ForbiddenException('Only the person who wrote it or a group admin can delete it');
    }
    const { count } = await this.prisma.eventComment.updateMany({
      where: { id: commentId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: userId },
    });
    if (count === 0) throw new NotFoundException(COMMENT_NOT_FOUND);
    if (comment.authorId !== userId) {
      await this.prisma.activityLog.create({
        data: {
          groupId: comment.event.groupId,
          actorId: userId,
          action: 'comment.removed',
          entity: 'event_comment',
          entityId: commentId,
          diff: { authorId: comment.authorId },
        },
      });
    }
  }

  // ---------- helpers ----------

  /** An event the user can see. Non-members get the same 404 as a missing id. */
  private async load(eventId: string, userId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: eventInclude,
    });
    if (!event) throw new NotFoundException(NOT_FOUND);
    const { membership, group } = await this.requireMember(event.groupId, userId, NOT_FOUND);
    return { event, membership, group };
  }

  private async requireMember(groupId: string, userId: string, notFound: string) {
    try {
      return await this.access.require(groupId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException(notFound);
      throw error;
    }
  }

  /**
   * Inside a transaction: the group exists and isn't archived, and the user is still an
   * active member (locked FOR SHARE, so they can't leave halfway). Returns their current role.
   */
  private async requireOpenGroup(tx: Tx, groupId: string, userId: string): Promise<GroupRole> {
    const group = await lockGroup(tx, groupId, 'share');
    if (!group) throw new NotFoundException('Group not found');
    if (group.archived) {
      throw new ConflictException('This group is archived. Unarchive it to make changes.');
    }
    const role = (await lockActiveMembers(tx, groupId, [userId])).get(userId);
    if (!role) throw new NotFoundException('Group not found');
    return role;
  }

  private assertCanEdit(event: EventWithPeople, userId: string, role: GroupRole): void {
    if (!canEditEvent(event, userId, role)) {
      throw new ForbiddenException('Only the person who planned it or a group admin can change it');
    }
  }

  private async activeIds(groupId: string): Promise<Set<string>> {
    const rows = await this.prisma.groupMember.findMany({
      where: { groupId, leftAt: null },
      select: { userId: true },
    });
    return new Set(rows.map((r) => r.userId));
  }

  private toComment(
    comment: {
      id: string;
      eventId: string;
      authorId: string;
      body: string;
      createdAt: Date;
      author: { id: string; name: string; avatarKey: string | null };
    },
    userId: string,
    role: GroupRole,
  ): CommentResponse {
    return {
      id: comment.id,
      eventId: comment.eventId,
      author: toPerson(comment.author),
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      canDelete: comment.authorId === userId || roleAtLeast(role, 'admin'),
    };
  }

  private async notify(
    tx: Tx,
    type: 'event.created' | 'event.updated' | 'event.cancelled' | 'event.commented',
    actorId: string,
    event: { id: string; groupId: string; title: string; startsAt: Date },
    only?: { userIds: string[]; excerpt: string },
  ): Promise<void> {
    await this.outbox.add(tx, {
      type,
      groupId: event.groupId,
      actorId,
      audience: only ? { kind: 'users', userIds: [...new Set(only.userIds)] } : { kind: 'group' },
      data: {
        groupId: event.groupId,
        ...(await this.outbox.names(tx, event.groupId, actorId)),
        eventId: event.id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        ...(only && { excerpt: only.excerpt }),
      },
    });
  }

  private async log(
    tx: Tx,
    groupId: string,
    actorId: string,
    action: string,
    entityId: string,
    diff: object,
  ): Promise<void> {
    await tx.activityLog.create({
      data: { groupId, actorId, action, entity: 'event', entityId, diff },
    });
  }
}
