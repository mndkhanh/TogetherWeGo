import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module.js';
import { ReminderPlannerModule } from '../reminders/reminders.module.js';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [GroupsModule, ReminderPlannerModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
