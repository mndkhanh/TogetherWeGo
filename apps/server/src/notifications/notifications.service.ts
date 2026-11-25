import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  type ListNotificationsQuery,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_TYPES,
  type NotificationPageResponse,
  type NotificationPreferenceResponse,
  type NotificationPreferencesInput,
  toLocale,
} from '@twg/shared';
import { personSelect } from '../expenses/expense-mappers.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { toNotificationResponse } from './notification-mappers.js';

/** The in-app feed and preferences. Every query is scoped to the signed-in user. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: ListNotificationsQuery): Promise<NotificationPageResponse> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const [rows, unreadCount, reader] = await Promise.all([
      this.prisma.notification.findMany({
        where: {
          userId,
          ...(cursor && {
            OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      }),
      this.unreadCount(userId),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { locale: true, timeZone: true },
      }),
    ]);
    const page = rows.slice(0, query.limit);
    const actorIds = [...new Set(page.map((r) => r.actorId).filter((id) => id !== null))];
    const actors = new Map(
      (
        await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: personSelect })
      ).map((a) => [a.id, a]),
    );
    const last = page.at(-1);
    return {
      items: page.map((r) =>
        toNotificationResponse(r, r.actorId ? (actors.get(r.actorId) ?? null) : null, {
          locale: toLocale(reader.locale),
          timeZone: reader.timeZone,
        }),
      ),
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(`${last.createdAt.toISOString()}_${last.id}`).toString('base64url')
          : null,
      unreadCount,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Only your own: someone else's id is "not found", never a hint that it exists. */
  async markRead(userId: string, notificationId: string): Promise<{ unreadCount: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { readAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Notification not found');
    return { unreadCount: await this.unreadCount(userId) };
  }

  async markAllRead(userId: string): Promise<{ unreadCount: number }> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { unreadCount: 0 };
  }

  async preferences(userId: string): Promise<NotificationPreferenceResponse[]> {
    const overrides = new Map(
      (await this.prisma.notificationPreference.findMany({ where: { userId } })).map((p) => [
        p.type,
        p,
      ]),
    );
    return NOTIFICATION_TYPES.map((type) => {
      const defaults = NOTIFICATION_DEFAULTS[type];
      const own = overrides.get(type);
      return {
        type,
        ...defaults,
        inApp: own?.inApp ?? defaults.inApp,
        email: own?.email ?? defaults.email,
      };
    });
  }

  /** Stores only what differs from the defaults, so changing a default later reaches everyone. */
  async savePreferences(
    userId: string,
    input: NotificationPreferencesInput,
  ): Promise<NotificationPreferenceResponse[]> {
    await this.prisma.$transaction(async (tx) => {
      for (const pref of input.preferences) {
        const defaults = NOTIFICATION_DEFAULTS[pref.type];
        const key = { userId_type: { userId, type: pref.type } };
        if (pref.inApp === defaults.inApp && pref.email === defaults.email) {
          await tx.notificationPreference.deleteMany({ where: { userId, type: pref.type } });
        } else {
          await tx.notificationPreference.upsert({
            where: key,
            create: { userId, type: pref.type, inApp: pref.inApp, email: pref.email },
            update: { inApp: pref.inApp, email: pref.email },
          });
        }
      }
    });
    return this.preferences(userId);
  }
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString();
  const match =
    /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      text,
    );
  const at = match ? new Date(match[1]!) : null;
  if (!match || !at || Number.isNaN(at.getTime())) throw new BadRequestException('Invalid cursor');
  return { at, id: match[2]! };
}
