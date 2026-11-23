import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module.js';
import { OriginVerifyMiddleware } from './common/origin-verify.middleware.js';
import { HealthController } from './health/health.controller.js';
import { AppConfigModule } from './infra/config/app-config.module.js';
import { LoggerModule } from './infra/logger/logger.module.js';
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
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(OriginVerifyMiddleware).forRoutes('{*path}');
  }
}
