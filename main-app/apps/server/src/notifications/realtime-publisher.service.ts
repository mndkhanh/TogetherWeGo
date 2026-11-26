import { Emitter } from '@socket.io/redis-emitter';
import { Inject, Injectable } from '@nestjs/common';
import type { RealtimeNotification } from '@twg/shared';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis/redis.module.js';

/** Room that only one user's sockets join. */
export const userRoom = (userId: string) => `user:${userId}`;

/**
 * Pushes to connected browsers from any process (the worker has no sockets of its own): the
 * message goes through Redis, and the Socket.IO adapter on whichever API task holds the
 * user's connection delivers it.
 */
@Injectable()
export class RealtimePublisher {
  private readonly emitter: Emitter;

  constructor(@Inject(REDIS) redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  notify(userId: string, message: RealtimeNotification): void {
    this.emitter.to(userRoom(userId)).emit('notification', message);
  }
}
