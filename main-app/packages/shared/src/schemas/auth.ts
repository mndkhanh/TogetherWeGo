import { z } from 'zod';
import { type Locale, localeSchema, timeZoneSchema } from '../i18n/locale.js';

// Messages are shown to users as-is in the web forms, so they are written as instructions.

export const emailSchema = z
  .string({ error: 'Enter your email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter your email address')
  .max(254, 'Email address is too long')
  .pipe(z.email('Enter a valid email address, like name@example.com'));

export const passwordSchema = z
  .string({ error: 'Choose a password' })
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use 128 characters or fewer');

export const nameSchema = z
  .string({ error: 'Enter your name' })
  .trim()
  .min(1, 'Enter your name')
  .max(80, 'Use 80 characters or fewer');

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: nameSchema,
  /** The language and time zone the person signed up in; defaults if left out. */
  locale: localeSchema.optional(),
  timeZone: timeZoneSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: 'Enter your password' })
    .min(1, 'Enter your password')
    .max(128, 'Use 128 characters or fewer'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateMeSchema = z
  .object({
    name: nameSchema,
    defaultCurrency: z.enum(['VND', 'USD'], { error: 'Choose VND or USD' }),
    locale: localeSchema,
    timeZone: timeZoneSchema,
  })
  .partial();
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

/** Public shape of the signed-in user returned by the API. */
export interface MeResponse {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  defaultCurrency: 'VND' | 'USD';
  locale: Locale;
  timeZone: string;
  hasPassword: boolean;
  googleLinked: boolean;
  createdAt: string;
}

export interface AuthProvidersResponse {
  password: boolean;
  google: boolean;
}

export interface AuthResponse {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: MeResponse;
}
