/**
 * Bank-transfer payments and the SePay webhook, end to end against the emulators (Auth,
 * Firestore, Functions). Run with `pnpm test:payments`.
 */
import { deleteApp, initializeApp, type FirebaseApp } from "firebase/app"
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from "firebase/auth"
import {
  addDoc,
  arrayUnion,
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  serverTimestamp,
  Timestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from "firebase/firestore"
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const PROJECT = "demo-togetherwego"
const WEBHOOK = `http://127.0.0.1:5001/${PROJECT}/asia-southeast1/sepayWebhook`
const stamp = Date.now()
const apps: FirebaseApp[] = []

interface Client {
  uid: string
  db: Firestore
  call: <T = unknown>(name: string, data?: unknown) => Promise<T>
}

async function client(name: string): Promise<Client> {
  const app = initializeApp({ apiKey: "demo-key", projectId: PROJECT }, `${name}-${stamp}`)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true })
  const db = getFirestore(app)
  connectFirestoreEmulator(db, "127.0.0.1", 8085)
  const functions = getFunctions(app, "asia-southeast1")
  connectFunctionsEmulator(functions, "127.0.0.1", 5001)
  const { user } = await createUserWithEmailAndPassword(
    auth,
    `${name}${stamp}@example.test`,
    "password123",
  )
  return {
    uid: user.uid,
    db,
    call: async <T>(fn: string, data?: unknown) =>
      (await httpsCallable(functions, fn)(data)).data as T,
  }
}

function webhook(key: string, body: Record<string, unknown>) {
  return fetch(WEBHOOK, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Apikey ${key}` },
    body: JSON.stringify({
      gateway: "Vietcombank",
      transactionDate: "2026-11-26 20:00:00",
      transferType: "in",
      ...body,
    }),
  })
}

async function rejected(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as { code?: string }).code ?? "error"
  }
  throw new Error("expected a rejection")
}

let an: Client, binh: Client, mallory: Client
const groupId = `g-${stamp}`

const otherGroupId = `g2-${stamp}`

/** Each group gets its own invite code (codes are unique across groups). */
async function makeGroup(id: string, CODE: string, owner: Client, others: Client[]) {
  const batch = writeBatch(owner.db)
  const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 3_600_000)
  batch.set(doc(owner.db, "invites", CODE), { groupId: id, expiresAt })
  batch.set(doc(owner.db, "groups", id), {
    name: "Trip",
    ownerId: owner.uid,
    inviteCode: CODE,
    inviteExpiresAt: expiresAt,
    memberIds: [owner.uid],
    createdAt: serverTimestamp(),
  })
  batch.set(doc(owner.db, "groups", id, "members", owner.uid), {
    uid: owner.uid,
    name: "Owner",
    role: "owner",
    code: CODE,
    joinedAt: serverTimestamp(),
  })
  await batch.commit()
  for (const c of others) {
    const join = writeBatch(c.db)
    join.set(doc(c.db, "groups", id, "members", c.uid), {
      uid: c.uid,
      name: "Member",
      role: "member",
      code: CODE,
      joinedAt: serverTimestamp(),
    })
    join.update(doc(c.db, "groups", id), { memberIds: arrayUnion(c.uid) })
    await join.commit()
  }
}

async function addExpense(c: Client, id: string, amount: number, participants: string[]) {
  await addDoc(collection(c.db, "groups", id, "expenses"), {
    description: "Homestay",
    amount,
    paidBy: c.uid,
    participants,
    spentOn: "2026-11-20",
    createdBy: c.uid,
    createdAt: serverTimestamp(),
  })
}

beforeAll(async () => {
  ;[an, binh, mallory] = await Promise.all([client("an"), client("binh"), client("mallory")])
  // Bình owes An 500k here. Mallory got hold of the invite link and joined too.
  await makeGroup(groupId, "PAYTESTA", an, [binh, mallory])
  await addExpense(an, groupId, 1_000_000, [an.uid, binh.uid])
  // And An owes Bình 50k in another group.
  await makeGroup(otherGroupId, "PAYTESTB", binh, [an])
  await addExpense(binh, otherGroupId, 100_000, [an.uid, binh.uid])
}, 60_000)

afterAll(async () => {
  await Promise.all(apps.map((a) => deleteApp(a)))
})

/** Waits (up to 15 s) for the server's recount to say what `check` wants. */
async function balancesOf(c: Client, id: string, check: (d: Record<string, unknown>) => boolean) {
  const until = Date.now() + 15_000
  for (;;) {
    const d = (await getDoc(doc(c.db, "groups", id, "summary", "balances"))).data()
    if (d && check(d)) return d
    if (Date.now() > until) throw new Error(`balances never matched: ${JSON.stringify(d)}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

describe("running balances", () => {
  it("are counted by the server when money changes, and only it writes them", async () => {
    const id = `g3-${stamp}`
    await makeGroup(id, "PAYTESTC", an, [binh])
    await addExpense(an, id, 300_000, [an.uid, binh.uid])
    let d = await balancesOf(an, id, (d) => d.expenseCount === 1)
    expect(d.net).toEqual({ [an.uid]: 150_000, [binh.uid]: -150_000 })
    expect(d.spent).toEqual({ [an.uid]: 150_000, [binh.uid]: 150_000 })

    // Bình records what An paid for him; then pays An back in cash.
    await addDoc(collection(binh.db, "groups", id, "expenses"), {
      description: "Taxi",
      amount: 100_000,
      paidBy: an.uid,
      participants: [binh.uid],
      spentOn: "2026-11-21",
      createdBy: binh.uid,
      createdAt: serverTimestamp(),
    })
    await addDoc(collection(an.db, "groups", id, "payments"), {
      from: binh.uid,
      to: an.uid,
      amount: 250_000,
      note: "",
      createdBy: an.uid,
      createdAt: serverTimestamp(),
    })
    d = await balancesOf(an, id, (d) => d.expenseCount === 2 && d.paymentCount === 1)
    expect(d.net).toEqual({})

    // A member can't write them, and a group without them gets them on request.
    expect(
      await rejected(setDoc(doc(an.db, "groups", id, "summary", "balances"), { net: {} })),
    ).toBe("permission-denied")
    expect(
      await rejected(mallory.call("refreshBalances", { groupId: id })),
    ).toBe("functions/permission-denied")
    await binh.call("refreshBalances", { groupId: id })
  })
})

describe("bank accounts", () => {
  it("validates and saves your bank account, readable only by you", async () => {
    expect(
      await rejected(
        an.call("savePaymentAccount", { bankBin: "000000", accountNumber: "1", holderName: "x" }),
      ),
    ).toBe("functions/invalid-argument")
    await an.call("savePaymentAccount", {
      bankBin: "970436",
      accountNumber: "0123456789",
      holderName: "Nguyen Van An",
    })
    const mine = await getDoc(doc(an.db, "paymentAccounts", an.uid))
    expect(mine.data()?.holderName).toBe("NGUYEN VAN AN")
    expect(await rejected(getDoc(doc(binh.db, "paymentAccounts", an.uid)))).toBe(
      "permission-denied",
    )
    expect(
      await rejected(setDoc(doc(an.db, "paymentAccounts", an.uid), { accountNumber: "666" })),
    ).toBe("permission-denied")
  })
})

describe("paying by bank transfer with SePay", () => {
  let key = ""
  let settlementId = ""
  let code = ""

  it("starts a payment only for money you owe, so bank details can't be harvested", async () => {
    // An doesn't owe Bình here, and Mallory (who only joined) owes nobody.
    expect(
      await rejected(an.call("startSettlement", { groupId, to: binh.uid, amount: 100000 })),
    ).toBe("functions/failed-precondition")
    expect(
      await rejected(mallory.call("startSettlement", { groupId, to: an.uid, amount: 1000 })),
    ).toBe("functions/failed-precondition")
    // Bình owes An 500k, not more.
    expect(
      await rejected(binh.call("startSettlement", { groupId, to: an.uid, amount: 500001 })),
    ).toBe("functions/invalid-argument")
    expect(
      await rejected(
        binh.call("startSettlement", { groupId: otherGroupId, to: mallory.uid, amount: 1 }),
      ),
    ).toBe("functions/permission-denied")

    settlementId = (
      await binh.call<{ settlementId: string }>("startSettlement", {
        groupId,
        to: an.uid,
        amount: 150000,
      })
    ).settlementId
    const s = (await getDoc(doc(binh.db, "groups", groupId, "settlements", settlementId))).data()
    expect(s?.status).toBe("pending")
    code = s?.code
    expect(code).toMatch(/^TWG[A-Z2-9]{8}$/)
    // Asking again shows the same payment instead of piling up new ones.
    const again = await binh.call<{ settlementId: string }>("startSettlement", {
      groupId,
      to: an.uid,
      amount: 150000,
    })
    expect(again.settlementId).toBe(settlementId)
  })

  it("shows the bank details to payer and payee only", async () => {
    const path = ["groups", groupId, "settlements", settlementId, "private", "bank"] as const
    expect((await getDoc(doc(binh.db, ...path))).data()?.accountNumber).toBe("0123456789")
    expect((await getDoc(doc(an.db, ...path))).exists()).toBe(true)
    expect(await rejected(getDoc(doc(mallory.db, ...path)))).toBe("permission-denied")
  })

  it("won't let the payer confirm their own payment", async () => {
    expect(
      await rejected(
        updateDoc(doc(binh.db, "groups", groupId, "settlements", settlementId), {
          status: "confirmed",
          via: "payee",
          paidAmount: 150000,
          confirmedAt: serverTimestamp(),
        }),
      ),
    ).toBe("permission-denied")
  })

  it("rejects webhooks without a valid key", async () => {
    expect(
      (
        await webhook("twg_not-a-real-key-0123456789", {
          id: 1,
          accountNumber: "0123456789",
          content: code,
          transferAmount: 150000,
        })
      ).status,
    ).toBe(401)
    key = (await an.call<{ apiKey: string }>("createSepayKey")).apiKey
    expect(key).toMatch(/^twg_/)
    const stored = (await getDoc(doc(an.db, "paymentAccounts", an.uid))).data()
    expect(stored?.sepay.keyHash).not.toContain(key)
    expect(stored?.sepay.keyHint).toBe(key.slice(-4))
  })

  it("ignores money for another account, and keeps transfers without a code", async () => {
    const other = await webhook(key, {
      id: 100,
      accountNumber: "999999",
      content: code,
      transferAmount: 150000,
    })
    expect(await other.json()).toMatchObject({ outcome: "ignored" })
    const noCode = await webhook(key, {
      id: 101,
      accountNumber: "0123456789",
      content: "tien an trua",
      transferAmount: 50000,
    })
    expect(await noCode.json()).toMatchObject({ outcome: "unmatched" })
  })

  it("answers SePay's test and odd payloads with 200, ignoring what isn't a real transfer", async () => {
    // Like SePay's "Gửi thử": nulls, numbers as text, no real transfer id.
    const test = await webhook(key, {
      id: 0,
      gateway: null,
      transactionDate: null,
      accountNumber: 123456789,
      content: null,
      transferAmount: "0",
      code: null,
    })
    expect(test.status).toBe(200)
    expect(await test.json()).toMatchObject({ outcome: "ignored" })
    // Numbers sent as text still count.
    const asText = await webhook(key, {
      id: "9103",
      accountNumber: "0123456789",
      content: "tien nha",
      transferAmount: "40000",
    })
    expect(await asText.json()).toMatchObject({ outcome: "unmatched" })
    // Garbage is still refused.
    expect((await webhook(key, { id: "abc", transferAmount: "lots" })).status).toBe(400)
  })

  it("confirms the payment when the money arrives, once", async () => {
    const body = {
      id: 102,
      accountNumber: "0123456789",
      content: `MBVCB.123 ${code.toLowerCase()} chuyen tien`,
      transferAmount: 150000,
    }
    expect(await (await webhook(key, body)).json()).toMatchObject({ outcome: "matched" })
    expect(await (await webhook(key, body)).json()).toMatchObject({ outcome: "duplicate" })
    const s = (await getDoc(doc(binh.db, "groups", groupId, "settlements", settlementId))).data()
    expect(s).toMatchObject({ status: "confirmed", via: "sepay", paidAmount: 150000 })
    const transfer = await getDoc(doc(an.db, "sepayTransfers", `${an.uid}_102`))
    expect(transfer.data()?.status).toBe("matched")
    expect(await rejected(getDoc(doc(binh.db, "sepayTransfers", `${an.uid}_102`)))).toBe(
      "permission-denied",
    )
  })

  it("can't use one person's key to confirm a payment owed to someone else", async () => {
    await binh.call("savePaymentAccount", {
      bankBin: "970422",
      accountNumber: "5555555555",
      holderName: "Tran Binh",
    })
    const toBinh = (
      await an.call<{ settlementId: string }>("startSettlement", {
        groupId: otherGroupId,
        to: binh.uid,
        amount: 20000,
      })
    ).settlementId
    const binhCode = (
      await getDoc(doc(an.db, "groups", otherGroupId, "settlements", toBinh))
    ).data()?.code
    // An's key, An's account, but Bình's code: not An's to confirm.
    const res = await webhook(key, {
      id: 103,
      accountNumber: "0123456789",
      content: binhCode,
      transferAmount: 20000,
    })
    expect(await res.json()).toMatchObject({ outcome: "unmatched" })
    const s = (await getDoc(doc(an.db, "groups", otherGroupId, "settlements", toBinh))).data()
    expect(s?.status).toBe("pending")
  })

  it("lets the payee confirm by hand, and either side cancel", async () => {
    const id = (
      await binh.call<{ settlementId: string }>("startSettlement", {
        groupId,
        to: an.uid,
        amount: 30000,
      })
    ).settlementId
    const ref = (db: Firestore) => doc(db, "groups", groupId, "settlements", id)
    await updateDoc(ref(an.db), {
      status: "confirmed",
      via: "payee",
      paidAmount: 30000,
      confirmedAt: serverTimestamp(),
    })
    expect(await rejected(updateDoc(ref(binh.db), { status: "cancelled" }))).toBe(
      "permission-denied",
    )
    const id2 = (
      await binh.call<{ settlementId: string }>("startSettlement", {
        groupId,
        to: an.uid,
        amount: 40000,
      })
    ).settlementId
    await updateDoc(doc(binh.db, "groups", groupId, "settlements", id2), { status: "cancelled" })
  })

  it("turns SePay off when you move to another bank account", async () => {
    const r = await an.call<{ sepayTurnedOff: boolean }>("savePaymentAccount", {
      bankBin: "970436",
      accountNumber: "1111111111",
      holderName: "Nguyen Van An",
    })
    expect(r.sepayTurnedOff).toBe(true)
    const res = await webhook(key, {
      id: 104,
      accountNumber: "1111111111",
      content: "x",
      transferAmount: 1000,
    })
    expect(res.status).toBe(401)
  })
})
