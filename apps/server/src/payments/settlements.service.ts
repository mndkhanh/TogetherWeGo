import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AssignTransferInput,
  bankByBin,
  type ConfirmSettlementInput,
  type CreateSettlementInput,
  MAX_AMOUNT,
  type SettlementDetailResponse,
  type SettlementResponse,
  sepayQrUrl,
  type UnmatchedTransferResponse,
} from '@twg/shared';
import { lockActiveMembers, lockGroup, lockMemberships } from '../expenses/ledger.js';
import { Prisma } from '../generated/prisma/client.js';
import { GroupAccessService } from '../groups/group-access.service.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { OutboxService } from '../notifications/outbox.service.js';
import {
  newPaymentCode,
  settlementInclude,
  toSettlementResponse,
  toUnmatchedTransfer,
} from './payment-mappers.js';

const NOT_FOUND = 'Payment not found';
const TRANSFER_NOT_FOUND = 'Transfer not found';
/** Stops one person filling a group with open payment requests. */
const MAX_PENDING_PER_PAYER = 10;

type Tx = Prisma.TransactionClient;

/**
 * Settling up: one person pays another back, outside the app (bank transfer or cash).
 * A payment starts `pending` with a payment code and counts in balances once `confirmed`,
 * either by the payee or by SePay seeing the transfer arrive. Only the payee's side can
 * confirm: the person who owes money can never mark their own debt as paid.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly outbox: OutboxService,
  ) {}

  async list(groupId: string, userId: string): Promise<SettlementResponse[]> {
    await this.access.require(groupId, userId);
    const rows = await this.prisma.settlement.findMany({
      where: { groupId, status: { not: 'cancelled' } },
      include: settlementInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => toSettlementResponse(row, userId));
  }

  async get(settlementId: string, userId: string): Promise<SettlementDetailResponse> {
    const settlement = await this.load(settlementId, userId);
    const involved = settlement.fromUserId === userId || settlement.toUserId === userId;
    // Bank details are personal data: only the two people involved see them, and only
    // while there is something to pay.
    let payee: SettlementDetailResponse['payee'] = null;
    if (involved && settlement.status === 'pending') {
      const account = await this.prisma.paymentAccount.findUnique({
        where: { userId: settlement.toUserId },
      });
      if (account) {
        payee = {
          bankBin: account.bankBin,
          bankName: bankByBin(account.bankBin)?.name ?? account.bankBin,
          accountNumber: account.accountNumber,
          holderName: account.holderName,
          qrUrl:
            settlement.currency === 'VND'
              ? sepayQrUrl({
                  bin: account.bankBin,
                  accountNumber: account.accountNumber,
                  amount: Number(settlement.amount),
                  description: settlement.paymentCode,
                })
              : null,
        };
      }
    }
    return { ...toSettlementResponse(settlement, userId), payee };
  }

  /**
   * The person paying creates a pending payment and gets a payment code to put in the
   * transfer. The person being paid can instead record money they already got (cash, or a
   * transfer without the code): that is confirmed straight away, since they are the one
   * who would confirm it anyway.
   */
  async create(
    groupId: string,
    userId: string,
    input: CreateSettlementInput,
  ): Promise<SettlementDetailResponse> {
    const { group } = await this.access.require(groupId, userId);
    if (userId !== input.fromUserId && userId !== input.toUserId) {
      throw new ForbiddenException('You can only record payments you made or received');
    }
    if (input.amount > MAX_AMOUNT[group.currency]) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: [{ path: 'amount', message: 'That amount is too large' }],
      });
    }
    const byPayee = userId === input.toUserId;

    for (let attempt = 0; ; attempt++) {
      try {
        const id = await this.prisma.$transaction(async (tx) => {
          const locked = await lockGroup(tx, groupId, 'share');
          if (!locked) throw new NotFoundException('Group not found');
          if (locked.currency !== group.currency) {
            throw new ConflictException('The group’s currency just changed. Reload and try again.');
          }
          const active = await lockActiveMembers(tx, groupId, [input.fromUserId, input.toUserId]);
          if (!active.has(input.fromUserId) || !active.has(input.toUserId)) {
            throw new BadRequestException('Both people must be members of the group');
          }
          if (!byPayee) {
            const pending = await tx.settlement.count({
              where: { groupId, fromUserId: userId, status: 'pending' },
            });
            if (pending >= MAX_PENDING_PER_PAYER) {
              throw new ConflictException(
                'You have too many payments waiting. Cancel the ones you won’t make first.',
              );
            }
          }

          const now = new Date();
          const settlement = await tx.settlement.create({
            data: {
              groupId,
              fromUserId: input.fromUserId,
              toUserId: input.toUserId,
              amount: BigInt(input.amount),
              currency: locked.currency,
              paymentCode: newPaymentCode(),
              createdBy: userId,
              ...(byPayee && {
                status: 'confirmed',
                paidAmount: BigInt(input.amount),
                confirmedVia: 'manual',
                confirmedAt: now,
              }),
            },
          });
          await this.log(tx, settlement, userId, 'settlement.created', {
            amount: input.amount,
          });
          if (byPayee) {
            await this.log(tx, settlement, userId, 'settlement.confirmed', {
              via: 'manual',
              paidAmount: input.amount,
            });
            await this.notify(tx, 'settlement.confirmed', settlement.id, settlement.fromUserId, {
              via: 'manual',
            });
          } else {
            await this.notify(tx, 'settlement.requested', settlement.id, settlement.toUserId);
          }
          return settlement.id;
        });
        this.outbox.kick();
        return this.get(id, userId);
      } catch (error) {
        // Payment codes are random; on the rare clash, try again with a new one.
        if (isUniqueViolation(error, 'payment_code') && attempt < 3) continue;
        throw error;
      }
    }
  }

  /** The payee says the money arrived. They can say a different amount arrived. */
  async confirm(
    settlementId: string,
    userId: string,
    input: ConfirmSettlementInput,
  ): Promise<SettlementDetailResponse> {
    const settlement = await this.load(settlementId, userId);
    if (settlement.toUserId !== userId) {
      throw new ForbiddenException('Only the person being paid can confirm a payment');
    }
    const paid = input.amount ?? Number(settlement.amount);
    if (paid > MAX_AMOUNT[settlement.currency]) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: [{ path: 'amount', message: 'That amount is too large' }],
      });
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForChange(tx, settlementId);
      if (locked.status !== 'pending') throw new ConflictException(this.notPending(locked.status));
      const active = await lockMemberships(tx, settlement.groupId, [
        settlement.fromUserId,
        settlement.toUserId,
      ]);
      if (!active.has(userId)) throw new NotFoundException(NOT_FOUND);
      await tx.settlement.update({
        where: { id: settlementId },
        data: {
          status: 'confirmed',
          paidAmount: BigInt(paid),
          confirmedVia: 'manual',
          confirmedAt: new Date(),
        },
      });
      await this.log(tx, settlement, userId, 'settlement.confirmed', {
        via: 'manual',
        paidAmount: paid,
      });
      await this.notify(tx, 'settlement.confirmed', settlementId, settlement.fromUserId, {
        via: 'manual',
      });
    });
    this.outbox.kick();
    return this.get(settlementId, userId);
  }

  /** Either person can call off a payment that hasn't been confirmed. */
  async cancel(settlementId: string, userId: string): Promise<SettlementDetailResponse> {
    const settlement = await this.load(settlementId, userId);
    if (settlement.toUserId !== userId && settlement.fromUserId !== userId) {
      throw new ForbiddenException('Only the two people in a payment can cancel it');
    }
    await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockForChange(tx, settlementId);
      if (locked.status !== 'pending') throw new ConflictException(this.notPending(locked.status));
      await tx.settlement.update({
        where: { id: settlementId },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await this.log(tx, settlement, userId, 'settlement.cancelled', {});
      const other = userId === settlement.fromUserId ? settlement.toUserId : settlement.fromUserId;
      await this.notify(tx, 'settlement.cancelled', settlementId, other, {}, userId);
    });
    this.outbox.kick();
    return this.get(settlementId, userId);
  }

  // ---------- Transfers SePay saw that matched no payment ----------

  async unmatched(userId: string): Promise<UnmatchedTransferResponse[]> {
    const rows = await this.prisma.sepayTransaction.findMany({
      where: { userId, status: 'unmatched' },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return rows.map(toUnmatchedTransfer);
  }

  /**
   * The payee says who an unmatched transfer was from: either a payment that is waiting
   * (or was cancelled, and paid anyway), or a new payment from someone in one of their groups.
   */
  async assign(
    transferId: string,
    userId: string,
    input: AssignTransferInput,
  ): Promise<SettlementDetailResponse> {
    const settlementId = await this.prisma.$transaction(async (tx) => {
      const transfer = await this.lockUnmatched(tx, transferId, userId);
      if (transfer.amount > BigInt(MAX_AMOUNT.VND)) {
        throw new BadRequestException(
          'This transfer is over the limit for one payment. Ignore it here and sort it out directly.',
        );
      }

      if ('settlementId' in input) {
        const [locked] = await tx.$queryRaw<
          { status: string; to_user_id: string; currency: string; group_id: string }[]
        >`
          SELECT status::text, to_user_id, currency::text, group_id FROM settlements
          WHERE id = ${input.settlementId}::uuid FOR UPDATE`;
        if (!locked || locked.to_user_id !== userId || locked.currency !== 'VND') {
          throw new NotFoundException(NOT_FOUND);
        }
        if (locked.status === 'confirmed') {
          throw new ConflictException('That payment is already confirmed');
        }
        const settlement = await tx.settlement.findUniqueOrThrow({
          where: { id: input.settlementId },
        });
        await lockMemberships(tx, locked.group_id, [settlement.fromUserId, userId]);
        await this.confirmWithTransfer(tx, settlement, transfer, userId);
        return settlement.id;
      }

      await this.access.require(input.groupId, userId);
      if (input.fromUserId === userId) throw new BadRequestException('Choose someone else');
      const group = await lockGroup(tx, input.groupId, 'share');
      if (!group) throw new NotFoundException('Group not found');
      if (group.currency !== 'VND') {
        throw new BadRequestException('Bank transfers can only settle groups that use VND');
      }
      const active = await lockActiveMembers(tx, input.groupId, [input.fromUserId, userId]);
      if (!active.has(input.fromUserId) || !active.has(userId)) {
        throw new BadRequestException('Both people must be members of the group');
      }
      const settlement = await tx.settlement.create({
        data: {
          groupId: input.groupId,
          fromUserId: input.fromUserId,
          toUserId: userId,
          amount: transfer.amount,
          currency: 'VND',
          paymentCode: newPaymentCode(),
          createdBy: userId,
        },
      });
      await this.log(tx, settlement, userId, 'settlement.created', {
        amount: Number(transfer.amount),
      });
      await this.confirmWithTransfer(tx, settlement, transfer, userId);
      return settlement.id;
    });
    this.outbox.kick();
    return this.get(settlementId, userId);
  }

  async ignore(transferId: string, userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockUnmatched(tx, transferId, userId);
      await tx.sepayTransaction.update({
        where: { id: transferId },
        data: { status: 'ignored', resolvedAt: new Date() },
      });
    });
  }

  /**
   * Confirms a payment with a transfer SePay saw, at the amount that actually arrived
   * (less means the rest is still owed; more means the payer is now owed the difference).
   * The caller has locked the settlement and both memberships.
   */
  async confirmWithTransfer(
    tx: Tx,
    settlement: { id: string; groupId: string; toUserId: string },
    transfer: { id: string; amount: bigint },
    actorId: string,
  ): Promise<void> {
    const now = new Date();
    await tx.settlement.update({
      where: { id: settlement.id },
      data: {
        status: 'confirmed',
        paidAmount: transfer.amount,
        confirmedVia: 'sepay',
        confirmedAt: now,
        cancelledAt: null,
      },
    });
    await tx.sepayTransaction.update({
      where: { id: transfer.id },
      data: { status: 'matched', settlementId: settlement.id, resolvedAt: now },
    });
    await this.log(tx, settlement, actorId, 'settlement.confirmed', {
      via: 'sepay',
      paidAmount: Number(transfer.amount),
      transferId: transfer.id,
    });
    const { fromUserId } = await tx.settlement.findUniqueOrThrow({
      where: { id: settlement.id },
      select: { fromUserId: true },
    });
    await this.notify(tx, 'settlement.confirmed', settlement.id, fromUserId, { via: 'sepay' });
  }

  /**
   * Tells one of the two people in a payment. The actor defaults to the payee for
   * confirmations and the payer for requests, matching how the sentence reads.
   */
  private async notify(
    tx: Tx,
    type: 'settlement.requested' | 'settlement.confirmed' | 'settlement.cancelled',
    settlementId: string,
    recipientId: string,
    extra: { via?: 'sepay' | 'manual' } = {},
    actorId?: string,
  ): Promise<void> {
    const s = await tx.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    const actor = actorId ?? (type === 'settlement.requested' ? s.fromUserId : s.toUserId);
    await this.outbox.add(tx, {
      type,
      groupId: s.groupId,
      actorId: actor,
      audience: { kind: 'users', userIds: [recipientId] },
      data: {
        groupId: s.groupId,
        ...(await this.outbox.names(tx, s.groupId, actor)),
        settlementId: s.id,
        amount: Number(s.paidAmount ?? s.amount),
        currency: s.currency,
        ...extra,
      },
    });
  }

  // ---------- helpers ----------

  /** A payment the user can see. Non-members get the same 404 as a missing id. */
  private async load(settlementId: string, userId: string) {
    const settlement = await this.prisma.settlement.findUnique({
      where: { id: settlementId },
      include: settlementInclude,
    });
    if (!settlement) throw new NotFoundException(NOT_FOUND);
    try {
      await this.access.require(settlement.groupId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException(NOT_FOUND);
      throw error;
    }
    return settlement;
  }

  private async lockForChange(tx: Tx, settlementId: string): Promise<{ status: string }> {
    const [row] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM settlements WHERE id = ${settlementId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async lockUnmatched(tx: Tx, transferId: string, userId: string) {
    const [row] = await tx.$queryRaw<{ id: string; amount: bigint; status: string }[]>`
      SELECT id, amount, status::text FROM sepay_transactions
      WHERE id = ${transferId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
    if (!row) throw new NotFoundException(TRANSFER_NOT_FOUND);
    if (row.status !== 'unmatched') {
      throw new ConflictException('This transfer has already been sorted out');
    }
    return row;
  }

  private notPending(status: string): string {
    return status === 'confirmed'
      ? 'This payment is already confirmed'
      : 'This payment was cancelled';
  }

  private async log(
    tx: Tx,
    settlement: { id: string; groupId: string },
    actorId: string,
    action: string,
    diff: Record<string, unknown>,
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        groupId: settlement.groupId,
        actorId,
        action,
        entity: 'settlement',
        entityId: settlement.id,
        diff: diff as object,
      },
    });
  }
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  return JSON.stringify(error.meta ?? {}).includes(field);
}
