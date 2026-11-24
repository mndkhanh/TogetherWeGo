import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AssignTransferInput,
  assignTransferSchema,
  type ConfirmSettlementInput,
  confirmSettlementSchema,
  type CreateSettlementInput,
  createSettlementSchema,
  type PaymentAccountResponse,
  paymentAccountSchema,
  type SepayKeyResponse,
  type SettlementDetailResponse,
  type SettlementResponse,
  type UnmatchedTransferResponse,
} from '@twg/shared';
import type { z } from 'zod';
import { type AuthUser, CurrentUser } from '../auth/auth-user.js';
import { Public } from '../common/public.decorator.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import { SepayWebhookService } from './sepay-webhook.service.js';
import { SettlementsService } from './settlements.service.js';

const GroupId = () => Param('groupId', new ParseUUIDPipe());
const SettlementId = () => Param('settlementId', new ParseUUIDPipe());
const TransferId = () => Param('transferId', new ParseUUIDPipe());

/** Making a SePay key is rare; limit it so a stolen session can't churn keys. */
const KEY_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('me')
export class PaymentAccountController {
  constructor(
    private readonly accounts: PaymentAccountsService,
    private readonly settlements: SettlementsService,
  ) {}

  /** Wrapped, because a bare `null` body isn't valid to every JSON client. */
  @Get('payment-account')
  async get(@CurrentUser() user: AuthUser): Promise<{ account: PaymentAccountResponse | null }> {
    return { account: await this.accounts.get(user.id) };
  }

  @Put('payment-account')
  save(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(paymentAccountSchema))
    body: z.output<typeof paymentAccountSchema>,
  ): Promise<PaymentAccountResponse> {
    return this.accounts.save(user.id, body);
  }

  @Delete('payment-account')
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser): Promise<void> {
    return this.accounts.remove(user.id);
  }

  @Post('payment-account/sepay-key')
  @Throttle(KEY_LIMIT)
  createSepayKey(@CurrentUser() user: AuthUser): Promise<SepayKeyResponse> {
    return this.accounts.createSepayKey(user.id);
  }

  @Delete('payment-account/sepay-key')
  removeSepayKey(@CurrentUser() user: AuthUser): Promise<PaymentAccountResponse> {
    return this.accounts.removeSepayKey(user.id);
  }

  @Get('unmatched-transfers')
  unmatched(@CurrentUser() user: AuthUser): Promise<UnmatchedTransferResponse[]> {
    return this.settlements.unmatched(user.id);
  }

  @Post('unmatched-transfers/:transferId/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @TransferId() transferId: string,
    @Body(new ZodValidationPipe(assignTransferSchema)) body: AssignTransferInput,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.assign(transferId, user.id, body);
  }

  @Post('unmatched-transfers/:transferId/ignore')
  @HttpCode(204)
  ignore(@CurrentUser() user: AuthUser, @TransferId() transferId: string): Promise<void> {
    return this.settlements.ignore(transferId, user.id);
  }
}

@Controller()
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Get('groups/:groupId/settlements')
  list(@CurrentUser() user: AuthUser, @GroupId() groupId: string): Promise<SettlementResponse[]> {
    return this.settlements.list(groupId, user.id);
  }

  @Post('groups/:groupId/settlements')
  create(
    @CurrentUser() user: AuthUser,
    @GroupId() groupId: string,
    @Body(new ZodValidationPipe(createSettlementSchema)) body: CreateSettlementInput,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.create(groupId, user.id, body);
  }

  @Get('settlements/:settlementId')
  get(
    @CurrentUser() user: AuthUser,
    @SettlementId() settlementId: string,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.get(settlementId, user.id);
  }

  @Post('settlements/:settlementId/confirm')
  @HttpCode(200)
  confirm(
    @CurrentUser() user: AuthUser,
    @SettlementId() settlementId: string,
    @Body(new ZodValidationPipe(confirmSettlementSchema)) body: ConfirmSettlementInput,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.confirm(settlementId, user.id, body);
  }

  @Post('settlements/:settlementId/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthUser,
    @SettlementId() settlementId: string,
  ): Promise<SettlementDetailResponse> {
    return this.settlements.cancel(settlementId, user.id);
  }
}

/**
 * SePay calls this when money moves on a watched account. Public (SePay has no user
 * session); authenticated by the per-user API key instead. SePay only needs
 * `{"success": true}` with a 2xx; the outcome is for our own logs and tests.
 */
@Controller('webhooks')
export class SepayWebhookController {
  constructor(private readonly webhook: SepayWebhookService) {}

  @Post('sepay')
  @Public()
  @HttpCode(200)
  // SePay sends from a handful of IPs for all users, so this is higher than the default.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async sepay(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<{ success: true; outcome: string }> {
    const outcome = await this.webhook.handle(authorization, body);
    return { success: true, outcome };
  }
}
