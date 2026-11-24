import { z } from 'zod';
import { type Currency, MAX_AMOUNT } from '../money/money.js';
import { computeSplits, SPLIT_TYPES, type SplitType } from '../money/splits.js';
import type { EventRef } from './events.js';
import { MAX_GROUP_MEMBERS } from './groups.js';

/** Receipt photos: what the browser may upload, and how big. */
export const RECEIPT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

const isoDate = z.iso.date({ error: 'Choose a date' });

/**
 * The fields of an expense, before checking the amount against the group's currency.
 * Use `expenseInputSchema(currency)` for the full rules.
 */
const expenseFields = z.object({
  title: z
    .string({ error: 'Say what it was for' })
    .trim()
    .min(1, 'Say what it was for')
    .max(80, 'Use 80 characters or fewer'),
  amount: z
    .number({ error: 'Enter an amount' })
    .int('Enter a valid amount')
    .positive('Enter an amount greater than 0'),
  payerId: z.uuid({ error: 'Choose who paid' }),
  splitType: z.enum(SPLIT_TYPES, { error: 'Choose how to split it' }),
  splits: z
    .array(
      z.object({
        userId: z.uuid(),
        value: z.number().int('Use whole numbers').min(0, 'Use numbers of 0 or more'),
      }),
    )
    .min(1, 'Choose who shared this expense')
    .max(MAX_GROUP_MEMBERS),
  /** The day it was spent, in the group's local calendar (YYYY-MM-DD). */
  spentOn: isoDate,
  note: z.string().trim().max(500, 'Use 500 characters or fewer').nullable().default(null),
  /** Key returned by the receipt upload endpoint, or null for no receipt. */
  receiptKey: z.string().max(200).nullable().default(null),
  /** The group event it was for, if any. */
  eventId: z.uuid().nullable().default(null),
});

function checkAmountAndSplits(
  value: z.output<typeof expenseFields>,
  ctx: z.RefinementCtx,
  currency: Currency,
): void {
  if (value.amount > MAX_AMOUNT[currency]) {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'That amount is too large' });
    return;
  }
  const result = computeSplits(value.amount, value.splitType, value.splits);
  if (!result.ok) {
    ctx.addIssue({ code: 'custom', path: ['splits'], message: result.error });
  }
}

export function createExpenseSchema(currency: Currency) {
  return expenseFields.superRefine((value, ctx) => checkAmountAndSplits(value, ctx, currency));
}
export type CreateExpenseInput = z.output<typeof expenseFields>;

/** Edits replace the whole expense. `version` must match, or someone else changed it first. */
const updateExpenseFields = expenseFields.extend({ version: z.number().int().min(1) });
export function updateExpenseSchema(currency: Currency) {
  return updateExpenseFields.superRefine((value, ctx) =>
    checkAmountAndSplits(value, ctx, currency),
  );
}
export type UpdateExpenseInput = z.output<typeof updateExpenseFields>;

/** Structure-only checks, used by the API before it knows the group's currency. */
export const createExpenseShape = expenseFields;
export const updateExpenseShape = updateExpenseFields;

export const receiptUploadSchema = z.object({
  contentType: z.enum(RECEIPT_CONTENT_TYPES, { error: 'Use a JPEG, PNG or WebP photo' }),
  size: z
    .number()
    .int()
    .positive()
    .max(MAX_RECEIPT_BYTES, `Use a photo under ${MAX_RECEIPT_BYTES / 1024 / 1024} MB`),
});
export type ReceiptUploadInput = z.infer<typeof receiptUploadSchema>;

export const listExpensesQuerySchema = z.object({
  /** Only the expenses linked to this event. */
  eventId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

// ---------- Response shapes ----------

export interface PersonRef {
  userId: string;
  name: string;
  avatarUrl: string | null;
}

export interface ExpenseSplitResponse extends PersonRef {
  amount: number;
  /** The value that was entered: amount, basis points or shares, depending on splitType. */
  value: number;
}

export interface ExpenseResponse {
  id: string;
  groupId: string;
  title: string;
  amount: number;
  currency: Currency;
  payer: PersonRef;
  splitType: SplitType;
  splits: ExpenseSplitResponse[];
  spentOn: string;
  note: string | null;
  hasReceipt: boolean;
  /** The event it was for, if any. */
  event: EventRef | null;
  createdBy: PersonRef;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** Whether the current user may edit or delete it (creator, payer, or admin). */
  canEdit: boolean;
  /** The current user's own part of it: what they paid minus their share. */
  myNet: number;
}

export interface ExpenseHistoryEntry {
  action: 'created' | 'updated' | 'deleted';
  actor: PersonRef;
  at: string;
  /** Human-readable list of what changed, e.g. "Amount: 300.000 ₫ → 360.000 ₫". */
  changes: string[];
}

export interface ExpenseDetailResponse extends ExpenseResponse {
  /** Storage key of the receipt, sent back unchanged when editing keeps the same photo. */
  receiptKey: string | null;
  /** Short-lived link to the receipt photo, when there is one. */
  receiptUrl: string | null;
  history: ExpenseHistoryEntry[];
}

export interface ExpensePageResponse {
  items: ExpenseResponse[];
  nextCursor: string | null;
}

export interface BalanceMemberResponse extends PersonRef {
  /** Positive: the group owes them. Negative: they owe. */
  net: number;
  /** False for people who have left the group. */
  active: boolean;
}

export interface BalancesResponse {
  currency: Currency;
  totalSpent: number;
  members: BalanceMemberResponse[];
  /** Suggested payments that settle everyone up. */
  transfers: { fromUserId: string; toUserId: string; amount: number }[];
}

export interface ReceiptUploadResponse {
  key: string;
  /** Browser uploads with a multipart POST to `url`, including `fields` before the file. */
  url: string;
  fields: Record<string, string>;
}
