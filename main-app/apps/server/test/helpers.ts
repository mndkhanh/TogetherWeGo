import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { ApiModule } from '../src/api.module.js';
import { configureApp } from '../src/configure-app.js';
import { APP_CONFIG } from '../src/infra/config/app-config.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { QUEUES } from '../src/jobs/queues.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct-horse-battery';

/**
 * Boots the real API module with the production HTTP setup. `extra` adds worker-side modules
 * (e.g. the notification fan-out) so tests can run background work on demand.
 */
export async function createTestApp(
  extra: Type[] = [],
): Promise<{ app: INestApplication; prisma: PrismaService }> {
  const moduleRef = await Test.createTestingModule({ imports: [ApiModule, ...extra] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get(APP_CONFIG));
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
}

/** Registers a fresh user. Emails share a prefix so tests can clean up after themselves. */
export async function registerUser(
  app: INestApplication,
  prefix: string,
  name = 'Test User',
): Promise<TestUser> {
  const email = `${prefix}-${randomUUID()}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/v1/auth/register')
    .send({ email, password: PASSWORD, name })
    .expect(201);
  return { id: res.body.user.id, email, name, token: res.body.accessToken };
}

/**
 * Takes the reminder jobs for these users' groups' events back out of Redis, so a local worker
 * never runs them. Call before deleting the groups (the reminder rows go with them).
 */
export async function removeReminderJobs(
  app: INestApplication,
  prisma: PrismaService,
  userIds: string[],
): Promise<void> {
  const queue = app.get<Queue>(getQueueToken(QUEUES.reminders));
  const planned = await prisma.eventReminder.findMany({
    where: { event: { group: { createdBy: { in: userIds } } } },
    select: { id: true },
  });
  for (const r of planned) await (await queue.getJob(r.id))?.remove();
}

/** supertest agent bound to a user's access token. */
export function as(app: INestApplication, user: TestUser) {
  const server = app.getHttpServer();
  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (url: string) => auth(request(server).get(url)),
    post: (url: string) => auth(request(server).post(url)),
    put: (url: string) => auth(request(server).put(url)),
    patch: (url: string) => auth(request(server).patch(url)),
    delete: (url: string) => auth(request(server).delete(url)),
  };
}
