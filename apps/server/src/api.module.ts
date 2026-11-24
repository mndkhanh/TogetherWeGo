import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { OriginVerifyMiddleware } from './common/origin-verify.middleware.js';
import { EventsModule } from './events/events.module.js';
import { ExpensesModule } from './expenses/expenses.module.js';
import { GroupsModule } from './groups/groups.module.js';
import { HealthController } from './health/health.controller.js';
import { APP_CONFIG, AppConfigModule } from './infra/config/app-config.module.js';
import type { AppConfig } from './infra/config/env.schema.js';
import { LoggerModule } from './infra/logger/logger.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { UsersModule } from './users/users.module.js';

/** Root module of the HTTP API process. */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    // Default: 120 requests/minute per IP. In-memory per task for now; Redis storage later.
    // Disabled only under NODE_ENV=test, where e2e suites create many users from one IP.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
        skipIf: () => config.nodeEnv === 'test',
      }),
    }),
    AuthModule,
    UsersModule,
    GroupsModule,
    ExpensesModule,
    PaymentsModule,
    EventsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginVerifyMiddleware).forRoutes('{*path}');
  }
}
