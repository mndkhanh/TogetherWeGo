import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiModule } from '../src/api.module.js';
import { configureApp } from '../src/configure-app.js';
import { APP_CONFIG } from '../src/infra/config/app-config.module.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';

const ORIGIN = 'http://localhost:5173';

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('twg_rt='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0]!;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `e2e-${randomUUID()}@example.com`;
  const password = 'correct-horse-battery';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    const nest = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(nest, nest.get(APP_CONFIG));
    await nest.init();
    app = nest;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('registers, reads /me, and keeps the password hash private', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password, name: 'E2E' })
      .expect(201);

    expect(res.body.user).toMatchObject({ email, hasPassword: true });
    expect(JSON.stringify(res.body)).not.toContain('argon2');

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/);

    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
  });

  it('rejects a tampered access token', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const token: string = login.body.accessToken;
    const tampered = `${token.slice(0, -2)}xx`;
    await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${tampered}`)
      .expect(401);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const first = refreshCookie(login);

    const refreshed = await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', first)
      .expect(200);
    const second = refreshCookie(refreshed);
    expect(second).not.toBe(first);

    // Simulate an attacker replaying the old token after the grace window.
    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null }, user: { email } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', first)
      .expect(401);

    // The legitimate (newer) token is now revoked too: everyone must log in again.
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', ORIGIN)
      .set('Cookie', second)
      .expect(401);
  });

  it('refuses refresh requests from another origin', async () => {
    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    await request(app.getHttpServer())
      .post('/v1/auth/refresh')
      .set('Origin', 'https://evil.example')
      .set('Cookie', refreshCookie(login))
      .expect(403);
  });

  it('gives the same error for unknown email and wrong password', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: `nobody-${randomUUID()}@example.com`, password })
      .expect(401);
    const wrong = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email, password: 'wrong-password-123' })
      .expect(401);
    expect(unknown.body.message).toBe(wrong.body.message);
  });
});
