import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { as, createTestApp, registerUser, type TestUser } from './helpers.js';

const PREFIX = `e2e-groups-${randomUUID().slice(0, 8)}`;

describe('Groups (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: TestUser;
  let friend: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    owner = await registerUser(app, PREFIX, 'Khanh Owner');
    friend = await registerUser(app, PREFIX, 'Linh Friend');
    stranger = await registerUser(app, PREFIX, 'Stranger');
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } } });
    const ids = users.map((u) => u.id);
    await prisma.group.deleteMany({ where: { createdBy: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  });

  async function createGroup(user: TestUser, name = 'Đà Lạt trip'): Promise<string> {
    const res = await as(app, user).post('/v1/groups').send({ name, currency: 'VND' }).expect(201);
    return res.body.id;
  }

  async function invite(user: TestUser, groupId: string, maxUses: number | null = null) {
    const res = await as(app, user)
      .post(`/v1/groups/${groupId}/invites`)
      .send({ expiresInDays: 7, maxUses })
      .expect(201);
    return res.body.code as string;
  }

  function join(user: TestUser, code: string) {
    return as(app, user).post(`/v1/invites/${code}/accept`);
  }

  it('creates a group with the creator as owner and lists it', async () => {
    const groupId = await createGroup(owner);
    const detail = await as(app, owner).get(`/v1/groups/${groupId}`).expect(200);
    expect(detail.body).toMatchObject({ name: 'Đà Lạt trip', myRole: 'owner', memberCount: 1 });
    expect(detail.body.members).toEqual([
      expect.objectContaining({ userId: owner.id, role: 'owner' }),
    ]);

    const list = await as(app, owner).get('/v1/groups').expect(200);
    expect(list.body.map((g: { id: string }) => g.id)).toContain(groupId);
  });

  it('hides groups from non-members with 404', async () => {
    const groupId = await createGroup(owner);
    await as(app, stranger).get(`/v1/groups/${groupId}`).expect(404);
    await as(app, stranger).patch(`/v1/groups/${groupId}`).send({ name: 'Mine now' }).expect(404);
    await as(app, stranger).get(`/v1/groups/${randomUUID()}`).expect(404);
    await as(app, stranger).get('/v1/groups/not-a-uuid').expect(400);
  });

  it('joins through an invite link, idempotently', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId);

    const preview = await as(app, friend).get(`/v1/invites/${code}`).expect(200);
    expect(preview.body).toMatchObject({
      groupId,
      groupName: 'Đà Lạt trip',
      memberCount: 1,
      invitedBy: 'Khanh Owner',
      alreadyMember: false,
    });

    await join(friend, code).expect(200, { groupId });
    await join(friend, code).expect(200, { groupId }); // second time: no error, no extra use

    const invites = await as(app, owner).get(`/v1/groups/${groupId}/invites`).expect(200);
    expect(invites.body[0].uses).toBe(1);

    const detail = await as(app, friend).get(`/v1/groups/${groupId}`).expect(200);
    expect(detail.body.myRole).toBe('member');
    expect(detail.body.memberCount).toBe(2);
  });

  it('rejects malformed, revoked and used-up invites with the same message', async () => {
    const groupId = await createGroup(owner);
    const malformed = await as(app, friend).get('/v1/invites/nope').expect(404);

    const revokedCode = await invite(owner, groupId);
    await as(app, owner).delete(`/v1/groups/${groupId}/invites/${revokedCode}`).expect(204);
    const revoked = await join(friend, revokedCode).expect(404);

    const singleUse = await invite(owner, groupId, 1);
    await join(friend, singleUse).expect(200);
    const usedUp = await join(stranger, singleUse).expect(404);

    expect(new Set([malformed.body.message, revoked.body.message, usedUp.body.message]).size).toBe(
      1,
    );
  });

  it('rejects expired invites', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId);
    await prisma.groupInvite.update({
      where: { code },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await join(friend, code).expect(404);
  });

  it('never lets concurrent joins exceed maxUses', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId, 2);
    const joiners = await Promise.all(
      Array.from({ length: 5 }, (_, i) => registerUser(app, PREFIX, `Racer ${i}`)),
    );

    const results = await Promise.all(joiners.map((user) => join(user, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    const row = await prisma.groupInvite.findUniqueOrThrow({ where: { code } });
    expect(row.uses).toBe(2);
  });

  it('only lets admins and owners manage invites', async () => {
    const groupId = await createGroup(owner);
    await join(friend, await invite(owner, groupId)).expect(200);
    await as(app, friend)
      .post(`/v1/groups/${groupId}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(403);
    await as(app, friend).get(`/v1/groups/${groupId}/invites`).expect(403);
  });

  it('enforces the role hierarchy for removing members', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId);
    await join(friend, code).expect(200);
    await join(stranger, code).expect(200);

    // A member can't remove anyone.
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${stranger.id}`).expect(403);

    // Promote friend to admin: admins can remove members but not the owner.
    await as(app, owner)
      .patch(`/v1/groups/${groupId}/members/${friend.id}`)
      .send({ role: 'admin' })
      .expect(200);
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${owner.id}`).expect(403);
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${stranger.id}`).expect(204);

    await as(app, stranger).get(`/v1/groups/${groupId}`).expect(404);
    const list = await as(app, stranger).get('/v1/groups').expect(200);
    expect(list.body.map((g: { id: string }) => g.id)).not.toContain(groupId);
  });

  it('lets members leave and rejoin, but not the owner', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId);
    await join(friend, code).expect(200);

    await as(app, owner).delete(`/v1/groups/${groupId}/members/${owner.id}`).expect(409);
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${friend.id}`).expect(204);
    await as(app, friend).get(`/v1/groups/${groupId}`).expect(404);

    await join(friend, code).expect(200);
    const detail = await as(app, friend).get(`/v1/groups/${groupId}`).expect(200);
    expect(detail.body.myRole).toBe('member');
  });

  it('transfers ownership: exactly one owner afterwards', async () => {
    const groupId = await createGroup(owner);
    await join(friend, await invite(owner, groupId)).expect(200);

    await as(app, friend)
      .patch(`/v1/groups/${groupId}/members/${owner.id}`)
      .send({ role: 'member' })
      .expect(403);

    const res = await as(app, owner)
      .patch(`/v1/groups/${groupId}/members/${friend.id}`)
      .send({ role: 'owner' })
      .expect(200);
    const roles = Object.fromEntries(
      res.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(roles).toEqual({ [friend.id]: 'owner', [owner.id]: 'admin' });
    expect(res.body.myRole).toBe('admin');

    // The former owner can now leave, and the links they created stop working.
    const ownersLink = await invite(owner, groupId);
    await as(app, owner).delete(`/v1/groups/${groupId}/members/${owner.id}`).expect(204);
    await join(stranger, ownersLink).expect(404);
  });

  it('only honours links while their creator is still an admin', async () => {
    const groupId = await createGroup(owner);
    await join(friend, await invite(owner, groupId)).expect(200);
    await as(app, owner)
      .patch(`/v1/groups/${groupId}/members/${friend.id}`)
      .send({ role: 'admin' })
      .expect(200);
    const friendsLink = await invite(friend, groupId);

    // Demoted: the link stops working and drops off the active list.
    await as(app, owner)
      .patch(`/v1/groups/${groupId}/members/${friend.id}`)
      .send({ role: 'member' })
      .expect(200);
    await as(app, stranger).get(`/v1/invites/${friendsLink}`).expect(404);
    await join(stranger, friendsLink).expect(404);
    const active = await as(app, owner).get(`/v1/groups/${groupId}/invites`).expect(200);
    expect(active.body.map((i: { code: string }) => i.code)).not.toContain(friendsLink);

    // Even an unrevoked link from someone who left is refused (covers a create/leave race).
    const ownersLink = await invite(owner, groupId);
    await prisma.groupMember.update({
      where: { groupId_userId: { groupId, userId: owner.id } },
      data: { leftAt: new Date() },
    });
    await join(stranger, ownersLink).expect(404);
  });

  it('makes archived groups read-only until the owner unarchives', async () => {
    const groupId = await createGroup(owner);
    const code = await invite(owner, groupId);

    await as(app, owner).post(`/v1/groups/${groupId}/archive`).expect(200);
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ name: 'Renamed' }).expect(409);
    await join(friend, code).expect(404);

    await as(app, owner).post(`/v1/groups/${groupId}/unarchive`).expect(200);
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ name: 'Renamed' }).expect(200);
    await join(friend, code).expect(200);
  });
});
