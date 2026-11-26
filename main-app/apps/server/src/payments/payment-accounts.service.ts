import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PaymentAccountResponse, SepayKeyResponse } from '@twg/shared';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { newSepayKey, toPaymentAccountResponse } from './payment-mappers.js';

/** Where someone wants to be paid, and their optional SePay connection. */
@Injectable()
export class PaymentAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async get(userId: string): Promise<PaymentAccountResponse | null> {
    const account = await this.prisma.paymentAccount.findUnique({ where: { userId } });
    return account ? toPaymentAccountResponse(account) : null;
  }

  async save(
    userId: string,
    input: { bankBin: string; accountNumber: string; holderName: string },
  ): Promise<PaymentAccountResponse> {
    const existing = await this.prisma.paymentAccount.findUnique({ where: { userId } });
    const moved =
      existing &&
      (existing.bankBin !== input.bankBin || existing.accountNumber !== input.accountNumber);
    const account = await this.prisma.paymentAccount.upsert({
      where: { userId },
      create: { userId, ...input },
      // A SePay key belongs to one bank account: moving to another account turns it off,
      // so transfers to the old account can't confirm payments any more.
      update: { ...input, ...(moved && { sepayKeyHash: null, sepayKeyHint: null }) },
    });
    return toPaymentAccountResponse(account);
  }

  async remove(userId: string): Promise<void> {
    // Transfers already received stay (they are bank records); they just lose the link.
    await this.prisma.paymentAccount.deleteMany({ where: { userId } });
  }

  /** Makes a new SePay key, replacing any old one. The key is returned once and never stored. */
  async createSepayKey(userId: string): Promise<SepayKeyResponse> {
    const { key, hash, hint } = newSepayKey();
    const result = await this.prisma.paymentAccount.updateMany({
      where: { userId },
      data: { sepayKeyHash: hash, sepayKeyHint: hint },
    });
    if (result.count === 0) {
      throw new ConflictException('Add your bank account before setting up SePay');
    }
    const account = await this.prisma.paymentAccount.findUniqueOrThrow({ where: { userId } });
    return {
      apiKey: key,
      webhookUrl: `${this.config.appOrigin}/v1/webhooks/sepay`,
      account: toPaymentAccountResponse(account),
    };
  }

  async removeSepayKey(userId: string): Promise<PaymentAccountResponse> {
    const result = await this.prisma.paymentAccount.updateMany({
      where: { userId },
      data: { sepayKeyHash: null, sepayKeyHint: null },
    });
    if (result.count === 0) throw new NotFoundException('No bank account added');
    return toPaymentAccountResponse(
      await this.prisma.paymentAccount.findUniqueOrThrow({ where: { userId } }),
    );
  }
}
