import {
  describeNotification,
  type LocaleOptions,
  type NotificationData,
  type NotificationResponse,
  type NotificationType,
} from '@twg/shared';
import { toPerson } from '../expenses/expense-mappers.js';
import type { Notification, User } from '../generated/prisma/client.js';

type ActorRow = Pick<User, 'id' | 'name' | 'avatarKey'> | null;

/** The text is written now, in the reader's language and time zone. */
export function toNotificationResponse(
  row: Notification,
  actor: ActorRow,
  reader: LocaleOptions = {},
): NotificationResponse {
  const type = row.type as NotificationType;
  const data = row.data as NotificationData;
  return {
    id: row.id,
    type,
    actor: actor ? toPerson(actor) : null,
    data,
    ...describeNotification(type, data, reader),
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
