import { z } from 'zod';
import type { Currency } from '../money/money.js';
import { bankByBin } from '../payments/banks.js';
import type { PersonRef } from './expenses.js';

// ---------- Payment account (where someone wants to be paid) ----------

/**
 * Bank transfers carry the holder name in capitals without accents ("NGUYEN VAN A"),
 * so that is how it is stored and shown on the QR screen.
 */
export function normalizeHolderName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export const paymentAccountSchema = z.object({
  bankBin: z
    .string({ error: 'Choose your bank' })
    .refine((bin) => bankByBin(bin) !== undefined, 'Choose your bank'),
  accountNumber: z
    .string({ error: 'Enter your account number' })
    .trim()
    .regex(/^[0-9A-Za-z]{4,24}$/, 'Use 4 to 24 letters or digits, no spaces'),
  holderName: z
    .string({ error: 'Enter the name on the account' })
    .transform(normalizeHolderName)
    .pipe(
      z
        .string()
        .min(2, 'Enter the name on the account')
        .max(60, 'Use 60 characters or fewer')
        .regex(/^[A-Z ]+$/, 'Use letters and spaces only'),
    ),
});
export type PaymentAccountInput = z.input<typeof paymentAccountSchema>;

export interface PaymentAccountResponse {
  bankBin: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  /** Whether SePay is set up to confirm payments to this account automatically. */
  sepayConnected: boolean;
  /** The last 4 characters of the current SePay key, to tell keys apart. */
  sepayKeyHint: string | null;
  /** When SePay last sent us a transfer for this account. */
  sepayLastEventAt: string | null;
  updatedAt: string;
}

/** Shown once, right after a key is made. Only a hash is kept. */
export interface SepayKeyResponse {
  apiKey: string;
  webhookUrl: string;
  account: PaymentAccountResponse;
}

// ---------- Settlements (one person paying another back) ----------

export const SETTLEMENT_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export type SettlementConfirmedVia = 'sepay' | 'manual';

/** Pending payment codes stop being offered after this; a late transfer still matches. */
export const SETTLEMENT_TTL_DAYS = 7;

export const createSettlementSchema = z
  .object({
    fromUserId: z.uuid({ error: 'Choose who paid' }),
    toUserId: z.uuid({ error: 'Choose who gets paid' }),
    amount: z
      .number({ error: 'Enter an amount' })
      .int('Enter a valid amount')
      .positive('Enter an amount greater than 0'),
  })
  .refine((v) => v.fromUserId !== v.toUserId, {
    path: ['toUserId'],
    message: 'Choose someone else',
  });
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;

export const confirmSettlementSchema = z.object({
  /** What actually arrived, if different from what was asked for. */
  amount: z
    .number({ error: 'Enter an amount' })
    .int('Enter a valid amount')
    .positive('Enter an amount greater than 0')
    .optional(),
});
export type ConfirmSettlementInput = z.infer<typeof confirmSettlementSchema>;

export interface PayeeBankDetails {
  bankBin: string;
  bankName: string;
  accountNumber: string;
  holderName: string;
  /** SePay QR image for the exact amount and payment code (VND only). */
  qrUrl: string | null;
}

export interface SettlementResponse {
  id: string;
  groupId: string;
  from: PersonRef;
  to: PersonRef;
  currency: Currency;
  /** What was asked for. */
  amount: number;
  /** What actually arrived; set once confirmed. */
  paidAmount: number | null;
  paymentCode: string;
  status: SettlementStatus;
  /** True for a pending payment whose code is older than SETTLEMENT_TTL_DAYS. */
  stale: boolean;
  confirmedVia: SettlementConfirmedVia | null;
  createdAt: string;
  confirmedAt: string | null;
  /** Whether the payee has SePay set up, so this can confirm itself. */
  autoConfirm: boolean;
  /** What the current user may do with it. */
  canConfirm: boolean;
  canCancel: boolean;
}

export interface SettlementDetailResponse extends SettlementResponse {
  /** Only for the two people involved, and only while it is pending. */
  payee: PayeeBankDetails | null;
}

// ---------- Transfers SePay saw that matched nothing ----------

export interface UnmatchedTransferResponse {
  id: string;
  amount: number;
  content: string;
  bankReference: string | null;
  transferredAt: string;
  receivedAt: string;
}

/** Assign a transfer to a pending payment, or record it as a new payment from someone. */
export const assignTransferSchema = z.union([
  z.object({ settlementId: z.uuid() }),
  z.object({ groupId: z.uuid(), fromUserId: z.uuid({ error: 'Choose who sent it' }) }),
]);
export type AssignTransferInput = z.infer<typeof assignTransferSchema>;

// ---------- SePay webhook body ----------

/**
 * What SePay POSTs for each transaction on a watched account
 * (https://docs.sepay.vn/tich-hop-webhooks.html). Unknown fields are ignored.
 */
export const sepayWebhookSchema = z.object({
  id: z.number().int().positive(),
  gateway: z.string().max(100),
  transactionDate: z.string().max(40),
  accountNumber: z.string().max(40),
  subAccount: z.string().max(40).nullable().optional(),
  code: z.string().max(100).nullable().optional(),
  content: z.string().max(1000),
  transferType: z.enum(['in', 'out']),
  transferAmount: z.number().int().positive().max(1e15),
  referenceCode: z.string().max(100).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
});
export type SepayWebhookInput = z.infer<typeof sepayWebhookSchema>;
