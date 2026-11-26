import { createHash, randomBytes } from 'node:crypto';
import {
  bankByBin,
  PAYMENT_CODE_ALPHABET,
  PAYMENT_CODE_LENGTH,
  PAYMENT_CODE_PREFIX,
  type PaymentAccountResponse,
  SETTLEMENT_TTL_DAYS,
  type SettlementResponse,
  type UnmatchedTransferResponse,
} from '@twg/shared';
import { personSelect, toPerson } from '../expenses/expense-mappers.js';
import type {
  PaymentAccount,
  SepayTransaction,
  Settlement,
  User,
} from '../generated/prisma/client.js';

type PersonRow = Pick<User, 'id' | 'name' | 'avatarKey'>;

/** Random payment code, e.g. TWG8K3F2QHN. 31^8 ≈ 8.5e11 possibilities. */
export function newPaymentCode(): string {
  const bytes = randomBytes(PAYMENT_CODE_LENGTH * 2);
  let code = PAYMENT_CODE_PREFIX;
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % PAYMENT_CODE_ALPHABET.length);
  for (const byte of bytes) {
    if (byte >= limit) continue;
    code += PAYMENT_CODE_ALPHABET[byte % PAYMENT_CODE_ALPHABET.length];
    if (code.length === PAYMENT_CODE_PREFIX.length + PAYMENT_CODE_LENGTH) return code;
  }
  return newPaymentCode(); // astronomically rare: too many bytes rejected
}

/** A new SePay API key (256 random bits) and the hash we keep instead of it. */
export function newSepayKey(): { key: string; hash: string; hint: string } {
  const key = `twg_${randomBytes(32).toString('base64url')}`;
  return { key, hash: hashSepayKey(key), hint: key.slice(-4) };
}

/** The key has 256 bits of entropy, so a fast hash is enough (no salt or KDF needed). */
export function hashSepayKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Whether payments to this account confirm themselves. */
export function canAutoConfirm(account: Pick<PaymentAccount, 'bankBin' | 'sepayKeyHash'> | null) {
  return Boolean(account?.sepayKeyHash && bankByBin(account.bankBin)?.sepay);
}

export function toPaymentAccountResponse(account: PaymentAccount): PaymentAccountResponse {
  return {
    bankBin: account.bankBin,
    bankName: bankByBin(account.bankBin)?.name ?? account.bankBin,
    accountNumber: account.accountNumber,
    holderName: account.holderName,
    sepayConnected: account.sepayKeyHash !== null,
    sepayKeyHint: account.sepayKeyHint,
    sepayLastEventAt: account.sepayLastEventAt?.toISOString() ?? null,
    updatedAt: account.updatedAt.toISOString(),
  };
}

export const settlementInclude = {
  from: { select: personSelect },
  to: {
    select: {
      ...personSelect,
      paymentAccount: { select: { bankBin: true, sepayKeyHash: true } },
    },
  },
} as const;

export type SettlementWithPeople = Settlement & {
  from: PersonRow;
  to: PersonRow & { paymentAccount: Pick<PaymentAccount, 'bankBin' | 'sepayKeyHash'> | null };
};

export function toSettlementResponse(
  settlement: SettlementWithPeople,
  userId: string,
  now = new Date(),
): SettlementResponse {
  const pending = settlement.status === 'pending';
  const ttlMs = SETTLEMENT_TTL_DAYS * 24 * 60 * 60 * 1000;
  return {
    id: settlement.id,
    groupId: settlement.groupId,
    from: toPerson(settlement.from),
    to: toPerson(settlement.to),
    currency: settlement.currency,
    amount: Number(settlement.amount),
    paidAmount: settlement.paidAmount === null ? null : Number(settlement.paidAmount),
    paymentCode: settlement.paymentCode,
    status: settlement.status,
    stale: pending && now.getTime() - settlement.createdAt.getTime() > ttlMs,
    confirmedVia: settlement.confirmedVia,
    createdAt: settlement.createdAt.toISOString(),
    confirmedAt: settlement.confirmedAt?.toISOString() ?? null,
    autoConfirm: settlement.currency === 'VND' && canAutoConfirm(settlement.to.paymentAccount),
    canConfirm: pending && settlement.toUserId === userId,
    canCancel: pending && (settlement.toUserId === userId || settlement.fromUserId === userId),
  };
}

export function toUnmatchedTransfer(tx: SepayTransaction): UnmatchedTransferResponse {
  return {
    id: tx.id,
    amount: Number(tx.amount),
    content: tx.content,
    bankReference: tx.referenceCode,
    transferredAt: tx.transferredAt,
    receivedAt: tx.receivedAt.toISOString(),
  };
}
