import { z } from 'zod';
import type { Currency } from '../money/money.js';
import type { PersonRef } from './expenses.js';

export const RSVP_STATUSES = ['going', 'maybe', 'no'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const EVENT_STATUSES = ['scheduled', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Longest an event can run, e.g. a trip. */
export const MAX_EVENT_DAYS = 30;
/** An event with no end time counts as running this long, for "upcoming" vs "past". */
export const DEFAULT_EVENT_HOURS = 3;
export const MAX_COMMENT_LENGTH = 1000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use ${max} characters or fewer`)
    .nullable()
    .default(null)
    .transform((value) => (value === '' ? null : value));

/** An instant with a time zone offset, e.g. 2026-12-24T19:00:00.000Z or …+07:00. */
const instant = (message: string) => z.iso.datetime({ offset: true, error: message });

const eventFields = z.object({
  title: z
    .string({ error: 'Give the event a name' })
    .trim()
    .min(1, 'Give the event a name')
    .max(80, 'Use 80 characters or fewer'),
  startsAt: instant('Choose when it starts'),
  endsAt: instant('Enter a valid end time').nullable().default(null),
  location: optionalText(200),
  description: optionalText(2000),
});

function checkTimes(value: z.output<typeof eventFields>, ctx: z.RefinementCtx): void {
  if (!value.endsAt) return;
  const start = Date.parse(value.startsAt);
  const end = Date.parse(value.endsAt);
  if (end <= start) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End after it starts' });
  } else if (end - start > MAX_EVENT_DAYS * 24 * 3600 * 1000) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: `Events can last up to ${MAX_EVENT_DAYS} days`,
    });
  }
}

export const createEventSchema = eventFields.superRefine(checkTimes);
export type CreateEventInput = z.input<typeof createEventSchema>;

/** Edits replace the whole event. `version` must match, or someone else changed it first. */
export const updateEventSchema = eventFields
  .extend({ version: z.number().int().min(1) })
  .superRefine(checkTimes);
export type UpdateEventInput = z.input<typeof updateEventSchema>;

export const rsvpSchema = z.object({
  status: z.enum(RSVP_STATUSES, { error: 'Choose going, maybe or can’t go' }),
});
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const createCommentSchema = z.object({
  body: z
    .string({ error: 'Write something first' })
    .trim()
    .min(1, 'Write something first')
    .max(MAX_COMMENT_LENGTH, `Use ${MAX_COMMENT_LENGTH} characters or fewer`),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const listEventsQuerySchema = z.object({
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;

export const listCommentsQuerySchema = z.object({
  /** Comments are read newest first; the cursor goes further back. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;

// ---------- Response shapes ----------

export interface EventRef {
  id: string;
  title: string;
  startsAt: string;
}

export interface EventSummaryResponse {
  id: string;
  groupId: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  status: EventStatus;
  createdBy: PersonRef;
  going: number;
  maybe: number;
  /** Up to 5 people who are going, for avatar stacks. */
  goingPreview: PersonRef[];
  myRsvp: RsvpStatus | null;
  commentCount: number;
  /** Creator or a group admin may edit or cancel it. */
  canEdit: boolean;
  version: number;
}

export interface EventRsvpResponse extends PersonRef {
  status: RsvpStatus;
  updatedAt: string;
}

export interface EventDetailResponse extends EventSummaryResponse {
  description: string | null;
  /** Current members only. */
  rsvps: EventRsvpResponse[];
  /** Expenses linked to this event. */
  spending: { count: number; total: number; currency: Currency };
  updatedAt: string;
}

export interface EventPageResponse {
  items: EventSummaryResponse[];
  nextCursor: string | null;
}

export interface CommentResponse {
  id: string;
  eventId: string;
  author: PersonRef;
  body: string;
  createdAt: string;
  /** The author, or a group admin. */
  canDelete: boolean;
}

export interface CommentPageResponse {
  /** Newest first. */
  items: CommentResponse[];
  nextCursor: string | null;
}
