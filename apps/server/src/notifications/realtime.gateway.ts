import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { Server } from 'socket.io';
import { AccessTokenService } from '../auth/access-token.service.js';
import { safeEqual } from '../common/safe-equal.js';
import { APP_CONFIG } from '../infra/config/app-config.module.js';
import type { AppConfig } from '../infra/config/env.schema.js';
import { REDIS } from '../infra/redis/redis.module.js';
import { userRoom } from './realtime-publisher.service.js';

/** Under /v1 so it shares the API's path everywhere (Vite proxy, CloudFront behaviour). */
export const REALTIME_PATH = '/v1/realtime';

/**
 * Socket.IO for live notifications, attached to the API's HTTP server.
 *
 * It sits outside Nest's middleware and guards, so it repeats their checks itself:
 * - Origin must be the web app (no cross-site WebSocket hijacking), and the CloudFront
 *   secret header must be present when configured (no bypassing CloudFront).
 * - The access token is sent in the handshake body (never a cookie or the URL), checked
 *   like any API call, and the socket is closed the moment the token expires; the browser
 *   reconnects with a fresh one.
 * - WebSocket transport only: long-polling would need sticky sessions across API tasks.
 * - Each socket joins only its own user's room, so it can only ever receive its own events.
 *   Clients can't send anything.
 */
@Injectable()
export class RealtimeGateway implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  private io?: Server;
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly tokens: AccessTokenService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.pub = this.redis.duplicate();
    this.sub = this.redis.duplicate();
    const io = new Server(server, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      serveClient: false,
      maxHttpBufferSize: 1024, // clients never send data; keep frames tiny
      allowRequest: (req, callback) => {
        const origin = req.headers.origin;
        const secret = this.config.originVerifySecret;
        const header = req.headers['x-origin-verify'];
        const fromApp = origin === this.config.appOrigin;
        const viaCdn = !secret || (typeof header === 'string' && safeEqual(header, secret));
        callback(fromApp && viaCdn ? null : 'Forbidden', fromApp && viaCdn);
      },
    });
    io.adapter(createAdapter(this.pub, this.sub));

    io.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length > 4096) {
        next(new Error('unauthorized'));
        return;
      }
      this.tokens.verifyWithExpiry(token).then(
        ({ userId, expiresAt }) => {
          socket.data.userId = userId;
          socket.data.expiresAt = expiresAt.getTime();
          next();
        },
        () => next(new Error('unauthorized')),
      );
    });

    io.on('connection', (socket) => {
      const userId = socket.data.userId as string;
      void socket.join(userRoom(userId));
      // Same lifetime as the access token: a stolen or logged-out token stops working here too.
      const timer = setTimeout(
        () => {
          socket.emit('session_expired');
          socket.disconnect(true);
        },
        Math.max(0, (socket.data.expiresAt as number) - Date.now()),
      );
      socket.on('disconnect', () => clearTimeout(timer));
    });

    this.io = io;
    this.logger.log(`Realtime listening on ${REALTIME_PATH}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.io ? this.io.close(() => resolve()) : resolve()));
    await Promise.allSettled([this.pub?.quit(), this.sub?.quit()]);
  }
}
