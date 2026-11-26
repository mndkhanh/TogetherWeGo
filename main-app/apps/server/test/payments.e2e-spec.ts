import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { as, createTestApp, registerUser, type TestUser } from './helpers.js';

const PREFIX = `e2e-payments-${randomUUID().slice(0, 8)}`;
const MB_BANK = '970422';

let sepayId = Math.floor(Date.now() / 1000) * 1000;

describe('Settling up (e2e)', () => {
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

  /** A group where friend owes owner 150.000 ₫ and third owes owner 150.000 ₫. */
  async function trip(currency: 'VND' | 'USD' = 'VND'): Promise<string> {
    const res = await as(app, owner)
      .post('/v1/groups')
      .send({ name: 'Đà Lạt', currency })
      .expect(201);
    const groupId: string = res.body.id;
    const invite = await as(app, owner)
      .post(`/v1/groups/${groupId}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    for (const user of [friend, third]) {
      await as(app, user).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    }
    await as(app, owner)
      .post(`/v1/groups/${groupId}/expenses`)
      .send({
        title: 'Villa',
        amount: 450_000,
        payerId: owner.id,
        splitType: 'equal',
        splits: [owner, friend, third].map((p) => ({ userId: p.id, value: 0 })),
        spentOn: '2026-11-20',
      })
      .expect(201);
    return groupId;
  }

  async function nets(groupId: string): Promise<Record<string, number>> {
    const res = await as(app, owner).get(`/v1/groups/${groupId}/balances`).expect(200);
    return Object.fromEntries(
      res.body.members.map((m: { userId: string; net: number }) => [m.userId, m.net]),
    );
  }

  async function pay(from: TestUser, to: TestUser, groupId: string, amount = 150_000) {
    const res = await as(app, from)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: from.id, toUserId: to.id, amount })
      .expect(201);
    return res.body as { id: string; paymentCode: string; status: string };
  }

  /** Bank account + SePay key for a user; returns the key SePay would send. */
  async function connectSepay(user: TestUser, accountNumber: string): Promise<string> {
    await as(app, user)
      .put('/v1/me/payment-account')
      .send({ bankBin: MB_BANK, accountNumber, holderName: user.name })
      .expect(200);
    const res = await as(app, user).post('/v1/me/payment-account/sepay-key').expect(201);
    return res.body.apiKey as string;
  }

  function webhook(key: string | null, body: object) {
    const req = request(app.getHttpServer()).post('/v1/webhooks/sepay');
    if (key) req.set('Authorization', `Apikey ${key}`);
    return req.send(body);
  }

  function transfer(accountNumber: string, amount: number, content: string, id = ++sepayId) {
    return {
      id,
      gateway: 'MBBank',
      transactionDate: '2026-11-25 10:00:00',
      accountNumber,
      subAccount: null,
      code: null,
      content,
      transferType: 'in',
      transferAmount: amount,
      accumulated: 0,
      referenceCode: `FT${id}`,
      description: '',
    };
  }

  const accountNo = () => String(Math.floor(Math.random() * 1e10)).padStart(10, '0');

  it('saves bank details with the holder name as banks write it', async () => {
    const res = await as(app, friend)
      .put('/v1/me/payment-account')
      .send({ bankBin: MB_BANK, accountNumber: '0123456789', holderName: '  Trần  Thị Bình ' })
      .expect(200);
    expect(res.body).toMatchObject({
      bankName: 'MB Bank',
      holderName: 'TRAN THI BINH',
      sepayConnected: false,
    });
    await as(app, friend)
      .put('/v1/me/payment-account')
      .send({ bankBin: '000000', accountNumber: '01 23', holderName: 'x' })
      .expect(400);
    await as(app, friend).delete('/v1/me/payment-account').expect(204);
    expect((await as(app, friend).get('/v1/me/payment-account').expect(200)).body).toEqual({
      account: null,
    });
  });

  it('payer asks to pay, payee confirms, balances move', async () => {
    const groupId = await trip();
    await as(app, owner)
      .put('/v1/me/payment-account')
      .send({ bankBin: MB_BANK, accountNumber: '9704220001', holderName: 'An Owner' })
      .expect(200);

    const created = await pay(friend, owner, groupId);
    expect(created.status).toBe('pending');
    expect(created.paymentCode).toMatch(/^TWG[A-Z2-9]{8}$/);

    // Only the two people involved see the bank details and QR.
    const mine = await as(app, friend).get(`/v1/settlements/${created.id}`).expect(200);
    expect(mine.body.payee).toMatchObject({ accountNumber: '9704220001', holderName: 'AN OWNER' });
    expect(mine.body.payee.qrUrl).toContain(`des=${created.paymentCode}`);
    const theirs = await as(app, third).get(`/v1/settlements/${created.id}`).expect(200);
    expect(theirs.body.payee).toBeNull();
    await as(app, stranger).get(`/v1/settlements/${created.id}`).expect(404);

    // Pending payments don't count yet.
    expect((await nets(groupId))[friend.id]).toBe(-150_000);

    // The payer can't confirm their own debt; nobody else can either.
    await as(app, friend).post(`/v1/settlements/${created.id}/confirm`).send({}).expect(403);
    await as(app, third).post(`/v1/settlements/${created.id}/confirm`).send({}).expect(403);

    const confirmed = await as(app, owner)
      .post(`/v1/settlements/${created.id}/confirm`)
      .send({})
      .expect(200);
    expect(confirmed.body).toMatchObject({
      status: 'confirmed',
      confirmedVia: 'manual',
      paidAmount: 150_000,
    });
    expect(confirmed.body.payee).toBeNull();
    expect(await nets(groupId)).toEqual({
      [owner.id]: 150_000,
      [friend.id]: 0,
      [third.id]: -150_000,
    });

    // Confirmed is final.
    await as(app, owner).post(`/v1/settlements/${created.id}/cancel`).expect(409);
    await as(app, owner).post(`/v1/settlements/${created.id}/confirm`).send({}).expect(409);
  });

  it('payee records cash; partial payments leave the rest owed', async () => {
    const groupId = await trip();
    const cash = await as(app, owner)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: third.id, toUserId: owner.id, amount: 100_000 })
      .expect(201);
    expect(cash.body).toMatchObject({ status: 'confirmed', confirmedVia: 'manual' });
    expect((await nets(groupId))[third.id]).toBe(-50_000);

    // Nobody records payments between other people.
    await as(app, owner)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: third.id, toUserId: friend.id, amount: 1 })
      .expect(403);
    await as(app, friend)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: friend.id, toUserId: stranger.id, amount: 1 })
      .expect(400);
    await as(app, friend)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: friend.id, toUserId: owner.id, amount: 0 })
      .expect(400);
    await as(app, stranger)
      .post(`/v1/groups/${groupId}/settlements`)
      .send({ fromUserId: stranger.id, toUserId: owner.id, amount: 1 })
      .expect(404);

    // The payee says less arrived than was asked for.
    const asked = await pay(friend, owner, groupId);
    await as(app, owner)
      .post(`/v1/settlements/${asked.id}/confirm`)
      .send({ amount: 100_000 })
      .expect(200);
    expect((await nets(groupId))[friend.id]).toBe(-50_000);
  });

  it('either side can cancel a pending payment, and it stops counting', async () => {
    const groupId = await trip();
    const a = await pay(friend, owner, groupId);
    await as(app, third).post(`/v1/settlements/${a.id}/cancel`).expect(403);
    await as(app, owner).post(`/v1/settlements/${a.id}/cancel`).expect(200);
    await as(app, owner).post(`/v1/settlements/${a.id}/confirm`).send({}).expect(409);
    const list = await as(app, friend).get(`/v1/groups/${groupId}/settlements`).expect(200);
    expect(list.body).toEqual([]);
  });

  it('blocks leaving while a payment is waiting', async () => {
    const groupId = await trip();
    const p = await pay(friend, owner, groupId);
    await as(app, owner).post(`/v1/settlements/${p.id}/confirm`).send({}).expect(200);
    // Settled, but another payment is open.
    const open = await pay(friend, owner, groupId, 1000);
    const blocked = await as(app, friend)
      .delete(`/v1/groups/${groupId}/members/${friend.id}`)
      .expect(409);
    expect(blocked.body.message).toMatch(/waiting to be confirmed/);
    await as(app, friend).post(`/v1/settlements/${open.id}/cancel`).expect(200);
    await as(app, friend).delete(`/v1/groups/${groupId}/members/${friend.id}`).expect(204);
  });

  it('SePay webhook confirms the payment it is for, once', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(owner, account);
    const p = await pay(friend, owner, groupId);

    const detail = await as(app, friend).get(`/v1/settlements/${p.id}`).expect(200);
    expect(detail.body.autoConfirm).toBe(true);

    const body = transfer(account, 150_000, `MBVCB.123.${p.paymentCode.toLowerCase()}.CT tu BINH`);
    const first = await webhook(key, body).expect(200);
    expect(first.body).toEqual({ success: true, outcome: 'matched' });
    // SePay retries: nothing happens twice.
    const again = await webhook(key, body).expect(200);
    expect(again.body.outcome).toBe('duplicate');

    const after = await as(app, friend).get(`/v1/settlements/${p.id}`).expect(200);
    expect(after.body).toMatchObject({ status: 'confirmed', confirmedVia: 'sepay' });
    expect((await nets(groupId))[friend.id]).toBe(0);
  });

  it('SePay webhook: overpaying credits the payer; a cancelled payment still confirms', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(owner, account);

    const over = await pay(third, owner, groupId);
    await webhook(key, transfer(account, 200_000, over.paymentCode)).expect(200);
    expect((await nets(groupId))[third.id]).toBe(50_000);

    const cancelled = await pay(friend, owner, groupId);
    await as(app, friend).post(`/v1/settlements/${cancelled.id}/cancel`).expect(200);
    const res = await webhook(key, transfer(account, 150_000, cancelled.paymentCode)).expect(200);
    expect(res.body.outcome).toBe('matched');
    expect((await nets(groupId))[friend.id]).toBe(0);
  });

  it('SePay webhook rejects bad keys and cannot confirm someone else’s payment', async () => {
    const groupId = await trip();
    const ownerAccount = accountNo();
    await connectSepay(owner, ownerAccount);
    const p = await pay(friend, owner, groupId);

    // No key, wrong key, wrong scheme: 401 and nothing recorded.
    const body = transfer(ownerAccount, 150_000, p.paymentCode);
    await webhook(null, body).expect(401);
    await webhook('twg_not-a-real-key-at-all-000000', body).expect(401);
    await request(app.getHttpServer())
      .post('/v1/webhooks/sepay')
      .set('Authorization', 'Bearer whatever')
      .send(body)
      .expect(401);

    // Third connects their own SePay and replays owner's payment code from their account.
    const thirdAccount = accountNo();
    const thirdKey = await connectSepay(third, thirdAccount);
    const forged = await webhook(thirdKey, transfer(thirdAccount, 150_000, p.paymentCode));
    expect(forged.body.outcome).toBe('unmatched');
    // ...or claims it arrived in owner's account.
    const claimed = await webhook(thirdKey, transfer(ownerAccount, 150_000, p.paymentCode));
    expect(claimed.body.outcome).toBe('ignored');

    const still = await as(app, owner).get(`/v1/settlements/${p.id}`).expect(200);
    expect(still.body.status).toBe('pending');

    // A valid key with a malformed body is a 400, not a crash.
    await webhook(thirdKey, { id: 'x' }).expect(400);
  });

  it('turning SePay off or changing the account kills the old key', async () => {
    const account = accountNo();
    const key = await connectSepay(third, account);
    await as(app, third)
      .put('/v1/me/payment-account')
      .send({ bankBin: MB_BANK, accountNumber: accountNo(), holderName: 'Chi' })
      .expect(200);
    await webhook(key, transfer(account, 1, 'x')).expect(401);

    const key2 = await connectSepay(third, account);
    await as(app, third).delete('/v1/me/payment-account/sepay-key').expect(200);
    await webhook(key2, transfer(account, 1, 'x')).expect(401);
  });

  it('unmatched transfers land in the payee’s inbox and can be assigned', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(owner, account);

    // A transfer with no code, and one for a pending payment whose code was mistyped.
    await webhook(key, transfer(account, 150_000, 'tien villa da lat')).expect(200);
    const pending = await pay(third, owner, groupId);
    await webhook(key, transfer(account, 150_000, 'chuyen tien cho An')).expect(200);

    const inbox = await as(app, owner).get('/v1/me/unmatched-transfers').expect(200);
    expect(inbox.body).toHaveLength(2);
    const [second, first] = inbox.body as { id: string; amount: number }[];

    // Other people can't see or touch it.
    expect((await as(app, friend).get('/v1/me/unmatched-transfers').expect(200)).body).toEqual([]);
    await as(app, friend).post(`/v1/me/unmatched-transfers/${first!.id}/ignore`).expect(404);

    // Record the first as a new payment from friend.
    const assigned = await as(app, owner)
      .post(`/v1/me/unmatched-transfers/${first!.id}/assign`)
      .send({ groupId, fromUserId: friend.id })
      .expect(201);
    expect(assigned.body).toMatchObject({ status: 'confirmed', confirmedVia: 'sepay' });

    // Assign the second to third's pending payment.
    await as(app, owner)
      .post(`/v1/me/unmatched-transfers/${second!.id}/assign`)
      .send({ settlementId: pending.id })
      .expect(201);
    expect(await nets(groupId)).toEqual({ [owner.id]: 0, [friend.id]: 0, [third.id]: 0 });

    // Already sorted out.
    await as(app, owner)
      .post(`/v1/me/unmatched-transfers/${second!.id}/assign`)
      .send({ settlementId: pending.id })
      .expect(409);
    expect((await as(app, owner).get('/v1/me/unmatched-transfers').expect(200)).body).toEqual([]);
  });

  it('can’t assign a transfer to a payment owed to someone else', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(third, account);
    const notMine = await pay(friend, owner, groupId);
    await webhook(key, transfer(account, 150_000, 'no code')).expect(200);
    const [t] = (await as(app, third).get('/v1/me/unmatched-transfers').expect(200)).body;
    await as(app, third)
      .post(`/v1/me/unmatched-transfers/${t.id}/assign`)
      .send({ settlementId: notMine.id })
      .expect(404);
    await as(app, third)
      .post(`/v1/me/unmatched-transfers/${t.id}/assign`)
      .send({ groupId, fromUserId: third.id })
      .expect(400);
  });

  it('transfers over the per-payment limit never count on their own', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(owner, account);
    const p = await pay(friend, owner, groupId);
    const huge = await webhook(key, transfer(account, 10_000_000_001, p.paymentCode)).expect(200);
    expect(huge.body.outcome).toBe('unmatched');
    const [t] = (await as(app, owner).get('/v1/me/unmatched-transfers').expect(200)).body;
    await as(app, owner)
      .post(`/v1/me/unmatched-transfers/${t.id}/assign`)
      .send({ settlementId: p.id })
      .expect(400);
    await as(app, owner).post(`/v1/me/unmatched-transfers/${t.id}/ignore`).expect(204);
  });

  it('USD groups get no QR and no auto-confirm', async () => {
    const groupId = await trip('USD');
    await connectSepay(owner, accountNo());
    const p = await pay(friend, owner, groupId, 500);
    const res = await as(app, friend).get(`/v1/settlements/${p.id}`).expect(200);
    expect(res.body.autoConfirm).toBe(false);
    expect(res.body.payee.qrUrl).toBeNull();
  });

  it('the database refuses to change a confirmed payment or delete any payment', async () => {
    const groupId = await trip();
    const p = await pay(friend, owner, groupId);
    await as(app, owner).post(`/v1/settlements/${p.id}/confirm`).send({}).expect(200);
    await expect(
      prisma.settlement.update({ where: { id: p.id }, data: { paidAmount: 1n } }),
    ).rejects.toThrow(/cannot change/);
    await expect(prisma.settlement.delete({ where: { id: p.id } })).rejects.toThrow(
      /cannot be deleted/,
    );

    const q = await pay(third, owner, groupId);
    await expect(
      prisma.settlement.update({ where: { id: q.id }, data: { amount: 1n } }),
    ).rejects.toThrow(/only the status/);
    await expect(
      prisma.settlement.update({ where: { id: q.id }, data: { status: 'confirmed' } }),
    ).rejects.toThrow(/settlements_status_fields/);
  });

  it('two confirmations racing: exactly one wins', async () => {
    const groupId = await trip();
    const account = accountNo();
    const key = await connectSepay(owner, account);
    const p = await pay(friend, owner, groupId);
    const [manual, auto] = await Promise.all([
      as(app, owner).post(`/v1/settlements/${p.id}/confirm`).send({}),
      webhook(key, transfer(account, 150_000, p.paymentCode)),
    ]);
    expect(auto.status).toBe(200);
    if (manual.status === 200) {
      // Manual won; the transfer is kept for the payee to sort out.
      expect(auto.body.outcome).toBe('unmatched');
    } else {
      expect(manual.status).toBe(409);
      expect(auto.body.outcome).toBe('matched');
    }
    expect((await nets(groupId))[friend.id]).toBe(0);
  });

  it('the group currency is locked once payments exist', async () => {
    const res = await as(app, owner)
      .post('/v1/groups')
      .send({ name: 'Cash only', currency: 'VND' })
      .expect(201);
    const groupId: string = res.body.id;
    const invite = await as(app, owner)
      .post(`/v1/groups/${groupId}/invites`)
      .send({ expiresInDays: 7, maxUses: null })
      .expect(201);
    await as(app, friend).post(`/v1/invites/${invite.body.code}/accept`).expect(200);
    await pay(friend, owner, groupId, 1000);
    await as(app, owner).patch(`/v1/groups/${groupId}`).send({ currency: 'USD' }).expect(409);
  });
});
