import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { PaymentAccountsService } from './payment-accounts.service.js';
import {
  PaymentAccountController,
  SepayWebhookController,
  SettlementsController,
} from './payments.controller.js';
import { SepayWebhookService } from './sepay-webhook.service.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  imports: [GroupsModule],
  controllers: [PaymentAccountController, SettlementsController, SepayWebhookController],
  providers: [PaymentAccountsService, SettlementsService, SepayWebhookService],
})
export class PaymentsModule {}
