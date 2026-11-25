import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfigModule } from './infra/config/app-config.module.js';
import type { AppConfig } from './infra/config/env.schema.js';
import { LoggerModule } from './infra/logger/logger.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { EmailProcessor, NotificationsProcessor } from './jobs/notifications.processor.js';
import { bullRootOptions, QUEUES } from './jobs/queues.js';
import { RemindersProcessor } from './jobs/reminders.processor.js';
import { SystemProcessor } from './jobs/system.processor.js';
import { NotificationsCoreModule } from './notifications/notifications.module.js';
import { RemindersModule } from './reminders/reminders.module.js';

/** Root module of the background worker process (no HTTP server). */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => bullRootOptions(config),
    }),
    BullModule.registerQueue(
      { name: QUEUES.system },
      { name: QUEUES.notifications },
      { name: QUEUES.reminders },
    ),
    NotificationsCoreModule,
    RemindersModule,
  ],
  providers: [SystemProcessor, NotificationsProcessor, EmailProcessor, RemindersProcessor],
})
export class WorkerModule {}
