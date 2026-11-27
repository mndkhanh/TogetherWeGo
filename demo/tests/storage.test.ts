/**
 * Storage rules for expense photos. Run with `pnpm test:rules`, which starts the Firestore and
 * Storage emulators (the Storage rules read Firestore to check membership).
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing"
import { doc, setDoc } from "firebase/firestore"
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage"
import { readFileSync } from "node:fs"
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest"

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-togetherwego",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
    storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
  })
})

afterAll(() => env?.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.clearStorage()
  // Group g1 with An and Bình; Mallory isn't in it.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const uid of ["an", "binh"]) {
      await setDoc(doc(db, `groups/g1/members/${uid}`), { uid, name: uid, role: "member" })
    }
  })
})

const storage = (uid: string) => env.authenticatedContext(uid).storage()
const photo = (uid: string, expenseId = "e1", name = "photo-1.jpg") =>
  ref(storage(uid), `groups/g1/expenses/${expenseId}/${name}`)
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const upload = (uid: string, opts: { name?: string; type?: string; bytes?: Uint8Array } = {}) =>
  uploadBytes(photo(uid, "e1", opts.name), opts.bytes ?? jpeg, {
    contentType: opts.type ?? "image/jpeg",
  })

async function saveExpense(createdBy: string, paidBy = createdBy) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "groups/g1/expenses/e1"), {
      createdBy,
      paidBy,
      photos: ["photo-1.jpg"],
    })
  })
}

describe("expense photos", () => {
  it("lets members add a photo before the expense is saved, and only they can see it", async () => {
    await assertSucceeds(upload("binh"))
    await assertSucceeds(getBytes(photo("an")))
    await assertFails(getBytes(photo("mallory")))
    await assertFails(
      getBytes(ref(env.unauthenticatedContext().storage(), "groups/g1/expenses/e1/photo-1.jpg")),
    )
  })

  it("takes small images only, with sensible names", async () => {
    await assertFails(upload("mallory"))
    await assertFails(upload("binh", { type: "application/pdf" }))
    await assertFails(upload("binh", { type: "image/svg+xml", name: "photo-1.png" }))
    await assertFails(upload("binh", { name: "../../evil.jpg" }))
    await assertFails(upload("binh", { name: "photo.exe" }))
    await assertFails(upload("binh", { bytes: new Uint8Array(3 * 1024 * 1024 + 1) }))
  })

  it("can't add or swap photos once the expense is saved; its creator removes them", async () => {
    await upload("binh")
    await saveExpense("binh")
    await assertFails(upload("binh", { name: "photo-2.jpg" }))
    await assertFails(upload("binh"))
    await assertFails(deleteObject(photo("an")))
    await assertSucceeds(deleteObject(photo("binh")))
  })

  it("lets the payer remove the photos of an expense someone else added for them", async () => {
    await upload("binh")
    await saveExpense("binh", "an")
    await assertSucceeds(deleteObject(photo("an")))
  })
})

describe("profile photos", () => {
  const avatarRef = (uid: string, owner = uid, name = "avatar-k3x9.jpg") =>
    ref(storage(uid), `avatars/${owner}/${name}`)
  const put = (
    uid: string,
    owner = uid,
    opts: { name?: string; type?: string; bytes?: Uint8Array } = {},
  ) =>
    uploadBytes(avatarRef(uid, owner, opts.name), opts.bytes ?? jpeg, {
      contentType: opts.type ?? "image/jpeg",
    })

  it("lets only you add or remove your photo; anyone signed in sees it", async () => {
    await assertFails(put("mallory", "binh"))
    await assertSucceeds(put("binh"))
    await assertSucceeds(getBytes(avatarRef("mallory", "binh")))
    await assertFails(
      getBytes(ref(env.unauthenticatedContext().storage(), "avatars/binh/avatar-k3x9.jpg")),
    )
    await assertFails(deleteObject(avatarRef("mallory", "binh")))
    await assertSucceeds(deleteObject(avatarRef("binh")))
  })

  it("takes small JPEGs only", async () => {
    await assertFails(put("binh", "binh", { type: "image/png", name: "avatar-1.png" }))
    await assertFails(put("binh", "binh", { name: "avatar.exe" }))
    await assertFails(put("binh", "binh", { bytes: new Uint8Array(512 * 1024) }))
    await assertSucceeds(put("binh", "binh", { name: "avatar-2.jpg" }))
  })
})
