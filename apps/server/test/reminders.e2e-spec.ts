import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { QUEUES } from '../src/jobs/queues.js';
import { FanoutService } from '../src/notifications/fanout.service.js';
import { RemindersModule } from '../src/reminders/reminders.module.js';
import { DEBT_COOLDOWN_MS, RemindersService } from '../src/reminders/reminders.service.js';
import { as, createTestApp, registerUser, removeReminderJobs, type TestUser } from './helpers.js';

const PREFIX = `e2e-remind-${randomUUID().slice(0, 8)}`;
const HOUR = 3600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

describe('Reminders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let reminders: RemindersService;
  let fanout: FanoutService;
  let reminderQueue: Queue;
  let emailQueue: Queue;
  let owner: TestUser;
  let friend: TestUser;
  let third: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp([RemindersModule]));
    reminders = app.get(RemindersService);
    fanout = app.get(FanoutService);
    reminderQueue = app.get(getQueueToken(QUEUES.reminders));
    emailQueue = app.get(getQueueToken(QUEUES.email));
    owner = await registerUser(app, PREFIX, 'An Owner');
    friend = await registerUser(app, PREFIX, 'Bình Friend');
    third = await registerUser(app, PREFIX, 'Chi Third');
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } } });
    const ids = users.map((u) => u.id);
    // Take this suite's jobs back out of Redis, so a local worker never runs them.
    await removeReminderJobs(app, prisma, ids);
    const emails = await prisma.emailDelivery.findMany({ where: { userId: { in: ids } } });
    for (const e of emails) await (await emailQueue.getJob(e.id))?.remove();
    await prisma.group.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function group(members: TestUser[] = [friend, third]) {
    const res = await as(app, owner)
      .post('/v1/groups')
      .send({ name: 'Weekend crew', currency: 'VND' })
      .expect(201);
    const invite = await as(app, owner)
      .post(`/v1/groups/${res.body.id}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    for (const user of members) {
      await as(app, user).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    }
    return res.body.id as string;
  }

  async function event(groupId: string, startsAt: string, title = 'Hotpot night') {
    const res = await as(app, owner)
      .post(`/v1/groups/${groupId}/events`)
      .send({ title, startsAt, location: 'Quận 1' })
      .expect(201);
    return res.body as { id: string; version: number; startsAt: string };
  }

  function planned(eventId: string) {
    return prisma.eventReminder.findMany({
      where: { eventId, handledAt: null },
      orderBy: { dueAt: 'asc' },
    });
  }

  async function feed(user: TestUser, type: string) {
    const res = await as(app, user).get('/v1/notifications?limit=50').expect(200);
    return (res.body.items as { type: string; text: string; link: string }[])
      .filter((n) => n.type === type)
      .map((n) => ({ ...n, text: n.text.replace(/\s/gu, ' ') }));
  }

  // ---------- Event reminders ----------

  it('plans a reminder a day and an hour before, each with a delayed job', async () => {
    const groupId = await group();
    const e = await event(groupId, inHours(48));
    const rows = await planned(e.id);
    expect(rows.map((r) => r.kind)).toEqual(['24h', '1h']);
    const start = new Date(e.startsAt).getTime();
    expect(rows[0]!.dueAt.getTime()).toBe(start - 24 * HOUR);
    expect(rows[1]!.dueAt.getTime()).toBe(start - HOUR);
    for (const row of rows) {
      const job = await reminderQueue.getJob(row.id);
      expect(job?.name).toBe('event');
      expect(await job?.getState()).toBe('delayed');
    }
  });

  it('only plans reminders that are still ahead', async () => {
    const groupId = await group();
    const soon = await event(groupId, inHours(3));
    expect((await planned(soon.id)).map((r) => r.kind)).toEqual(['1h']);
    const now = await event(groupId, inHours(0.5));
    expect(await planned(now.id)).toHaveLength(0);
  });

  it('moving the event replans; other edits and cancelling behave', async () => {
    const groupId = await group();
    const e = await event(groupId, inHours(48));
    const before = await planned(e.id);

    // A new title alone keeps the plan.
    const renamed = await as(app, owner)
      .patch(`/v1/events/${e.id}`)
      .send({ title: 'Hotpot!', startsAt: e.startsAt, location: 'Quận 1', version: e.version })
      .expect(200);
    expect((await planned(e.id)).map((r) => r.id)).toEqual(before.map((r) => r.id));

    const moved = await as(app, owner)
      .patch(`/v1/events/${e.id}`)
      .send({ title: 'Hotpot!', startsAt: inHours(72), version: renamed.body.version })
      .expect(200);
    const after = await planned(e.id);
    expect(after).toHaveLength(2);
    expect(after.map((r) => r.id)).not.toContain(before[0]!.id);
    expect(after[0]!.dueAt.getTime()).toBe(new Date(moved.body.startsAt).getTime() - 24 * HOUR);
    // The old jobs are gone with their rows.
    expect(await reminderQueue.getJob(before[0]!.id)).toBeUndefined();

    await as(app, owner).post(`/v1/events/${e.id}/cancel`).send({}).expect(200);
    expect(await planned(e.id)).toHaveLength(0);
    expect(await reminderQueue.getJob(after[0]!.id)).toBeUndefined();
  });

  it('reminds the people going or maybe, once, in the app and by email', async () => {
    const groupId = await group();
    const e = await event(groupId, inHours(48));
    await as(app, friend).put(`/v1/events/${e.id}/rsvp`).send({ status: 'maybe' }).expect(200);
    await as(app, third).put(`/v1/events/${e.id}/rsvp`).send({ status: 'no' }).expect(200);
    const [dayBefore] = await planned(e.id);

    // Not due yet: nothing happens, and the job or the sweep comes back later.
    expect(await reminders.handleEventReminder(dayBefore!.id)).toBeNull();
    expect(await reminders.handleEventReminder(dayBefore!.id, dayBefore!.dueAt)).toBe('sent');
    expect(await reminders.handleEventReminder(dayBefore!.id, dayBefore!.dueAt)).toBeNull();
    await fanout.processPending();

    const [mine] = await feed(friend, 'event.reminder');
    expect(mine?.text).toMatch(/^Coming up: Hotpot night in Weekend crew, .+ at Quận 1\.$/u);
    expect(mine?.link).toBe(`/groups/${groupId}/events/${e.id}`);
    expect(await feed(owner, 'event.reminder')).toHaveLength(1); // the planner is going
    expect(await feed(third, 'event.reminder')).toHaveLength(0);
    const emails = await prisma.emailDelivery.findMany({ where: { userId: friend.id } });
    expect(emails.some((m) => m.subject.startsWith('Coming up: Hotpot night'))).toBe(true);
  });

  it('skips a day-before reminder that is too late to be useful', async () => {
    const groupId = await group();
    const e = await event(groupId, inHours(48));
    const [dayBefore, hourBefore] = await planned(e.id);
    const start = new Date(e.startsAt).getTime();
    expect(await reminders.handleEventReminder(dayBefore!.id, new Date(start - HOUR / 2))).toBe(
      'skipped',
    );
    expect(await reminders.handleEventReminder(hourBefore!.id, new Date(start + 1))).toBe(
      'skipped',
    );
    const rows = await prisma.eventReminder.findMany({ where: { eventId: e.id } });
    expect(rows.every((r) => r.outcome === 'skipped' && r.handledAt)).toBe(true);
    await fanout.processPending();
    const forThis = (await feed(owner, 'event.reminder')).filter((n) => n.link.endsWith(e.id));
    expect(forThis).toHaveLength(0);
  });

  it('the sweep sends a due reminder whose job went missing', async () => {
    const groupId = await group();
    const e = await event(groupId, inHours(48), 'Lost job');
    const [dayBefore] = await planned(e.id);
    await (await reminderQueue.getJob(dayBefore!.id))?.remove();
    await prisma.eventReminder.update({
      where: { id: dayBefore!.id },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });
    expect(await reminders.sweepEventReminders()).toBeGreaterThanOrEqual(1);
    const row = await prisma.eventReminder.findUniqueOrThrow({ where: { id: dayBefore!.id } });
    expect(row.outcome).toBe('sent');
  });

  // ---------- Debt reminders ----------

  it('reminds each person who owes, names who to pay, and never twice in a week', async () => {
    const groupId = await group();
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send({
        title: 'Villa',
        amount: 300_000,
        payerId: owner.id,
        splitType: 'equal',
        splits: [owner, friend, third].map((p) => ({ userId: p.id, value: 0 })),
        spentOn: '2026-11-25',
      })
      .expect(201);
    // Chi is already paying, so only Bình is reminded.
    await as(app, third)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: third.id, toUserId: owner.id, amount: 100_000 })
      .expect(201);

    expect(await reminders.remindGroup(groupId)).toBe(1);
    await fanout.processPending();
    const [mine] = await feed(friend, 'debt.reminder');
    expect(mine).toMatchObject({
      text: 'You owe An Owner 100.000 ₫ in Weekend crew.',
      link: `/groups/${groupId}?tab=balances`,
    });
    expect(await feed(third, 'debt.reminder')).toHaveLength(0);
    expect(await feed(owner, 'debt.reminder')).toHaveLength(0);

    // A second run the same week (a retry, or another worker) does nothing...
    expect(await reminders.remindGroup(groupId)).toBe(0);
    // ...but next week they hear again.
    expect(
      await reminders.remindGroup(groupId, new Date(Date.now() + DEBT_COOLDOWN_MS + 1000)),
    ).toBe(1);
  });

  it('a group where everyone is square sends nothing', async () => {
    const groupId = await group([friend]);
    expect(await reminders.remindGroup(groupId)).toBe(0);
  });
});
