import { z } from 'zod';
import { DEFAULT_TIME_ZONE, type Locale, type LocaleOptions } from '../i18n/locale.js';
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
function owedTo(locale: Locale, amount: string, names: string[] = []): string {
  const [to, and, others] = locale === 'vi' ? ['cho', 'và', 'người khác'] : ['to', 'and', 'others'];
  if (names.length === 1) return `${names[0]} ${amount}`;
  if (names.length === 0) return amount;
  if (names.length <= 3) {
    return `${amount} ${to} ${names.slice(0, -1).join(', ')} ${and} ${names.at(-1)}`;
  }
  return `${amount} ${to} ${names.slice(0, 2).join(', ')} ${and} ${names.length - 2} ${others}`;
}

function formatWhen(iso: string, { locale = 'en', timeZone }: LocaleOptions): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timeZone ?? DEFAULT_TIME_ZONE,
  }).format(new Date(iso));
}

/**
 * The sentence and the in-app link for a notification, in the reader's language, with times in
 * their time zone (Vietnam time if they haven't set one). Pure text: callers escape it for HTML.
 * Amounts keep their currency's own format whatever the language (150.000 ₫, $12.50).
 */
export function describeNotification(
  type: NotificationType,
  data: NotificationData,
  options: LocaleOptions = {},
): { text: string; link: string } {
  const locale = options.locale ?? 'en';
  const vi = locale === 'vi';
  const who = data.actorName ?? (vi ? 'Ai đó' : 'Someone');
  const group = data.groupId ? `/groups/${data.groupId}` : '/';
  const amount = money(data.amount, data.currency);
  const yours =
    data.yourShare !== undefined && data.yourShare > 0 ? money(data.yourShare, data.currency) : '';
  const share = yours ? (vi ? ` Phần của bạn: ${yours}.` : ` Your share: ${yours}.`) : '';
  const when = data.startsAt ? formatWhen(data.startsAt, options) : '';
  const event = data.eventId ? `${group}/events/${data.eventId}` : group;
  const balances = `${group}?tab=balances`;
  const g = data.groupName;
  const at = data.location ? (vi ? ` tại ${data.location}` : ` at ${data.location}`) : '';
  const owed = owedTo(locale, amount, data.creditorNames);

  switch (type) {
    case 'expense.added':
      return {
        text: vi
          ? `${who} đã thêm ${data.title} (${amount}) trong ${g}.${share}`
          : `${who} added ${data.title} (${amount}) in ${g}.${share}`,
        link: group,
      };
    case 'expense.updated':
      return {
        text: vi
          ? `${who} đã sửa ${data.title} (${amount}) trong ${g}.${share}`
          : `${who} edited ${data.title} (${amount}) in ${g}.${share}`,
        link: group,
      };
    case 'expense.deleted':
      return {
        text: vi
          ? `${who} đã xoá ${data.title} (${amount}) trong ${g}.`
          : `${who} deleted ${data.title} (${amount}) in ${g}.`,
        link: group,
      };
    case 'event.created':
      return {
        text: vi
          ? `${who} đã lên lịch ${data.title} vào ${when} trong ${g}.`
          : `${who} planned ${data.title} for ${when} in ${g}.`,
        link: event,
      };
    case 'event.updated':
      return {
        text: vi
          ? `${data.title} trong ${g} đã dời sang ${when}.`
          : `${data.title} in ${g} moved to ${when}.`,
        link: event,
      };
    case 'event.cancelled':
      return {
        text: vi
          ? `${who} đã huỷ ${data.title} trong ${g}.`
          : `${who} cancelled ${data.title} in ${g}.`,
        link: event,
      };
    case 'event.commented':
      return {
        text: vi
          ? `${who} bình luận ở ${data.title}: “${data.excerpt}”`
          : `${who} on ${data.title}: “${data.excerpt}”`,
        link: event,
      };
    case 'settlement.requested':
      return {
        text: vi
          ? `${who} đang trả bạn ${amount} (${g}).`
          : `${who} is paying you ${amount} (${g}).`,
        link: balances,
      };
    case 'settlement.confirmed':
      // Sent to the payer; the actor is the person who was paid.
      if (data.via === 'sepay') {
        return {
          text: vi
            ? `Ngân hàng của ${who} đã xác nhận khoản ${amount} bạn trả (${g}).`
            : `${who}’s bank confirmed your payment of ${amount} (${g}).`,
          link: balances,
        };
      }
      return {
        text: vi
          ? `${who} đã xác nhận khoản ${amount} bạn trả (${g}).`
          : `${who} confirmed your payment of ${amount} (${g}).`,
        link: balances,
      };
    case 'settlement.cancelled':
      return {
        text: vi
          ? `${who} đã huỷ một khoản thanh toán ${amount} (${g}).`
          : `${who} cancelled a payment of ${amount} (${g}).`,
        link: balances,
      };
    case 'transfer.unmatched':
      return {
        text: vi
          ? `Có ${amount} chuyển đến mà không kèm mã thanh toán. Hãy cho biết ai đã gửi.`
          : `${amount} arrived without a payment code. Say who sent it.`,
        link: '/settings/payments',
      };
    case 'group.member_joined':
      return {
        text: vi ? `${who} đã tham gia ${g}.` : `${who} joined ${g}.`,
        link: `${group}?tab=members`,
      };
    case 'event.reminder':
      return {
        text: vi
          ? `Sắp diễn ra: ${data.title} trong ${g}, ${when}${at}.`
          : `Coming up: ${data.title} in ${g}, ${when}${at}.`,
        link: event,
      };
    case 'debt.reminder':
      return {
        text: vi ? `Bạn còn nợ ${owed} trong ${g}.` : `You owe ${owed} in ${g}.`,
        link: balances,
      };
  }
}
