import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { QUEUES } from '../jobs/queues.js';
import { FanoutService } from './fanout.service.js';
import { MailerService } from './mailer.service.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { OutboxService } from './outbox.service.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimePublisher } from './realtime-publisher.service.js';

/**
 * API side: the outbox writer (global, so every feature module can record notifications in
 * its own transactions), the feed and preferences endpoints, and the WebSocket gateway.
 */
@Global()
@Module({
  imports: [AuthModule, BullModule.registerQueue({ name: QUEUES.notifications })],
  controllers: [NotificationsController],
  providers: [OutboxService, NotificationsService, RealtimeGateway],
  exports: [OutboxService],
})
export class NotificationsModule {}

/**
 * Worker side (also used by tests): fan-out, email and pushing to browsers, plus the outbox
 * writer for notifications the worker starts itself (reminders).
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.email }, { name: QUEUES.notifications })],
  providers: [FanoutService, MailerService, RealtimePublisher, OutboxService],
  exports: [FanoutService, MailerService, OutboxService],
})
export class NotificationsCoreModule {}
