import { randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import {
  findPaymentCodes,
  MAX_AMOUNT,
  type SepayWebhookInput,
  sepayWebhookSchema,
} from '@twg/shared';
import { parseOrThrow } from '../common/zod-validation.pipe.js';
import { lockMemberships } from '../expenses/ledger.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { hashSepayKey } from './payment-mappers.js';
import { SettlementsService } from './settlements.service.js';

export type WebhookOutcome = 'matched' | 'unmatched' | 'duplicate' | 'ignored';

/**
 * Handles SePay's "money arrived" webhook. The route is public, so nothing in the request is
 * trusted until the API key checks out, and even then the key only speaks for its own
 * account: a transfer can only confirm a payment *to* the owner of that key.
 *
 * SePay retries until it gets a 2xx, so every step is safe to repeat.
 */
@Injectable()
export class SepayWebhookService {
  private readonly logger = new Logger(SepayWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settlements: SettlementsService,
  ) {}

  async handle(authorization: string | undefined, body: unknown): Promise<WebhookOutcome> {
    // 1. Who is this? `Authorization: Apikey <key>`; we only keep the key's hash.
    const key = /^Apikey\s+(\S{20,200})$/i.exec(authorization ?? '')?.[1];
    const account = key
      ? await this.prisma.paymentAccount.findUnique({
          where: { sepayKeyHash: hashSepayKey(key) },
        })
      : null;
    if (!account) throw new UnauthorizedException();

    // 2. Is it a well-formed SePay transaction?
    const input = parseOrThrow(sepayWebhookSchema, body);
    await this.prisma.paymentAccount.update({
      where: { id: account.id },
      data: { sepayLastEventAt: new Date() },
    });

    // 3. Only money coming in, to the account this key was made for.
    if (input.transferType !== 'in') return 'ignored';
    if (
      input.accountNumber !== account.accountNumber &&
      input.subAccount !== account.accountNumber
    ) {
      this.logger.warn({ sepayId: input.id }, 'SePay transfer for a different account; ignored');
      return 'ignored';
    }

    return this.prisma.$transaction(async (tx) => {
      // 4. Record it once. A retry of the same transaction inserts nothing and stops here.
      const id = randomUUID();
      const inserted = await tx.sepayTransaction.createMany({
        data: [
          {
            id,
            userId: account.userId,
            paymentAccountId: account.id,
            sepayId: BigInt(input.id),
            accountNumber: input.accountNumber,
            amount: BigInt(input.transferAmount),
            content: input.content,
            referenceCode: input.referenceCode ?? null,
            transferredAt: input.transactionDate,
            raw: body as object,
            status: 'unmatched',
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) return 'duplicate' as const;

      // 5. Find the payment it is for: its code, owed to this account's owner, not yet confirmed.
      // Over the per-payment limit: keep the record, but let the payee look at it themselves.
      if (input.transferAmount > MAX_AMOUNT.VND) return 'unmatched' as const;
      const codes = codesIn(input);
      if (codes.length === 0) return 'unmatched' as const;
      const [settlement] = await tx.$queryRaw<
        { id: string; group_id: string; from_user_id: string; to_user_id: string }[]
      >`
        SELECT id, group_id, from_user_id, to_user_id FROM settlements
        WHERE payment_code = ANY(${codes}::text[])
          AND to_user_id = ${account.userId}::uuid
          AND currency = 'VND'
          AND status <> 'confirmed'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`;
      if (!settlement) return 'unmatched' as const;

      // Real money moved, so this confirms even a cancelled payment, or one where someone
      // has since left the group. The lock just keeps it from interleaving with leaving.
      await lockMemberships(tx, settlement.group_id, [
        settlement.from_user_id,
        settlement.to_user_id,
      ]);
      await this.settlements.confirmWithTransfer(
        tx,
        { id: settlement.id, groupId: settlement.group_id, toUserId: settlement.to_user_id },
        { id, amount: BigInt(input.transferAmount) },
        settlement.to_user_id,
      );
      return 'matched' as const;
    });
  }
}

function codesIn(input: SepayWebhookInput): string[] {
  return findPaymentCodes([input.code, input.content, input.description].join(' '));
}
