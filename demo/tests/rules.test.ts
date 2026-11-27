/**
 * Firestore security rules tests. Run with `pnpm test:rules`, which starts the Firestore
 * emulator, runs this file and stops it again.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  arrayRemove,
  arrayUnion,
  type Firestore,
} from "firebase/firestore"
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

const CODE = "K7P3QX9M"
const NEW_CODE = "Z8R4WT2N"
let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-togetherwego",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  })
})

afterAll(() => env?.cleanup())

beforeEach(() => env.clearFirestore())

/** When a new invite link runs out: the app's default, 24 hours from now. */
const soon = (hours = 24) => Timestamp.fromMillis(Date.now() + hours * 3_600_000)

const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore

/** Joining as the app does: your member document plus your place in memberIds. */
function join(
  uid: string,
  code: string,
  opts: { memberId?: string; role?: string; addId?: string } = {},
) {
  const db = as(uid)
  const batch = writeBatch(db)
  batch.set(doc(db, `groups/g1/members/${opts.memberId ?? uid}`), {
    uid: opts.memberId ?? uid,
    name: "Someone",
    role: opts.role ?? "member",
    code,
    joinedAt: serverTimestamp(),
  })
  batch.update(doc(db, "groups/g1"), { memberIds: arrayUnion(opts.addId ?? uid) })
  return batch.commit()
}

/** Owner "an" creates group g1; "binh" joins with the code; "mallory" is not a member. */
async function seed() {
  const db = as("an")
  const batch = writeBatch(db)
  const expiresAt = soon()
  batch.set(doc(db, `invites/${CODE}`), { groupId: "g1", expiresAt })
  batch.set(doc(db, "groups/g1"), {
    name: "Đà Lạt trip",
    ownerId: "an",
    inviteCode: CODE,
    inviteExpiresAt: expiresAt,
    memberIds: ["an"],
    createdAt: serverTimestamp(),
  })
  batch.set(doc(db, "groups/g1/members/an"), {
    uid: "an",
    name: "An",
    role: "owner",
    code: CODE,
    joinedAt: serverTimestamp(),
  })
  await batch.commit()
  await join("binh", CODE)
}

const expense = (uid: string, extra: Record<string, unknown> = {}) => ({
  description: "Lẩu",
  amount: 300000,
  paidBy: uid,
  participants: ["an", "binh"],
  spentOn: "2026-11-20",
  createdBy: uid,
  createdAt: serverTimestamp(),
  ...extra,
})

describe("groups and membership", () => {
  it("creates a group only together with the owner's membership", async () => {
    const db = as("an")
    const lonely = writeBatch(db)
    const expiresAt = soon()
    lonely.set(doc(db, `invites/${CODE}`), { groupId: "lonely", expiresAt })
    lonely.set(doc(db, "groups/lonely"), {
      name: "No members",
      ownerId: "an",
      inviteCode: CODE,
      inviteExpiresAt: expiresAt,
      memberIds: ["an"],
      createdAt: serverTimestamp(),
    })
    await assertFails(lonely.commit())
    await assertFails(
      setDoc(doc(db, "groups/lonely"), {
        name: "No members",
        ownerId: "an",
        inviteCode: CODE,
        memberIds: ["an"],
        createdAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(seed())
  })

  it("won't let you create a group owned by someone else", async () => {
    const db = as("mallory")
    const batch = writeBatch(db)
    batch.set(doc(db, "groups/fake"), {
      name: "Fake",
      ownerId: "an",
      inviteCode: CODE,
      memberIds: ["mallory"],
      createdAt: serverTimestamp(),
    })
    batch.set(doc(db, "groups/fake/members/mallory"), {
      uid: "mallory",
      name: "M",
      role: "owner",
      code: CODE,
      joinedAt: serverTimestamp(),
    })
    await assertFails(batch.commit())
  })

  it("hides a group and everything in it from non-members and visitors", async () => {
    await seed()
    await assertFails(getDoc(doc(as("mallory"), "groups/g1")))
    await assertFails(getDocs(collection(as("mallory"), "groups/g1/members")))
    await assertFails(getDocs(collection(as("mallory"), "groups/g1/expenses")))
    await assertFails(getDoc(doc(anon(), "groups/g1")))
    await assertSucceeds(getDoc(doc(as("binh"), "groups/g1")))
  })

  it("joins only with the right invite code, and only as yourself", async () => {
    await seed()
    await assertFails(join("chi", "wrong-code-0123456789"))
    await assertFails(join("chi", CODE, { memberId: "dung", addId: "dung" }))
    await assertFails(join("chi", CODE, { role: "owner" }))
    // memberIds and the member documents can't drift apart.
    await assertFails(join("chi", CODE, { addId: "ghost" }))
    await assertFails(
      setDoc(doc(as("chi"), "groups/g1/members/chi"), {
        uid: "chi",
        name: "Chi",
        role: "member",
        code: CODE,
        joinedAt: serverTimestamp(),
      }),
    )
    await assertFails(updateDoc(doc(as("chi"), "groups/g1"), { memberIds: arrayUnion("chi") }))
    await assertSucceeds(join("chi", CODE))
    await assertFails(updateDoc(doc(as("binh"), "groups/g1"), { memberIds: ["binh"] }))
  })

  it("stops old links working once the owner replaces the code", async () => {
    await seed()
    const replace = (uid: string, code: string, opts: { keepOld?: boolean } = {}) => {
      const db = as(uid)
      const batch = writeBatch(db)
      const expiresAt = soon()
      batch.set(doc(db, `invites/${code}`), { groupId: "g1", expiresAt })
      if (!opts.keepOld) batch.delete(doc(db, `invites/${CODE}`))
      batch.update(doc(db, "groups/g1"), { inviteCode: code, inviteExpiresAt: expiresAt })
      return batch.commit()
    }
    await assertFails(replace("binh", NEW_CODE))
    // A code must look like one, and come with its invite.
    await assertFails(replace("an", "not-a-code-0123"))
    await assertFails(updateDoc(doc(as("an"), "groups/g1"), { inviteCode: NEW_CODE }))
    await assertFails(updateDoc(doc(as("an"), "groups/g1"), { ownerId: "binh" }))
    await assertSucceeds(replace("an", NEW_CODE))
    // The old code no longer leads anywhere.
    expect((await getDoc(doc(as("chi"), `invites/${CODE}`))).exists()).toBe(false)
    await assertFails(join("chi", CODE))
    await assertSucceeds(join("chi", NEW_CODE))
  })

  it("finds a group by its code for anyone signed in, but never lists codes", async () => {
    await seed()
    const found = await assertSucceeds(getDoc(doc(as("chi"), `invites/${CODE}`)))
    expect(found.data()?.groupId).toBe("g1")
    await assertFails(getDoc(doc(anon(), `invites/${CODE}`)))
    await assertFails(getDocs(collection(as("chi"), "invites")))
    // Nobody can point a code at someone else's group, or take over one in use.
    await assertFails(setDoc(doc(as("mallory"), `invites/${NEW_CODE}`), { groupId: "g1" }))
    await assertFails(setDoc(doc(as("an"), `invites/${CODE}`), { groupId: "elsewhere" }))
    await assertFails(deleteDoc(doc(as("an"), `invites/${CODE}`)))
  })

  it("lets only the owner remove a member, who then loses access and can't rejoin", async () => {
    await seed()
    await join("chi", CODE)
    const remove = (by: string, who: string, opts: { keepDoc?: boolean; code?: string } = {}) => {
      const db = as(by)
      const batch = writeBatch(db)
      if (!opts.keepDoc) batch.delete(doc(db, `groups/g1/members/${who}`))
      const code = opts.code ?? NEW_CODE
      const expiresAt = soon()
      if (code !== CODE) batch.set(doc(db, `invites/${code}`), { groupId: "g1", expiresAt })
      batch.update(doc(db, "groups/g1"), {
        memberIds: arrayRemove(who),
        inviteCode: code,
        inviteExpiresAt: expiresAt,
      })
      return batch.commit()
    }
    // Not by another member, not the owner themselves, not half done, not keeping the old link.
    await assertFails(remove("binh", "chi"))
    await assertFails(remove("an", "an"))
    await assertFails(remove("an", "chi", { keepDoc: true }))
    await assertFails(remove("an", "chi", { code: CODE }))
    await assertFails(deleteDoc(doc(as("an"), "groups/g1/members/chi")))
    await assertFails(
      updateDoc(doc(as("an"), "groups/g1"), {
        memberIds: ["an"],
        inviteCode: NEW_CODE,
      }),
    )
    await assertSucceeds(remove("an", "chi"))
    await assertFails(getDoc(doc(as("chi"), "groups/g1")))
    await assertFails(getDocs(collection(as("chi"), "groups/g1/expenses")))
    await assertFails(join("chi", CODE))
    await assertSucceeds(getDoc(doc(as("binh"), "groups/g1")))
  })

  it("lists only your own memberships across groups", async () => {
    await seed()
    await assertSucceeds(
      getDocs(query(collectionGroup(as("binh"), "members"), where("uid", "==", "binh"))),
    )
    await assertFails(
      getDocs(query(collectionGroup(as("mallory"), "members"), where("uid", "==", "an"))),
    )
    await assertSucceeds(getDoc(doc(as("mallory"), "groups/g1/members/mallory")))
  })
})

describe("invite links expire", () => {
  /** The owner makes a new link (NEW_CODE) that runs out at the given time. */
  const renew = (expiresAt: unknown, inviteExpiresAt: unknown = expiresAt) => {
    const db = as("an")
    const batch = writeBatch(db)
    batch.set(doc(db, `invites/${NEW_CODE}`), { groupId: "g1", expiresAt })
    batch.delete(doc(db, `invites/${CODE}`))
    batch.update(doc(db, "groups/g1"), { inviteCode: NEW_CODE, inviteExpiresAt })
    return batch.commit()
  }

  it("lets nobody join once the link has run out, until the owner makes a new one", async () => {
    await seed()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "groups/g1"), {
        inviteExpiresAt: Timestamp.fromMillis(Date.now() - 1000),
      })
    })
    await assertFails(join("chi", CODE))
    await assertSucceeds(renew(soon()))
    await assertSucceeds(join("chi", NEW_CODE))
  })

  it("gives every new link an expiry within a week, matching its invite", async () => {
    await seed()
    await assertFails(renew(null))
    await assertFails(renew(Timestamp.fromMillis(Date.now() - 60_000)))
    await assertFails(renew(soon(24 * 30)))
    await assertFails(renew(soon(), soon(48)))
    // The current link can't be stretched: a longer life means a new link.
    await assertFails(updateDoc(doc(as("an"), "groups/g1"), { inviteExpiresAt: soon(48) }))
    await assertSucceeds(renew(soon(24 * 7)))
  })

  it("keeps links from before expiry working", async () => {
    await seed()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "groups/g1"), { inviteExpiresAt: deleteField() })
    })
    await assertSucceeds(join("chi", CODE))
  })
})

describe("profiles", () => {
  const avatar = (uid: string, host = "http://127.0.0.1:9199") =>
    `${host}/v0/b/demo-togetherwego.appspot.com/o/avatars%2F${uid}%2Favatar-k3x9.jpg?alt=media&token=1a2b3c4d-5e6f`
  const profile = (extra: Record<string, unknown> = {}) => ({
    name: "Bình",
    photo: avatar("binh"),
    updatedAt: serverTimestamp(),
    ...extra,
  })

  it("keeps your profile to yourself", async () => {
    await assertSucceeds(setDoc(doc(as("binh"), "users/binh"), profile({ altName: "Bé Bi" })))
    await assertSucceeds(getDoc(doc(as("binh"), "users/binh")))
    await assertFails(getDoc(doc(as("an"), "users/binh")))
    await assertFails(setDoc(doc(as("an"), "users/binh"), profile()))
  })

  it("takes sensible names, and only a photo you uploaded yourself", async () => {
    const db = as("binh")
    const mine = doc(db, "users/binh")
    await assertFails(setDoc(mine, profile({ name: "" })))
    await assertFails(setDoc(mine, { name: "Bình", updatedAt: serverTimestamp() }))
    await assertFails(setDoc(mine, profile({ altName: "x".repeat(41) })))
    await assertFails(setDoc(mine, profile({ role: "owner" })))
    await assertFails(setDoc(mine, profile({ photo: "https://evil.example/p.jpg" })))
    await assertFails(setDoc(mine, profile({ photo: avatar("an") })))
    await assertSucceeds(setDoc(mine, profile({ photo: avatar("binh") })))
    await assertSucceeds(
      setDoc(mine, profile({ photo: avatar("binh", "https://firebasestorage.googleapis.com") })),
    )
  })

  it("lets you change how you appear in a group, and nothing else", async () => {
    await seed()
    const mine = doc(as("binh"), "groups/g1/members/binh")
    await assertSucceeds(
      updateDoc(mine, { name: "Bình Lê", altName: "Bé Bi", photo: avatar("binh") }),
    )
    await assertSucceeds(updateDoc(mine, { altName: deleteField(), photo: deleteField() }))
    await assertFails(updateDoc(mine, { role: "owner" }))
    await assertFails(updateDoc(mine, { name: "" }))
    await assertFails(updateDoc(mine, { photo: avatar("an") }))
    await assertFails(updateDoc(doc(as("binh"), "groups/g1/members/an"), { name: "Not An" }))
  })
})

describe("expenses and payments", () => {
  it("lets members add valid expenses as themselves", async () => {
    await seed()
    await assertSucceeds(addDoc(collection(as("binh"), "groups/g1/expenses"), expense("binh")))
    await assertSucceeds(
      addDoc(
        collection(as("binh"), "groups/g1/expenses"),
        expense("binh", { photos: ["photo-1.jpg", "photo-2.jpg"], reference: "Bill no. 0123" }),
      ),
    )
  })

  it("rejects bad expenses", async () => {
    await seed()
    const add = (data: Record<string, unknown>, uid = "binh") =>
      addDoc(collection(as(uid), "groups/g1/expenses"), data)
    await assertFails(add(expense("binh"), "mallory"))
    await assertFails(add(expense("binh", { createdBy: "an" })))
    await assertFails(add(expense("binh", { amount: 0 })))
    await assertFails(add(expense("binh", { amount: 12.5 })))
    await assertFails(add(expense("binh", { amount: "300000" })))
    // The payer can be anyone in the group, but not an outsider.
    await assertFails(add(expense("binh", { paidBy: "mallory" })))
    await assertFails(add(expense("binh", { paidBy: "ghost" })))
    await assertSucceeds(add(expense("binh", { paidBy: "an" })))
    await assertFails(add(expense("binh", { participants: [] })))
    await assertFails(add(expense("binh", { participants: ["an", "an"] })))
    // Everyone in the split must be in the group.
    await assertFails(add(expense("binh", { participants: ["an", "binh", "ghost"] })))
    await assertFails(add(expense("binh", { participants: ["mallory"] })))
    await assertFails(add(expense("binh", { spentOn: "yesterday" })))
    // Uneven splits: one positive whole weight per participant, with a known kind.
    await assertSucceeds(add(expense("binh", { split: "shares", weights: [3, 2] })))
    await assertSucceeds(add(expense("binh", { split: "amounts", weights: [100000, 200000] })))
    await assertFails(add(expense("binh", { split: "shares" })))
    await assertFails(add(expense("binh", { weights: [1, 2] })))
    await assertFails(add(expense("binh", { split: "percent", weights: [1, 2] })))
    await assertFails(add(expense("binh", { split: "shares", weights: [1] })))
    await assertFails(add(expense("binh", { split: "shares", weights: [1, 2, 3] })))
    // A negative or zero weight would push a debt onto someone else.
    await assertFails(add(expense("binh", { split: "amounts", weights: [400000, -100000] })))
    await assertFails(add(expense("binh", { split: "shares", weights: [0, 2] })))
    await assertFails(add(expense("binh", { split: "shares", weights: [1.5, 2] })))
    await assertFails(add(expense("binh", { split: "shares", weights: "1,2" })))
    await assertFails(add(expense("binh", { createdAt: Timestamp.fromMillis(0) })))
    await assertFails(add(expense("binh", { isAdmin: true })))
    // Photos: at most 4, named as Storage allows. A reference is short text.
    const five = ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"]
    await assertFails(add(expense("binh", { photos: five })))
    await assertFails(add(expense("binh", { photos: ["../x.jpg"] })))
    await assertFails(add(expense("binh", { photos: ["ok.jpg", "evil.exe"] })))
    await assertFails(add(expense("binh", { photos: "photo-1.jpg" })))
    await assertFails(add(expense("binh", { reference: "" })))
    await assertFails(add(expense("binh", { reference: "x".repeat(301) })))
  })

  it("lets only the creator or the payer delete an expense, and nobody edit one", async () => {
    await seed()
    const ref = await addDoc(collection(as("binh"), "groups/g1/expenses"), expense("binh"))
    await assertFails(updateDoc(doc(as("binh"), ref.path), { amount: 1 }))
    await assertFails(deleteDoc(doc(as("an"), ref.path)))
    await assertSucceeds(deleteDoc(doc(as("binh"), ref.path)))
    // Added by Binh, saying An paid: either of them can delete it.
    const forAn = await addDoc(
      collection(as("binh"), "groups/g1/expenses"),
      expense("binh", { paidBy: "an" }),
    )
    await assertFails(deleteDoc(doc(as("mallory"), forAn.path)))
    await assertSucceeds(deleteDoc(doc(as("an"), forAn.path)))
  })

  it("lets the creator or the payer fix an expense, keeping who added it and its photos", async () => {
    await seed()
    const ref = await addDoc(
      collection(as("binh"), "groups/g1/expenses"),
      expense("binh", { paidBy: "an", photos: ["photo-1.jpg"] }),
    )
    const fix = (uid: string, extra: Record<string, unknown> = {}) =>
      updateDoc(doc(as(uid), ref.path), {
        amount: 360000,
        editedAt: serverTimestamp(),
        editedBy: uid,
        ...extra,
      })
    // Binh added it, An is the payer: both can fix it. Nobody else.
    await assertSucceeds(fix("binh"))
    await assertSucceeds(fix("an", { split: "shares", weights: [2, 4] }))
    await assertSucceeds(fix("an", { split: deleteField(), weights: deleteField() }))
    await assertFails(fix("mallory"))
    // The same checks as a new expense.
    await assertFails(fix("binh", { amount: -1 }))
    await assertFails(fix("binh", { participants: ["an", "ghost"] }))
    await assertFails(fix("binh", { paidBy: "mallory" }))
    // Saying who edited it and when, truthfully.
    await assertFails(fix("binh", { editedBy: "an" }))
    await assertFails(updateDoc(doc(as("binh"), ref.path), { amount: 1000 }))
    // Who added it, when, and its photos stay.
    await assertFails(fix("binh", { createdBy: "an" }))
    await assertFails(fix("binh", { createdAt: serverTimestamp() }))
    await assertFails(fix("binh", { photos: ["photo-2.jpg"] }))
    await assertFails(fix("binh", { photos: deleteField() }))
    // A new expense can't pretend to have been edited.
    await assertFails(
      addDoc(
        collection(as("binh"), "groups/g1/expenses"),
        expense("binh", { editedAt: serverTimestamp(), editedBy: "binh" }),
      ),
    )
  })

  it("lets members read the stored balances, and nobody write them", async () => {
    await seed()
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "groups/g1/summary/balances"), { net: { an: 1 } })
    })
    await assertSucceeds(getDoc(doc(as("binh"), "groups/g1/summary/balances")))
    await assertFails(getDoc(doc(as("mallory"), "groups/g1/summary/balances")))
    await assertFails(setDoc(doc(as("an"), "groups/g1/summary/balances"), { net: { an: 9 } }))
    await assertFails(setDoc(doc(as("an"), "groups/g1/summary/activity"), { by: "an" }))
  })

  it("finds your own entries across groups, and only yours", async () => {
    await seed()
    await addDoc(collection(as("an"), "groups/g1/expenses"), expense("an", { participants: ["an"] }))
    await addDoc(collection(as("an"), "groups/g1/expenses"), expense("an"))
    const mine = (uid: string, field: string, op: "==" | "array-contains", value: string) =>
      getDocs(query(collectionGroup(as(uid), "expenses"), where(field, op, value)))
    // Bình is in one of them.
    expect((await assertSucceeds(mine("binh", "participants", "array-contains", "binh"))).size).toBe(1)
    expect((await assertSucceeds(mine("an", "paidBy", "==", "an"))).size).toBe(2)
    // Asking for someone else's is refused, as is everything at once.
    await assertFails(mine("mallory", "participants", "array-contains", "binh"))
    await assertFails(mine("mallory", "paidBy", "==", "an"))
    await assertFails(getDocs(collectionGroup(as("binh"), "expenses")))
    await assertFails(
      getDocs(query(collectionGroup(as("mallory"), "payments"), where("to", "==", "an"))),
    )
    await assertSucceeds(
      getDocs(query(collectionGroup(as("an"), "payments"), where("to", "==", "an"))),
    )
    await assertSucceeds(
      getDocs(query(collectionGroup(as("an"), "settlements"), where("from", "==", "an"))),
    )
  })

  it("records a cash payment only by the person who was paid", async () => {
    await seed()
    const pay = (uid: string, from: string, to: string, amount: unknown = 150000) =>
      addDoc(collection(as(uid), "groups/g1/payments"), {
        from,
        to,
        amount,
        note: "",
        createdBy: uid,
        createdAt: serverTimestamp(),
      })
    await assertSucceeds(pay("an", "binh", "an"))
    // The payer can't mark their own debt as paid (or invent one the other way).
    await assertFails(pay("binh", "binh", "an"))
    await assertFails(pay("binh", "binh", "an", 5_000_000))
    await assertFails(pay("an", "an", "an"))
    await assertFails(pay("an", "mallory", "an"))
    await assertFails(pay("an", "binh", "an", -5))
    await assertFails(pay("mallory", "binh", "mallory"))
  })
})

describe("events and RSVPs", () => {
  async function seedEvent() {
    await seed()
    await setDoc(doc(as("an"), "groups/g1/events/e1"), {
      title: "Karaoke",
      startsAt: Timestamp.fromDate(new Date("2026-12-05T19:00:00+07:00")),
      location: "",
      createdBy: "an",
      createdAt: serverTimestamp(),
    })
  }
  const rsvp = (status: string) => ({ status, name: "Bình", updatedAt: serverTimestamp() })

  it("links an expense to one of the group's own plans, or none", async () => {
    await seedEvent()
    const add = (extra: Record<string, unknown>) =>
      addDoc(collection(as("binh"), "groups/g1/expenses"), expense("binh", extra))
    await assertSucceeds(add({ eventId: "e1" }))
    await assertSucceeds(add({}))
    await assertFails(add({ eventId: "nope" }))
    await assertFails(add({ eventId: 1 }))
    // A plan in another group can't be named either.
    await assertFails(add({ eventId: "../../g2/events/e1" }))
  })

  it("lets only the creator change or delete an event", async () => {
    await seedEvent()
    await assertFails(updateDoc(doc(as("binh"), "groups/g1/events/e1"), { title: "Mine now" }))
    await assertFails(updateDoc(doc(as("an"), "groups/g1/events/e1"), { createdBy: "binh" }))
    await assertSucceeds(
      updateDoc(doc(as("an"), "groups/g1/events/e1"), { title: "Karaoke night" }),
    )
  })

  it("takes your own RSVP only", async () => {
    await seedEvent()
    await assertSucceeds(setDoc(doc(as("binh"), "groups/g1/events/e1/rsvps/binh"), rsvp("going")))
    await assertSucceeds(setDoc(doc(as("binh"), "groups/g1/events/e1/rsvps/binh"), rsvp("no")))
    await assertFails(setDoc(doc(as("binh"), "groups/g1/events/e1/rsvps/an"), rsvp("no")))
    await assertFails(setDoc(doc(as("binh"), "groups/g1/events/e1/rsvps/binh"), rsvp("yes!!")))
    await assertFails(setDoc(doc(as("binh"), "groups/g1/events/nope/rsvps/binh"), rsvp("going")))
    await assertFails(
      setDoc(doc(as("mallory"), "groups/g1/events/e1/rsvps/mallory"), rsvp("going")),
    )
  })
})
