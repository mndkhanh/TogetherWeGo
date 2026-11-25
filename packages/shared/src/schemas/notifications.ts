import { z } from 'zod';
import { type Currency, formatMoney } from '../money/money.js';
import type { PersonRef } from './expenses.js';

/**
 * Everything that can notify someone. Each type has a default for the in-app feed and for
 * email; people can change both per type.
 */
export const NOTIFICATION_TYPES = [
  'expense.added',
  'expense.updated',
  'expense.deleted',
  'event.created',
  'event.updated',
  'event.cancelled',
  'event.commented',
  'event.reminder',
  'settlement.requested',
  'settlement.confirmed',
  'settlement.cancelled',
  'transfer.unmatched',
  'group.member_joined',
  'debt.reminder',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationTypeInfo {
  /** What the setting is called on the preferences screen. */
  label: string;
  /** Who gets it, in a few words. */
  audience: string;
  inApp: boolean;
  email: boolean;
}

export const NOTIFICATION_DEFAULTS: Record<NotificationType, NotificationTypeInfo> = {
  'expense.added': {
    label: 'New expenses',
    audience: 'You’re part of it',
    inApp: true,
    email: false,
  },
  'expense.updated': {
    label: 'Edited expenses',
    audience: 'You’re part of it',
    inApp: true,
    email: false,
  },
  'expense.deleted': {
    label: 'Deleted expenses',
    audience: 'You were part of it',
    inApp: true,
    email: false,
  },
  'event.created': { label: 'New events', audience: 'Your groups', inApp: true, email: true },
  'event.updated': {
    label: 'Event time or place changed',
    audience: 'Your groups',
    inApp: true,
    email: true,
  },
  'event.cancelled': {
    label: 'Cancelled events',
    audience: 'Your groups',
    inApp: true,
    email: true,
  },
  'event.commented': {
    label: 'Event chat',
    audience: 'Events you’re going to',
    inApp: true,
    email: false,
  },
  'event.reminder': {
    label: 'Event reminders',
    audience: 'A day and an hour before events you’re going to',
    inApp: true,
    email: true,
  },
  'settlement.requested': {
    label: 'Someone is paying you',
    audience: 'Payments to you',
    inApp: true,
    email: true,
  },
  'settlement.confirmed': {
    label: 'Payment confirmed',
    audience: 'Your payments',
    inApp: true,
    email: true,
  },
  'settlement.cancelled': {
    label: 'Payment cancelled',
    audience: 'Your payments',
    inApp: true,
    email: false,
  },
  'transfer.unmatched': {
    label: 'Transfer to sort out',
    audience: 'Money SePay saw arrive',
    inApp: true,
    email: true,
  },
  'group.member_joined': {
    label: 'New members',
    audience: 'Your groups',
    inApp: true,
    email: false,
  },
  'debt.reminder': {
    label: 'What you still owe',
    audience: 'Monday mornings, while you owe something',
    inApp: true,
    email: true,
  },
};

export const notificationPreferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.enum(NOTIFICATION_TYPES),
        inApp: z.boolean(),
        email: z.boolean(),
      }),
    )
    .max(NOTIFICATION_TYPES.length),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const listNotificationsQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

/**
 * What a notification remembers about the moment it happened (names and titles as they
 * were then). Only facts the recipient was allowed to see.
 */
export interface NotificationData {
  groupId?: string;
  groupName?: string;
  actorName?: string;
  title?: string;
  amount?: number;
  currency?: Currency;
  /** The recipient's own share of an expense. */
  yourShare?: number;
  startsAt?: string;
  expenseId?: string;
  eventId?: string;
  settlementId?: string;
  excerpt?: string;
  via?: 'sepay' | 'manual';
  location?: string;
  /** Debt reminders: who the suggested payments go to, largest first. */
  creditorNames?: string[];
}

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  actor: PersonRef | null;
  data: NotificationData;
  /** One sentence, e.g. "An added Dinner (300.000 ₫). Your share: 100.000 ₫". */
  text: string;
  /** Where tapping it goes, inside the app. */
  link: string;
  read: boolean;
  createdAt: string;
}

export interface NotificationPageResponse {
  items: NotificationResponse[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface NotificationPreferenceResponse extends NotificationTypeInfo {
  type: NotificationType;
}

/** Pushed over the WebSocket when something new arrives. */
export interface RealtimeNotification {
  notification: NotificationResponse;
  unreadCount: number;
}

// ---------- One sentence per notification, for the feed and for email ----------

const MONEY_LOCALE: Record<Currency, string> = { VND: 'vi-VN', USD: 'en-US' };

function money(amount: number | undefined, currency: Currency | undefined): string {
  if (amount === undefined || !currency) return '';
  return formatMoney(amount, currency, MONEY_LOCALE[currency]);
}

/** "An 150.000 ₫", or "150.000 ₫ to An and Bình", or "… to An, Bình and 2 others". */
function owedTo(amount: string, names: string[] = []): string {
  if (names.length === 1) return `${names[0]} ${amount}`;
  if (names.length === 0) return amount;
  if (names.length <= 3) return `${amount} to ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  return `${amount} to ${names.slice(0, 2).join(', ')} and ${names.length - 2} others`;
}

const whenFormat = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
});

/**
 * The sentence and the in-app link for a notification. Pure text: callers escape it for HTML.
 * Times are shown in Vietnam time, since that's where the groups meet (per-user time zones
 * come with Phase 7).
 */
export function describeNotification(
  type: NotificationType,
  data: NotificationData,
): { text: string; link: string } {
  const who = data.actorName ?? 'Someone';
  const group = data.groupId ? `/groups/${data.groupId}` : '/';
  const amount = money(data.amount, data.currency);
  const share =
    data.yourShare !== undefined && data.yourShare > 0
      ? ` Your share: ${money(data.yourShare, data.currency)}.`
      : '';
  const when = data.startsAt ? whenFormat.format(new Date(data.startsAt)) : '';
  const event = data.eventId ? `${group}/events/${data.eventId}` : group;
  const balances = `${group}?tab=balances`;

  switch (type) {
    case 'expense.added':
      return {
        text: `${who} added ${data.title} (${amount}) in ${data.groupName}.${share}`,
        link: group,
      };
    case 'expense.updated':
      return {
        text: `${who} edited ${data.title} (${amount}) in ${data.groupName}.${share}`,
        link: group,
      };
    case 'expense.deleted':
      return {
        text: `${who} deleted ${data.title} (${amount}) in ${data.groupName}.`,
        link: group,
      };
    case 'event.created':
      return {
        text: `${who} planned ${data.title} for ${when} in ${data.groupName}.`,
        link: event,
      };
    case 'event.updated':
      return { text: `${data.title} in ${data.groupName} moved to ${when}.`, link: event };
    case 'event.cancelled':
      return { text: `${who} cancelled ${data.title} in ${data.groupName}.`, link: event };
    case 'event.commented':
      return { text: `${who} on ${data.title}: “${data.excerpt}”`, link: event };
    case 'settlement.requested':
      return { text: `${who} is paying you ${amount} (${data.groupName}).`, link: balances };
    case 'settlement.confirmed':
      return {
        // Sent to the payer; the actor is the person who was paid.
        text:
          data.via === 'sepay'
            ? `${who}’s bank confirmed your payment of ${amount} (${data.groupName}).`
            : `${who} confirmed your payment of ${amount} (${data.groupName}).`,
        link: balances,
      };
    case 'settlement.cancelled':
      return {
        text: `${who} cancelled a payment of ${amount} (${data.groupName}).`,
        link: balances,
      };
    case 'transfer.unmatched':
      return {
        text: `${amount} arrived without a payment code. Say who sent it.`,
        link: '/settings/payments',
      };
    case 'group.member_joined':
      return { text: `${who} joined ${data.groupName}.`, link: `${group}?tab=members` };
    case 'event.reminder':
      return {
        text: `Coming up: ${data.title} in ${data.groupName}, ${when}${data.location ? ` at ${data.location}` : ''}.`,
        link: event,
      };
    case 'debt.reminder':
      return {
        text: `You owe ${owedTo(amount, data.creditorNames)} in ${data.groupName}.`,
        link: balances,
      };
  }
}
