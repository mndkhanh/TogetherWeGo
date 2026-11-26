import { ForbiddenException, Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import { safeEqual } from './safe-equal.js';

/**
 * In AWS, CloudFront adds a secret `x-origin-verify` header when forwarding to the ALB.
 * Rejecting requests without it means nobody can bypass CloudFront by calling the ALB directly.
 * Health checks come from the ALB itself, so they are exempt.
 */
@Injectable()
export class OriginVerifyMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const secret = this.config.originVerifySecret;
    if (!secret || req.originalUrl.startsWith('/v1/health')) {
      next();
      return;
    }
    const header = req.headers['x-origin-verify'];
    if (typeof header !== 'string' || !safeEqual(header, secret)) {
      throw new ForbiddenException();
    }
    next();
  }
}
