import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../jobs/queues.js';
import { NotificationsCoreModule } from '../notifications/notifications.module.js';
import { EventReminderPlanner } from './event-reminder-planner.service.js';
import { RemindersService } from './reminders.service.js';

/** API side: plans an event's reminders when it's created, moved or cancelled. */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.reminders })],
  providers: [EventReminderPlanner],
  exports: [EventReminderPlanner],
})
export class ReminderPlannerModule {}

/** Worker side (also used by tests): sends event and debt reminders through the outbox. */
@Module({
  imports: [NotificationsCoreModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
