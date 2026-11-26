import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { as, createTestApp, registerUser, type TestUser } from './helpers.js';

const PREFIX = `e2e-expenses-${randomUUID().slice(0, 8)}`;

describe('Expenses (e2e)', () => {
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

  /** A VND group with owner, friend and third as members. */
  async function trip(): Promise<string> {
    const res = await as(app, owner)
      .post('/v1/groups')
      .send({ name: 'Hội An', currency: 'VND' })
      .expect(201);
    const groupId: string = res.body.id;
    const invite = await as(app, owner)
      .post(`/v1/groups/${groupId}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    for (const user of [friend, third]) {
      await as(app, user).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    }
    return groupId;
  }

  const equally = (payer: TestUser, amount: number, people: TestUser[], title = 'Dinner') => ({
    title,
    amount,
    payerId: payer.id,
    splitType: 'equal',
    splits: people.map((p) => ({ userId: p.id, value: 0 })),
    spentOn: '2026-11-20',
  });

  async function addExpense(user: TestUser, groupId: string, body: object) {
    const res = await as(app, user).post(`/v1/groups/${groupId}/expenses`).send(body).expect(201);
    return res.body as { id: string; version: number };
  }

  async function nets(user: TestUser, groupId: string): Promise<Record<string, number>> {
    const res = await as(app, user).get(`/v1/groups/${groupId}/balances`).expect(200);
    return Object.fromEntries(
      res.body.members.map((m: { userId: string; net: number }) => [m.userId, m.net]),
    );
  }

  it('adds an equal split and derives balances and suggested payments', async () => {
    const groupId = await trip();
    const res = await as(app, friend)
      .post(`/v1/groups/${groupId}/expenses`)
      .send(equally(owner, 100_000, [owner, friend, third]))
      .expect(201);
    expect(res.body).toMatchObject({
      amount: 100_000,
      currency: 'VND',
      version: 1,
      myNet: -33_333,
    });
    expect(res.body.splits.map((s: { amount: number }) => s.amount)).toEqual([
      33_334, 33_333, 33_333,
    ]);
    expect(res.body.history).toEqual([expect.objectContaining({ action: 'created' })]);

    const balances = await as(app, third).get(`/v1/groups/${groupId}/balances`).expect(200);
    expect(balances.body.totalSpent).toBe(100_000);
    const byId = Object.fromEntries(
      balances.body.members.map((m: { userId: string; net: number }) => [m.userId, m.net]),
    );
    expect(byId).toEqual({ [owner.id]: 66_666, [friend.id]: -33_333, [third.id]: -33_333 });
    expect(balances.body.transfers).toHaveLength(2);
    expect(
      balances.body.transfers.every((t: { toUserId: string }) => t.toUserId === owner.id),
    ).toBe(true);
  });

  it('rejects bad splits, outsiders and oversized amounts', async () => {
    const groupId = await trip();
    const url = `/v1/groups/${groupId}/expenses`;

    const mismatch = await as(app, owner)
      .post(url)
      .send({
        ...equally(owner, 300, [owner]),
        splitType: 'exact',
        splits: [
          { userId: owner.id, value: 100 },
          { userId: friend.id, value: 100 },
        ],
      })
      .expect(400);
    expect(mismatch.body.issues[0].message).toMatch(/add up to 200, not 300/);

    await as(app, owner)
      .post(url)
      .send(equally(stranger, 300, [owner]))
      .expect(400);
    await as(app, owner)
      .post(url)
      .send(equally(owner, 300, [owner, stranger]))
      .expect(400);
    await as(app, owner)
      .post(url)
      .send(equally(owner, 10_000_000_001, [owner]))
      .expect(400);
    await as(app, owner)
      .post(url)
      .send({ ...equally(owner, 300, [owner]), amount: 1.5 })
      .expect(400);
  });

  it('hides expenses from non-members', async () => {
    const groupId = await trip();
    const { id } = await addExpense(owner, groupId, equally(owner, 900, [owner, friend]));
    await as(app, stranger).get(`/v1/expenses/${id}`).expect(404);
    await as(app, stranger).get(`/v1/groups/${groupId}/expenses`).expect(404);
    await as(app, stranger).get(`/v1/groups/${groupId}/balances`).expect(404);
    await as(app, stranger).patch(`/v1/expenses/${id}`).send({}).expect(400);
    await as(app, stranger)
      .patch(`/v1/expenses/${id}`)
      .send({ ...equally(owner, 900, [owner]), version: 1 })
      .expect(404);
    await as(app, stranger).delete(`/v1/expenses/${id}`).expect(404);
  });

  it('edits with optimistic locking and records readable history', async () => {
    const groupId = await trip();
    const { id } = await addExpense(friend, groupId, equally(friend, 300_000, [owner, friend]));

    const edited = await as(app, friend)
      .patch(`/v1/expenses/${id}`)
      .send({ ...equally(friend, 360_000, [owner, friend, third], 'Dinner + drinks'), version: 1 })
      .expect(200);
    expect(edited.body.version).toBe(2);
    expect(edited.body.history.map((h: { action: string }) => h.action)).toEqual([
      'created',
      'updated',
    ]);
    const changes: string[] = edited.body.history[1].changes;
    expect(changes).toContain('Title: “Dinner” → “Dinner + drinks”');
    expect(changes.some((c) => c.startsWith('Amount:') && c.includes('360.000'))).toBe(true);
    expect(changes.some((c) => c.startsWith('Split:'))).toBe(true);

    // Someone still holding version 1 must not overwrite the edit.
    await as(app, friend)
      .patch(`/v1/expenses/${id}`)
      .send({ ...equally(friend, 1, [friend]), version: 1 })
      .expect(409);

    const n = await nets(owner, groupId);
    expect(n).toEqual({ [owner.id]: -120_000, [friend.id]: 240_000, [third.id]: -120_000 });
  });

  it('lets exactly one of two concurrent edits win', async () => {
    const groupId = await trip();
    const { id } = await addExpense(owner, groupId, equally(owner, 1000, [owner, friend]));
    const results = await Promise.all(
      [2000, 3000].map((amount) =>
        as(app, owner)
          .patch(`/v1/expenses/${id}`)
          .send({ ...equally(owner, amount, [owner, friend]), version: 1 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('only lets the creator, the payer or an admin change an expense', async () => {
    const groupId = await trip();
    const { id } = await addExpense(friend, groupId, equally(friend, 600, [friend, third]));
    const body = { ...equally(friend, 900, [friend, third]), version: 1 };

    await as(app, third).patch(`/v1/expenses/${id}`).send(body).expect(403);
    await as(app, third).delete(`/v1/expenses/${id}`).expect(403);
    await as(app, owner).patch(`/v1/expenses/${id}`).send(body).expect(200); // owner is admin+
  });

  it('deletes softly: balances return to zero and the expense disappears', async () => {
    const groupId = await trip();
    const { id } = await addExpense(owner, groupId, equally(owner, 500, [owner, friend]));
    await as(app, owner).delete(`/v1/expenses/${id}`).expect(204);
    await as(app, owner).get(`/v1/expenses/${id}`).expect(404);
    await as(app, owner).delete(`/v1/expenses/${id}`).expect(404);

    const list = await as(app, owner).get(`/v1/groups/${groupId}/expenses`).expect(200);
    expect(list.body.items).toEqual([]);
    expect(Object.values(await nets(owner, groupId)).every((v) => v === 0)).toBe(true);

    const row = await prisma.expense.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('blocks leaving or removal while someone owes or is owed money', async () => {
    const groupId = await trip();
    const { id } = await addExpense(owner, groupId, equally(owner, 1000, [owner, friend]));

    const leave = await as(app, friend)
      .delete(`/v1/groups/${groupId}/members/${friend.id}`)
      .expect(409);
    expect(leave.body.message).toMatch(/Settle up before you leave/);
    await as(app, owner).delete(`/v1/groups/${groupId}/members/${friend.id}`).expect(409);

    await as(app, owner).delete(`/v1/expenses/${id}`).expect(204);
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${friend.id}`).expect(204);
  });

  it('freezes expenses that involve someone who has left', async () => {
    const groupId = await trip();
    // Friend paid only for themself: on the expense, but with a zero balance, so they can leave.
    const { id } = await addExpense(friend, groupId, equally(friend, 700, [friend]));
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${friend.id}`).expect(204);

    const res = await as(app, owner)
      .patch(`/v1/expenses/${id}`)
      .send({ ...equally(owner, 700, [owner]), version: 1 })
      .expect(409);
    expect(res.body.message).toMatch(/Bình Friend has left the group/);
    await as(app, owner).delete(`/v1/expenses/${id}`).expect(409);
  });

  it('pages through expenses newest first', async () => {
    const groupId = await trip();
    for (const [day, title] of [
      ['2026-11-01', 'First'],
      ['2026-11-03', 'Third'],
      ['2026-11-02', 'Second'],
    ]) {
      await addExpense(owner, groupId, { ...equally(owner, 100, [owner]), title, spentOn: day });
    }
    const page1 = await as(app, owner).get(`/v1/groups/${groupId}/expenses?limit=2`).expect(200);
    expect(page1.body.items.map((e: { title: string }) => e.title)).toEqual(['Third', 'Second']);
    const page2 = await as(app, owner)
      .get(`/v1/groups/${groupId}/expenses?limit=2&cursor=${page1.body.nextCursor}`)
      .expect(200);
    expect(page2.body.items.map((e: { title: string }) => e.title)).toEqual(['First']);
    expect(page2.body.nextCursor).toBeNull();
    await as(app, owner).get(`/v1/groups/${groupId}/expenses?cursor=garbage`).expect(400);
  });

  it('locks the group currency once there are expenses', async () => {
    const groupId = await trip();
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ currency: 'USD' }).expect(200);
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ currency: 'VND' }).expect(200);
    await addExpense(owner, groupId, equally(owner, 100, [owner]));
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ currency: 'USD' }).expect(409);
  });

  it('never saves an expense in a currency the group no longer uses', async () => {
    for (let i = 0; i < 5; i++) {
      const groupId = await trip();
      await Promise.all([
        as(app, owner).patch(`/v1/groups/${groupId}`).send({ currency: 'USD' }),
        as(app, friend)
          .post(`/v1/groups/${groupId}/expenses`)
          .send(equally(friend, 1000, [owner, friend])),
      ]);
      const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } });
      const expenses = await prisma.expense.findMany({ where: { groupId } });
      expect(expenses.every((e) => e.currency === group.currency)).toBe(true);
    }
  });

  it('enforces money invariants in the database too', async () => {
    const groupId = await trip();
    const { id } = await addExpense(owner, groupId, equally(owner, 1000, [owner, friend]));

    // Splits that no longer add up to the amount are rejected at commit.
    await expect(
      prisma.expenseSplit.update({
        where: { expenseId_userId: { expenseId: id, userId: friend.id } },
        data: { amount: { increment: 1 } },
      }),
    ).rejects.toThrow(/does not match amount/);
    await expect(prisma.expense.update({ where: { id }, data: { amount: -5n } })).rejects.toThrow();

    // Moving a split to another expense must leave both balanced.
    const other = await addExpense(owner, groupId, equally(owner, 1000, [owner, friend]));
    await expect(
      prisma.expenseSplit.update({
        where: { expenseId_userId: { expenseId: id, userId: friend.id } },
        data: { expenseId: other.id, userId: third.id },
      }),
    ).rejects.toThrow(/does not match amount/);

    // The audit trail can't be rewritten.
    await expect(prisma.activityLog.deleteMany({ where: { entityId: id } })).rejects.toThrow(
      /append-only/,
    );
    await expect(
      prisma.activityLog.updateMany({ where: { entityId: id }, data: { action: 'x' } }),
    ).rejects.toThrow(/append-only/);
  });

  describe('receipts', () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    async function upload(user: TestUser, groupId: string, body: Blob, type = 'image/png') {
      const res = await as(app, user)
        .post(`/v1/groups/${groupId}/receipts`)
        .send({ contentType: 'image/png', size: body.size })
        .expect(201);
      const form = new FormData();
      for (const [k, v] of Object.entries(res.body.fields as Record<string, string>)) {
        form.append(k, k === 'Content-Type' ? type : v);
      }
      form.append('file', body);
      const s3 = await fetch(res.body.url, { method: 'POST', body: form });
      return { key: res.body.key as string, status: s3.status };
    }

    it('uploads straight to storage, attaches to an expense and serves a short-lived link', async () => {
      const groupId = await trip();
      const { key, status } = await upload(owner, groupId, new Blob([PNG], { type: 'image/png' }));
      expect(status).toBeLessThan(300);
      expect(key).toMatch(new RegExp(`^receipts/${groupId}/`));

      const created = await as(app, owner)
        .post(`/v1/groups/${groupId}/expenses`)
        .send({ ...equally(owner, 500, [owner, friend]), receiptKey: key })
        .expect(201);
      expect(created.body.hasReceipt).toBe(true);

      const detail = await as(app, friend).get(`/v1/expenses/${created.body.id}`).expect(200);
      const photo = await fetch(detail.body.receiptUrl);
      expect(photo.status).toBe(200);
      expect(new Uint8Array(await photo.arrayBuffer())).toEqual(PNG);
    });

    it('refuses other groups’ photos, made-up keys and missing uploads', async () => {
      const groupA = await trip();
      const groupB = await trip();
      const { key } = await upload(owner, groupA, new Blob([PNG], { type: 'image/png' }));
      const url = `/v1/groups/${groupB}/expenses`;

      await as(app, owner)
        .post(url)
        .send({ ...equally(owner, 1, [owner]), receiptKey: key })
        .expect(400);
      await as(app, owner)
        .post(url)
        .send({ ...equally(owner, 1, [owner]), receiptKey: '../../etc/passwd' })
        .expect(400);
      await as(app, owner)
        .post(url)
        .send({
          ...equally(owner, 1, [owner]),
          receiptKey: `receipts/${groupB}/${randomUUID()}.png`, // well-formed, never uploaded
        })
        .expect(400);
    });

    it('lets storage enforce the signed content type and size', async () => {
      const groupId = await trip();
      const wrongType = await upload(owner, groupId, new Blob(['<svg/>']), 'image/svg+xml');
      expect(wrongType.status).toBeGreaterThanOrEqual(400);

      await as(app, owner)
        .post(`/v1/groups/${groupId}/receipts`)
        .send({ contentType: 'application/pdf', size: 1000 })
        .expect(400);
      await as(app, owner)
        .post(`/v1/groups/${groupId}/receipts`)
        .send({ contentType: 'image/png', size: 6 * 1024 * 1024 })
        .expect(400);
      await as(app, stranger)
        .post(`/v1/groups/${groupId}/receipts`)
        .send({ contentType: 'image/png', size: 1000 })
        .expect(404);
    });
  });
});
