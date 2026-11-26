import { z } from 'zod';

/** Languages the app speaks. The web app, emails and notification text all follow the user's. */
export const LOCALES = ['en', 'vi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Where the groups meet, and the time zone for anyone who hasn't set one. */
export const DEFAULT_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/** "vi-VN", "vi" → "vi"; anything else → English. */
export function toLocale(value: string | null | undefined): Locale {
  const base = value?.toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base ?? '') ? (base as Locale) : DEFAULT_LOCALE;
}

/** True for an IANA time zone this runtime knows, e.g. "Asia/Ho_Chi_Minh". */
export function isTimeZone(value: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const localeSchema = z.enum(LOCALES, { error: 'Choose English or Vietnamese' });
export const timeZoneSchema = z
  .string({ error: 'Choose a time zone' })
  .max(64, 'Choose a time zone')
  .refine(isTimeZone, 'Choose a time zone');

/** How a person wants dates and text: their language and time zone. */
export interface LocaleOptions {
  locale?: Locale;
  timeZone?: string;
}
