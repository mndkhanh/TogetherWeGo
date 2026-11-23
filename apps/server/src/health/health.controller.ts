import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { Public } from '../common/public.decorator.js';
import { PrismaService } from '../infra/prisma/prisma.service.js';
import { REDIS } from '../infra/redis/redis.module.js';

type CheckStatus = 'up' | 'down';

async function check(fn: () => Promise<unknown>, timeoutMs = 2000): Promise<CheckStatus> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}

@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is up. Used by the ALB target group health check. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable. Used by deploy smoke tests and dashboards. */
  @Get()
  async ready(): Promise<{ status: 'ok'; checks: Record<string, CheckStatus> }> {
    const checks = {
      database: await check(() => this.prisma.$queryRaw`SELECT 1`),
      redis: await check(() => this.redis.ping()),
    };
    if (Object.values(checks).some((status) => status === 'down')) {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
