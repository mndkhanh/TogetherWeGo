import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { as, createTestApp, registerUser, type TestUser } from './helpers.js';

const PREFIX = `e2e-events-${randomUUID().slice(0, 8)}`;
const HOUR = 3600 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

describe('Events (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestUser;
  let friend: TestUser;
  let third: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await registerUser(app, PREFIX, 'An Owner');
    friend = await registerUser(app, PREFIX, 'Bình Friend');
    third = await registerUser(app, PREFIX, 'Chi Third');
    stranger = await registerUser(app, PREFIX, 'Stranger');
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } } });
    const ids = users.map((u) => u.id);
    await prisma.group.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function group(): Promise<string> {
    const res = await as(app, owner)
      .post('/v1/groups')
      .send({ name: 'Weekend crew', currency: 'VND' })
      .expect(201);
    const invite = await as(app, owner)
      .post(`/v1/groups/${res.body.id}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    for (const user of [friend, third]) {
      await as(app, user).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    }
    return res.body.id as string;
  }

  async function plan(user: TestUser, groupId: string, body: object = {}) {
    const res = await as(app, user)
      .post(`/v1/groups/${groupId}/events`)
      .send({ title: 'Hotpot night', startsAt: inHours(48), location: 'Quận 1', ...body })
      .expect(201);
    return res.body as { id: string; version: number };
  }

  it('a member plans an event and is going; others see it, strangers do not', async () => {
    const groupId = await group();
    const res = await as(app, friend)
      .post(`/v1/groups/${groupId}/events`)
      .send({
        title: '  Hotpot night ',
        startsAt: inHours(48),
        endsAt: inHours(51),
        location: '',
        description: 'Bring <script>alert(1)</script> appetite',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      title: 'Hotpot night',
      location: null,
      status: 'scheduled',
      going: 1,
      myRsvp: 'going',
      canEdit: true,
      version: 1,
      spending: { count: 0, total: 0, currency: 'VND' },
    });
    // Stored as plain text; the web app renders it escaped.
    expect(res.body.description).toBe('Bring <script>alert(1)</script> appetite');

    const asThird = await as(app, third).get(`/v1/events/${res.body.id}`).expect(200);
    expect(asThird.body).toMatchObject({ myRsvp: null, canEdit: false });
    const asOwner = await as(app, owner).get(`/v1/events/${res.body.id}`).expect(200);
    expect(asOwner.body.canEdit).toBe(true); // admin

    await as(app, stranger).get(`/v1/events/${res.body.id}`).expect(404);
    await as(app, stranger).get(`/v1/groups/${groupId}/events`).expect(404);
    await as(app, stranger)
      .put(`/v1/events/${res.body.id}/rsvp`)
      .send({ status: 'going' })
      .expect(404);
  });

  it('validates times and text', async () => {
    const groupId = await group();
    const url = `/v1/groups/${groupId}/events`;
    const backwards = await as(app, owner)
      .post(url)
      .send({ title: 'x', startsAt: inHours(5), endsAt: inHours(4) })
      .expect(400);
    expect(backwards.body.issues[0]).toMatchObject({
      path: 'endsAt',
      message: 'End after it starts',
    });
    await as(app, owner)
      .post(url)
      .send({ title: 'x', startsAt: inHours(1), endsAt: inHours(24 * 31 + 1) })
      .expect(400);
    await as(app, owner)
      .post(url)
      .send({ title: '', startsAt: inHours(1) })
      .expect(400);
    await as(app, owner).post(url).send({ title: 'x', startsAt: 'tomorrow' }).expect(400);
    await as(app, owner)
      .post(url)
      .send({ title: 'x'.repeat(81), startsAt: inHours(1) })
      .expect(400);
  });

  it('lists upcoming soonest first and past most recent first, with paging', async () => {
    const groupId = await group();
    const soon = await plan(owner, groupId, { title: 'Soon', startsAt: inHours(2) });
    const later = await plan(owner, groupId, { title: 'Later', startsAt: inHours(200) });
    // Started an hour ago with no end: still on (assumed to last 3 hours).
    const now = await plan(owner, groupId, { title: 'Now', startsAt: inHours(-1) });
    const last = await plan(owner, groupId, { title: 'Last week', startsAt: inHours(-24 * 7) });
    const older = await plan(owner, groupId, {
      title: 'Older',
      startsAt: inHours(-24 * 14),
      endsAt: inHours(-24 * 13),
    });

    const upcoming = await as(app, friend).get(`/v1/groups/${groupId}/events`).expect(200);
    expect(upcoming.body.items.map((e: { id: string }) => e.id)).toEqual([
      now.id,
      soon.id,
      later.id,
    ]);

    const page1 = await as(app, friend)
      .get(`/v1/groups/${groupId}/events?when=past&limit=1`)
      .expect(200);
    expect(page1.body.items.map((e: { id: string }) => e.id)).toEqual([last.id]);
    const page2 = await as(app, friend)
      .get(`/v1/groups/${groupId}/events?when=past&limit=1&cursor=${page1.body.nextCursor}`)
      .expect(200);
    expect(page2.body.items.map((e: { id: string }) => e.id)).toEqual([older.id]);
    expect(page2.body.nextCursor).toBeNull();
    await as(app, friend).get(`/v1/groups/${groupId}/events?cursor=bogus`).expect(400);
    // Looks like a cursor, but the id isn't a UUID: still a 400, not a database error.
    const fake = (text: string) => Buffer.from(text).toString('base64url');
    await as(app, friend)
      .get(
        `/v1/groups/${groupId}/events?cursor=${fake(`2026-11-25T00:00:00.000Z_${'-'.repeat(36)}`)}`,
      )
      .expect(400);
    await as(app, friend)
      .get(`/v1/groups/${groupId}/expenses?cursor=${fake(`2026-11-25_${'-'.repeat(36)}`)}`)
      .expect(400);
  });

  it('RSVPs count current members only, and change in place', async () => {
    const groupId = await group();
    const e = await plan(owner, groupId);
    await as(app, friend).put(`/v1/events/${e.id}/rsvp`).send({ status: 'maybe' }).expect(200);
    const r = await as(app, third)
      .put(`/v1/events/${e.id}/rsvp`)
      .send({ status: 'going' })
      .expect(200);
    expect(r.body).toMatchObject({ going: 2, maybe: 1, myRsvp: 'going' });
    await as(app, third).put(`/v1/events/${e.id}/rsvp`).send({ status: 'no' }).expect(200);
    await as(app, third).put(`/v1/events/${e.id}/rsvp`).send({ status: 'yes' }).expect(400);

    // Third leaves: their answer no longer shows.
    await as(app, third).delete(`/v1/groups/${groupId}/members/${third.id}`).expect(204);
    const after = await as(app, owner).get(`/v1/events/${e.id}`).expect(200);
    expect(after.body.rsvps.map((x: { userId: string }) => x.userId).sort()).toEqual(
      [owner.id, friend.id].sort(),
    );
    await as(app, third).put(`/v1/events/${e.id}/rsvp`).send({ status: 'going' }).expect(404);
  });

  it('only the planner or an admin edits or cancels; edits use the version', async () => {
    const groupId = await group();
    const e = await plan(friend, groupId);
    const body = { title: 'Hotpot night (moved)', startsAt: inHours(72), version: 1 };

    await as(app, third).patch(`/v1/events/${e.id}`).send(body).expect(403);
    await as(app, third).post(`/v1/events/${e.id}/cancel`).expect(403);

    const updated = await as(app, friend).patch(`/v1/events/${e.id}`).send(body).expect(200);
    expect(updated.body).toMatchObject({ title: 'Hotpot night (moved)', version: 2 });
    // Stale version: someone else changed it.
    await as(app, owner).patch(`/v1/events/${e.id}`).send(body).expect(409);

    const cancelled = await as(app, owner).post(`/v1/events/${e.id}/cancel`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await as(app, owner).post(`/v1/events/${e.id}/cancel`).expect(409);
    await as(app, friend).put(`/v1/events/${e.id}/rsvp`).send({ status: 'no' }).expect(409);
    await as(app, friend)
      .patch(`/v1/events/${e.id}`)
      .send({ ...body, version: 3 })
      .expect(409);
  });

  it('comments: members post plain text, authors and admins delete', async () => {
    const groupId = await group();
    const e = await plan(owner, groupId);
    const url = `/v1/events/${e.id}/comments`;

    const mine = await as(app, friend)
      .post(url)
      .send({ body: '  I’ll bring drinks  ' })
      .expect(201);
    expect(mine.body).toMatchObject({ body: 'I’ll bring drinks', canDelete: true });
    const theirs = await as(app, third)
      .post(url)
      .send({ body: '<img src=x onerror=alert(1)>' })
      .expect(201);
    await as(app, third).post(url).send({ body: '   ' }).expect(400);
    await as(app, third)
      .post(url)
      .send({ body: 'x'.repeat(1001) })
      .expect(400);
    await as(app, stranger).post(url).send({ body: 'hi' }).expect(404);

    const list = await as(app, owner).get(url).expect(200);
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual([
      theirs.body.id,
      mine.body.id,
    ]);
    expect(list.body.items.every((c: { canDelete: boolean }) => c.canDelete)).toBe(true); // owner

    // Members can't delete each other's comments; strangers can't see them.
    await as(app, third).delete(`/v1/comments/${mine.body.id}`).expect(403);
    await as(app, stranger).delete(`/v1/comments/${mine.body.id}`).expect(404);
    await as(app, friend).delete(`/v1/comments/${mine.body.id}`).expect(204);
    await as(app, owner).delete(`/v1/comments/${theirs.body.id}`).expect(204);
    await as(app, owner).delete(`/v1/comments/${theirs.body.id}`).expect(404);

    const empty = await as(app, owner).get(`/v1/events/${e.id}`).expect(200);
    expect(empty.body.commentCount).toBe(0);
  });

  it('expenses link to events in the same group only', async () => {
    const groupId = await group();
    const otherGroup = await group();
    const e = await plan(owner, groupId);
    const foreign = await plan(owner, otherGroup);
    const expense = (eventId: string | null) => ({
      title: 'Hotpot',
      amount: 600_000,
      payerId: owner.id,
      splitType: 'equal',
      splits: [owner, friend].map((p) => ({ userId: p.id, value: 0 })),
      spentOn: '2026-11-25',
      eventId,
    });

    const linked = await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(expense(e.id))
      .expect(201);
    expect(linked.body.event).toMatchObject({ id: e.id, title: 'Hotpot night' });
    const bad = await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(expense(foreign.id))
      .expect(400);
    expect(bad.body.issues[0].path).toBe('eventId');

    await as(app, owner).post(`/v1/groups/${groupId}/expenses`).send(expense(null)).expect(201);
    const filtered = await as(app, friend)
      .get(`/v1/groups/${groupId}/expenses?eventId=${e.id}`)
      .expect(200);
    expect(filtered.body.items).toHaveLength(1);

    const detail = await as(app, friend).get(`/v1/events/${e.id}`).expect(200);
    expect(detail.body.spending).toEqual({ count: 1, total: 600_000, currency: 'VND' });

    // Unlinking shows up in the expense history.
    const updated = await as(app, owner)
      .patch(`/v1/expenses/${linked.body.id}`)
      .send({ ...expense(null), version: 1 })
      .expect(200);
    expect(updated.body.history.at(-1).changes).toContain('Unlinked from its event');

    // The database refuses a cross-group link even if the service were bypassed.
    await expect(
      prisma.expense.update({ where: { id: linked.body.id }, data: { eventId: foreign.id } }),
    ).rejects.toThrow(/can only link to an event in its own group/);
  });

  it('archived groups are read-only for events', async () => {
    const groupId = await group();
    const e = await plan(owner, groupId);
    await as(app, owner).post(`/v1/groups/${groupId}/archive`).expect(200);
    await as(app, friend).get(`/v1/events/${e.id}`).expect(200);
    await as(app, friend).put(`/v1/events/${e.id}/rsvp`).send({ status: 'no' }).expect(409);
    await as(app, friend).post(`/v1/events/${e.id}/comments`).send({ body: 'hi' }).expect(409);
    await as(app, owner)
      .post(`/v1/groups/${groupId}/events`)
      .send({ title: 'x', startsAt: inHours(1) })
      .expect(409);
  });
});
