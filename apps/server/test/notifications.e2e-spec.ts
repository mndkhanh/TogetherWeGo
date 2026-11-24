import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { RealtimeNotification } from '@twg/shared';
import type { Queue } from 'bullmq';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { QUEUES } from '../src/jobs/queues.js';
import { FanoutService } from '../src/notifications/fanout.service.js';
import { NotificationsCoreModule } from '../src/notifications/notifications.module.js';
import { REALTIME_PATH } from '../src/notifications/realtime.gateway.js';
import { as, createTestApp, ORIGIN, registerUser, type TestUser } from './helpers.js';

const PREFIX = `e2e-notify-${randomUUID().slice(0, 8)}`;

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fanout: FanoutService;
  let emailQueue: Queue<{ deliveryId: string }>;
  let baseUrl: string;
  let owner: TestUser;
  let friend: TestUser;
  let third: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp([NotificationsCoreModule]));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    fanout = app.get(FanoutService);
    emailQueue = app.get(getQueueToken(QUEUES.email));
    owner = await registerUser(app, PREFIX, 'An Owner');
    friend = await registerUser(app, PREFIX, 'Bình Friend');
    third = await registerUser(app, PREFIX, 'Chi Third');
    stranger = await registerUser(app, PREFIX, 'Stranger');
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } } });
    const ids = users.map((u) => u.id);
    // Take this suite's email jobs back out of Redis, so a local worker never tries them.
    const deliveries = await prisma.emailDelivery.findMany({ where: { userId: { in: ids } } });
    for (const d of deliveries) await (await emailQueue.getJob(d.id))?.remove();
    await prisma.group.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function group(members: TestUser[] = [friend, third], name = 'Weekend crew') {
    const res = await as(app, owner).post('/v1/groups').send({ name, currency: 'VND' }).expect(201);
    const invite = await as(app, owner)
      .post(`/v1/groups/${res.body.id}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    for (const user of members) {
      await as(app, user).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    }
    await fanout.processPending(); // the "joined" notifications
    return res.body.id as string;
  }

  async function feed(user: TestUser) {
    const res = await as(app, user).get('/v1/notifications').expect(200);
    const body = res.body as {
      items: { id: string; type: string; text: string; link: string; read: boolean }[];
      unreadCount: number;
    };
    // Intl puts non-breaking spaces in money and dates; compare as plain spaces.
    for (const item of body.items) item.text = item.text.replace(/\s/gu, ' ');
    return body;
  }

  function emailsTo(user: TestUser) {
    return prisma.emailDelivery.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
  }

  const dinner = (people: TestUser[], title = 'Dinner') => ({
    title,
    amount: 300_000,
    payerId: owner.id,
    splitType: 'equal',
    splits: people.map((p) => ({ userId: p.id, value: 0 })),
    spentOn: '2026-11-25',
  });

  it('an expense notifies the people on it, with their share, and nobody else', async () => {
    const groupId = await group();
    const before = (await feed(third)).items.length;
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(dinner([owner, friend]))
      .expect(201);
    // Nothing happens until the worker runs: the change and the outbox row commit together.
    expect((await feed(friend)).items.filter((n) => n.type === 'expense.added')).toHaveLength(0);
    await fanout.processPending();

    const mine = await feed(friend);
    const added = mine.items.find((n) => n.type === 'expense.added')!;
    expect(added.text).toBe(
      'An Owner added Dinner (300.000 ₫) in Weekend crew. Your share: 150.000 ₫.',
    );
    expect(added.link).toBe(`/groups/${groupId}`);
    expect((await feed(third)).items.length).toBe(before); // not on the expense
    expect((await feed(owner)).items.some((n) => n.type === 'expense.added')).toBe(false); // actor
  });

  it('fan-out is idempotent and survives retries', async () => {
    const groupId = await group();
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(dinner([owner, friend], 'Once only'))
      .expect(201);
    const row = await prisma.outbox.findFirstOrThrow({
      where: { processedAt: null, type: 'expense.added' },
      orderBy: { createdAt: 'desc' },
    });
    expect(await fanout.processOne(row.id)).toBe(true);
    expect(await fanout.processOne(row.id)).toBe(false); // already done
    // Even if processed_at were lost, the unique (outbox, user) key stops duplicates.
    await prisma.outbox.update({ where: { id: row.id }, data: { processedAt: null } });
    await fanout.processOne(row.id);
    expect(await prisma.notification.count({ where: { outboxId: row.id } })).toBe(1);

    // A broken row is retried later, not lost, and doesn't block the others.
    const broken = await prisma.outbox.create({
      data: {
        type: 'expense.added',
        payload: {
          type: 'expense.added',
          groupId: 'not-a-uuid',
          actorId: null,
          audience: { kind: 'group' },
          data: {},
        },
      },
    });
    await fanout.processPending();
    const after = await prisma.outbox.findUniqueOrThrow({ where: { id: broken.id } });
    expect(after.processedAt).toBeNull();
    expect(after.attempts).toBeGreaterThan(0);
    expect(after.lastError).toBeTruthy();
    await prisma.outbox.delete({ where: { id: broken.id } });
  });

  it('feed: unread count, mark one or all read, and only your own', async () => {
    const groupId = await group();
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(dinner([owner, friend]))
      .expect(201);
    await fanout.processPending();
    const { items, unreadCount } = await feed(friend);
    expect(unreadCount).toBeGreaterThan(0);

    await as(app, stranger).post(`/v1/notifications/${items[0]!.id}/read`).expect(404);
    const one = await as(app, friend).post(`/v1/notifications/${items[0]!.id}/read`).expect(200);
    expect(one.body.unreadCount).toBe(unreadCount - 1);
    await as(app, friend).post('/v1/notifications/read-all').expect(200);
    expect((await feed(friend)).unreadCount).toBe(0);
    expect((await feed(stranger)).items).toEqual([]);
  });

  it('events reach the whole group except the planner and anyone who left', async () => {
    const groupId = await group();
    await as(app, third).delete(`/v1/groups/${groupId}/members/${third.id}`).expect(204);
    await as(app, friend)
      .post(`/v1/groups/${groupId}/events`)
      .send({ title: 'Hotpot', startsAt: '2026-12-24T12:00:00.000Z' })
      .expect(201);
    await fanout.processPending();
    const forOwner = (await feed(owner)).items.find((n) => n.type === 'event.created');
    expect(forOwner?.text).toBe(
      'Bình Friend planned Hotpot for Thu, Dec 24, 7:00 PM in Weekend crew.',
    );
    expect(
      (await feed(third)).items.some((n) => n.type === 'event.created' && n.link.includes(groupId)),
    ).toBe(false);
    expect(
      (await feed(friend)).items.some(
        (n) => n.type === 'event.created' && n.link.includes(groupId),
      ),
    ).toBe(false);
  });

  it('preferences: defaults, turning a type off, and email with escaped content', async () => {
    const prefs = await as(app, friend).get('/v1/me/notification-preferences').expect(200);
    expect(prefs.body.find((p: { type: string }) => p.type === 'expense.added')).toMatchObject({
      inApp: true,
      email: false,
    });
    await as(app, friend)
      .put('/v1/me/notification-preferences')
      .send({ preferences: [{ type: 'expense.added', inApp: false, email: true }] })
      .expect(200);
    await as(app, friend)
      .put('/v1/me/notification-preferences')
      .send({ preferences: [{ type: 'not.a.type', inApp: true, email: true }] })
      .expect(400);

    const groupId = await group([friend], '<b>Crew</b>');
    const beforeFeed = (await feed(friend)).items.length;
    const beforeMail = (await emailsTo(friend)).length;
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(dinner([owner, friend], 'Pho <script>alert(1)</script>'))
      .expect(201);
    await fanout.processPending();

    expect((await feed(friend)).items.length).toBe(beforeFeed); // in-app off
    const mails = await emailsTo(friend);
    expect(mails.length).toBe(beforeMail + 1);
    const mail = mails.find((m) => m.subject.includes('Pho'))!;
    expect(mail.toAddress).toBe(friend.email);
    // Queued only after the fan-out committed, one job per delivery.
    expect((await emailQueue.getJob(mail.id))?.data).toEqual({ deliveryId: mail.id });
    expect(mail.subject).toContain('Pho <script>alert(1)</script>'); // plain text header
    expect(mail.html).toContain('Pho &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('&lt;b&gt;Crew&lt;/b&gt;');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain(`${ORIGIN}/groups/${groupId}`);

    // Back to defaults: nothing is stored.
    await as(app, friend)
      .put('/v1/me/notification-preferences')
      .send({ preferences: [{ type: 'expense.added', inApp: true, email: false }] })
      .expect(200);
    expect(await prisma.notificationPreference.count({ where: { userId: friend.id } })).toBe(0);
  });

  it('payments: the payee hears about a request, the payer about the confirmation', async () => {
    const groupId = await group([friend]);
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(dinner([owner, friend]))
      .expect(201);
    const pay = await as(app, friend)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: friend.id, toUserId: owner.id, amount: 150_000 })
      .expect(201);
    await fanout.processPending();
    expect((await feed(owner)).items[0]).toMatchObject({
      type: 'settlement.requested',
      text: 'Bình Friend is paying you 150.000 ₫ (Weekend crew).',
    });
    await as(app, owner).post(`/v1/settlements/${pay.body.id}/confirm`).send({}).expect(200);
    await fanout.processPending();
    expect((await feed(friend)).items[0]).toMatchObject({
      type: 'settlement.confirmed',
      text: 'An Owner confirmed your payment of 150.000 ₫ (Weekend crew).',
    });
  });

  it('sending an email is recorded, never repeated, and failures are counted', async () => {
    const groupId = await group([friend]);
    await as(app, owner)
      .post(`/v1/groups/${groupId}/events`)
      .send({ title: 'Sunrise hike', startsAt: '2026-12-26T00:00:00.000Z' })
      .expect(201);
    await fanout.processPending();
    const delivery = (await emailsTo(friend)).find((m) => m.subject.includes('Sunrise'))!;
    expect(delivery.sentAt).toBeNull();

    const sent: string[] = [];
    await expect(
      fanout.sendEmail(delivery.id, () => Promise.reject(new Error('SMTP down'))),
    ).rejects.toThrow('SMTP down');
    let row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row).toMatchObject({ sentAt: null, attempts: 1, lastError: 'Error: SMTP down' });

    await fanout.sendEmail(delivery.id, async (email) => void sent.push(email.subject));
    await fanout.sendEmail(delivery.id, async (email) => void sent.push(email.subject)); // retried job
    expect(sent).toHaveLength(1);
    row = await prisma.emailDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.sentAt).not.toBeNull();
  });

  describe('realtime', () => {
    function connect(token: string | null, origin = ORIGIN): Socket {
      return io(baseUrl, {
        path: REALTIME_PATH,
        transports: ['websocket'],
        auth: token ? { token } : {},
        extraHeaders: { origin },
        reconnection: false,
      });
    }

    const outcome = (socket: Socket) =>
      new Promise<string>((resolve) => {
        socket.on('connect', () => resolve('connected'));
        socket.on('connect_error', (err) => resolve(`error: ${err.message}`));
      });

    it('rejects a missing or bad token and a foreign origin', async () => {
      const sockets = [
        connect(null),
        connect('not.a.jwt'),
        connect(friend.token, 'https://evil.example'),
      ];
      const results = await Promise.all(sockets.map(outcome));
      sockets.forEach((s) => s.close());
      expect(results[0]).toBe('error: unauthorized');
      expect(results[1]).toBe('error: unauthorized');
      expect(results[2]).toMatch(/^error:/);
    });

    it('pushes a new notification to that user only', async () => {
      const groupId = await group([friend]);
      const mine = connect(friend.token);
      const theirs = connect(third.token);
      expect(await outcome(mine)).toBe('connected');
      expect(await outcome(theirs)).toBe('connected');
      const leaked: unknown[] = [];
      theirs.on('notification', (m) => leaked.push(m));
      const received = new Promise<RealtimeNotification>((resolve) =>
        mine.on('notification', resolve),
      );

      await as(app, owner)
        .post(`/v1/groups/${groupId}/expenses`)
        .send(dinner([owner, friend], 'Live'))
        .expect(201);
      await fanout.processPending();
      const message = await received;
      expect(message.notification).toMatchObject({ type: 'expense.added', read: false });
      expect(message.notification.text).toContain('Live');
      expect(message.unreadCount).toBeGreaterThan(0);
      await new Promise((r) => setTimeout(r, 200));
      expect(leaked).toEqual([]);
      mine.close();
      theirs.close();
    });
  });
});
