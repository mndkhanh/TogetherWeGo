import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfigModule } from './infra/config/app-config.module.js';
import type { AppConfig } from './infra/config/env.schema.js';
import { LoggerModule } from './infra/logger/logger.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { bullRootOptions, QUEUES } from './jobs/queues.js';
import { SystemProcessor } from './jobs/system.processor.js';

/** Root module of the background worker process (no HTTP server). */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => bullRootOptions(config),
    }),
    BullModule.registerQueue({ name: QUEUES.system }),
  ],
  providers: [SystemProcessor],
})
export class WorkerModule {}
