/**
 * The demo's only server code: bank accounts, bank-transfer payments and the SePay webhook.
 * Everything else talks to Firestore directly under its security rules.
 *
 *   paymentAccounts/{uid}                         your bank account and SePay key hash (you read it)
 *   groups/{g}/settlements/{s}                    a bank-transfer payment (members read it)
 *   groups/{g}/settlements/{s}/private/bank       where to send it (only payer and payee read it)
 *   paymentCodes/{code}                           code => settlement, for the webhook (server only)
 *   sepayTransfers/{uid}_{sepayId}                every transfer SePay told us about (owner reads)
 *
 * The functions below are the only writers of these documents.
 */
import { createHash, randomBytes, randomInt } from "node:crypto"

import { initializeApp } from "firebase-admin/app"
import {
  FieldValue,
  getFirestore,
  type DocumentData,
  type Transaction,
} from "firebase-admin/firestore"
import { setGlobalOptions } from "firebase-functions/v2"
import { HttpsError, onCall, onRequest, type CallableRequest } from "firebase-functions/v2/https"
import { logger } from "firebase-functions"
import { z } from "zod"

import { bankByBin } from "../../src/shared/banks.js"
import { netBalances, simplifyDebts } from "../../src/shared/money.js"
import {
  findPaymentCodes,
  PAYMENT_CODE_ALPHABET,
  PAYMENT_CODE_LENGTH,
  PAYMENT_CODE_PREFIX,
} from "../../src/shared/payment-code.js"

initializeApp()
const db = getFirestore()

setGlobalOptions({ region: "asia-southeast1", maxInstances: 5 })

const MAX_AMOUNT = 10_000_000_000

// ---------- Helpers ----------

function signedIn(request: CallableRequest): string {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.")
  return uid
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data)
  if (!result.success) {
    throw new HttpsError("invalid-argument", result.error.issues[0]?.message ?? "Invalid input.")
  }
  return result.data
}

async function isMember(groupId: string, uid: string): Promise<boolean> {
  return (await db.doc(`groups/${groupId}/members/${uid}`).get()).exists
}

function hashSepayKey(key: string): string {
  return createHash("sha256").update(key).digest("hex")
}

function newPaymentCode(): string {
  let code = PAYMENT_CODE_PREFIX
  for (let i = 0; i < PAYMENT_CODE_LENGTH; i++) {
    code += PAYMENT_CODE_ALPHABET[randomInt(PAYMENT_CODE_ALPHABET.length)]
  }
  return code
}

// ---------- Bank account ----------

const bankAccountSchema = z.object({
  bankBin: z.string().refine((bin) => bankByBin(bin) !== undefined, "Choose a bank from the list."),
  accountNumber: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z]{4,25}$/, "Account numbers are 4 to 25 letters and digits."),
  holderName: z
    .string()
    .trim()
    .min(2, "Enter the name on the account.")
    .max(60)
    // Banks show holder names in capitals without accents, and so does the QR code.
    .regex(/^[A-Za-z ]+$/, "Write the name without accents, as your bank shows it."),
})

/** Saves where people pay you. Moving to another account turns SePay off: its key was for the old one. */
export const savePaymentAccount = onCall(async (request) => {
  const uid = signedIn(request)
  const input = parse(bankAccountSchema, request.data)
  const ref = db.doc(`paymentAccounts/${uid}`)
  return db.runTransaction(async (tx) => {
    const current = (await tx.get(ref)).data()
    const moved =
      current?.bankBin !== input.bankBin || current?.accountNumber !== input.accountNumber
    tx.set(
      ref,
      {
        bankBin: input.bankBin,
        accountNumber: input.accountNumber,
        holderName: input.holderName.toUpperCase(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(moved || !current ? { sepay: null } : {}),
      },
      { merge: true },
    )
    return { sepayTurnedOff: Boolean(moved && current?.sepay) }
  })
})

/** Payments already confirmed keep their record; new ones can't be made to you. */
export const removePaymentAccount = onCall(async (request) => {
  const uid = signedIn(request)
  await db.doc(`paymentAccounts/${uid}`).delete()
  return {}
})

// ---------- SePay key ----------

/**
 * A new webhook key for your SePay account. Returned once; only its hash is kept. Making a new
 * one replaces the old, which stops working straight away.
 */
export const createSepayKey = onCall(async (request) => {
  const uid = signedIn(request)
  const ref = db.doc(`paymentAccounts/${uid}`)
  const account = (await ref.get()).data()
  if (!account) throw new HttpsError("failed-precondition", "Save your bank account first.")
  if (!bankByBin(account.bankBin)?.sepay) {
    throw new HttpsError("failed-precondition", "SePay can't watch accounts at this bank yet.")
  }
  const key = `twg_${randomBytes(32).toString("base64url")}`
  await ref.update({
    sepay: {
      keyHash: hashSepayKey(key),
      keyHint: key.slice(-4),
      connectedAt: FieldValue.serverTimestamp(),
      lastEventAt: null,
    },
  })
  return { apiKey: key }
})

export const disableSepay = onCall(async (request) => {
  const uid = signedIn(request)
  await db.doc(`paymentAccounts/${uid}`).update({ sepay: null })
  return {}
})

// ---------- Paying by bank transfer ----------

const startSchema = z.object({
  groupId: z.string().min(1).max(64),
  to: z.string().min(1).max(128),
  amount: z.number().int().positive().max(MAX_AMOUNT),
})

/**
 * Starts a bank-transfer payment from you to someone in the group: a payment code for the
 * transfer note, and their bank details, which only the two of you can read.
 */
export const startSettlement = onCall(async (request) => {
  const uid = signedIn(request)
  const { groupId, to, amount } = parse(startSchema, request.data)
  if (to === uid) throw new HttpsError("invalid-argument", "You can't pay yourself.")
  const [payerIn, payeeIn] = await Promise.all([isMember(groupId, uid), isMember(groupId, to)])
  if (!payerIn || !payeeIn)
    throw new HttpsError("permission-denied", "You're not both in this group.")

  // Only for money you owe them, so joining a group isn't a way to collect everyone's bank
  // details. Same sums the app shows (src/shared/money.ts).
  const owed = await owedBetween(groupId, uid, to)
  if (owed === 0) {
    throw new HttpsError("failed-precondition", "You don't owe them anything right now.")
  }
  if (amount > owed) {
    throw new HttpsError("invalid-argument", "That's more than you owe them.")
  }

  // One payment in progress per pair: show that one again rather than piling up new ones.
  const existing = await db
    .collection(`groups/${groupId}/settlements`)
    .where("from", "==", uid)
    .where("to", "==", to)
    .where("status", "==", "pending")
    .limit(1)
    .get()
  if (!existing.empty) return { settlementId: existing.docs[0]!.id }

  const account = (await db.doc(`paymentAccounts/${to}`).get()).data()
  if (!account) {
    throw new HttpsError("failed-precondition", "They haven't added a bank account yet.")
  }

  const settlement = db.collection(`groups/${groupId}/settlements`).doc()
  // A code is unique for good: retry on the (very unlikely) clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPaymentCode()
    try {
      await db.runTransaction(async (tx) => {
        const codeRef = db.doc(`paymentCodes/${code}`)
        if ((await tx.get(codeRef)).exists) throw new Error("code-taken")
        tx.create(codeRef, { groupId, settlementId: settlement.id, to })
        tx.create(settlement, {
          from: uid,
          to,
          amount,
          code,
          status: "pending",
          via: null,
          paidAmount: null,
          createdAt: FieldValue.serverTimestamp(),
          confirmedAt: null,
        })
        tx.create(settlement.collection("private").doc("bank"), {
          from: uid,
          to,
          bankBin: account.bankBin,
          accountNumber: account.accountNumber,
          holderName: account.holderName,
        })
      })
      return { settlementId: settlement.id }
    } catch (e) {
      if ((e as Error).message !== "code-taken") throw e
    }
  }
  throw new HttpsError("internal", "Couldn't make a payment code. Try again.")
})

/** What `from` owes `to` in the group's settle-up plan right now; 0 if nothing. */
async function owedBetween(groupId: string, from: string, to: string): Promise<number> {
  const group = db.collection("groups").doc(groupId)
  const [expenses, payments, settlements] = await Promise.all([
    group.collection("expenses").get(),
    group.collection("payments").get(),
    group.collection("settlements").where("status", "==", "confirmed").get(),
  ])
  const net = netBalances(
    expenses.docs.map((d) => {
      const e = d.data()
      return {
        amount: e.amount,
        paidBy: e.paidBy,
        participants: e.participants,
        weights: e.weights ?? null,
      }
    }),
    [
      ...payments.docs.map((d) => {
        const p = d.data()
        return { from: p.from, to: p.to, amount: p.amount }
      }),
      ...settlements.docs.map((d) => {
        const s = d.data()
        return { from: s.from, to: s.to, amount: s.paidAmount ?? s.amount }
      }),
    ],
  )
  return simplifyDebts(net).find((t) => t.from === from && t.to === to)?.amount ?? 0
}

// ---------- SePay webhook ----------

/**
 * SePay's transfer notification. Lenient on purpose: its "Gửi thử" test and some banks send
 * empty fields, numbers as text or nulls, and a strict check would refuse the whole request.
 * Only the fields used below matter; anything that isn't a real incoming transfer is ignored.
 */
const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.number()])
    .nullish()
    .transform((v) => (v == null ? "" : String(v)))

const sepaySchema = z.object({
  id: z.coerce.number().int().nonnegative(),
  gateway: optionalText(100),
  transactionDate: optionalText(40),
  accountNumber: optionalText(40),
  subAccount: optionalText(40),
  code: optionalText(100),
  content: optionalText(1000),
  transferType: optionalText(10),
  transferAmount: z.coerce.number().nonnegative().max(1e15),
  referenceCode: optionalText(100),
  description: optionalText(2000),
})

type Outcome = "matched" | "unmatched" | "duplicate" | "ignored"

/**
 * SePay calls this when money arrives in a watched account. The URL is public, so nothing in
 * the request is trusted until the API key matches someone, and that key can only confirm
 * payments owed to its owner. SePay retries until it gets a 2xx, so retries are recorded once.
 */
export const sepayWebhook = onRequest({ cors: false }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ success: false })
    return
  }
  const key = /^Apikey\s+(\S{20,200})$/i.exec(req.get("authorization") ?? "")?.[1]
  const owner = key
    ? (
        await db
          .collection("paymentAccounts")
          .where("sepay.keyHash", "==", hashSepayKey(key))
          .limit(1)
          .get()
      ).docs[0]
    : undefined
  if (!owner) {
    res.status(401).json({ success: false })
    return
  }
  const parsed = sepaySchema.safeParse(req.body)
  if (!parsed.success) {
    // Which fields were wrong, never their values (they're someone's bank transfer).
    logger.warn("SePay webhook: unexpected body", {
      owner: owner.id,
      contentType: req.get("content-type") ?? null,
      keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : typeof req.body,
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })),
    })
    res.status(400).json({ success: false })
    return
  }
  const outcome = await handleTransfer(owner.id, owner.data(), parsed.data)
  logger.info("SePay webhook", { owner: owner.id, sepayId: parsed.data.id, outcome })
  res.status(200).json({ success: true, outcome })
})

async function handleTransfer(
  uid: string,
  account: DocumentData,
  input: z.infer<typeof sepaySchema>,
): Promise<Outcome> {
  await db
    .doc(`paymentAccounts/${uid}`)
    .update({ "sepay.lastEventAt": FieldValue.serverTimestamp() })

  // Only real money coming in (SePay's test has no id), to the account this key was made for.
  if (input.transferType !== "in") return "ignored"
  if (input.id <= 0 || !Number.isSafeInteger(input.transferAmount) || input.transferAmount <= 0) {
    return "ignored"
  }
  if (input.accountNumber !== account.accountNumber && input.subAccount !== account.accountNumber) {
    return "ignored"
  }

  return db.runTransaction(async (tx) => {
    const transferRef = db.doc(`sepayTransfers/${uid}_${input.id}`)
    if ((await tx.get(transferRef)).exists) return "duplicate"

    const match = await findSettlement(tx, uid, input)
    const record = {
      owner: uid,
      sepayId: input.id,
      amount: input.transferAmount,
      content: input.content,
      transferredAt: input.transactionDate,
      receivedAt: FieldValue.serverTimestamp(),
      status: match ? "matched" : "unmatched",
      settlementPath: match?.path ?? null,
    }
    tx.create(transferRef, record)
    if (!match) return "unmatched"
    // Real money moved, so this confirms even a payment someone had cancelled.
    tx.update(match, {
      status: "confirmed",
      via: "sepay",
      paidAmount: input.transferAmount,
      confirmedAt: FieldValue.serverTimestamp(),
    })
    return "matched"
  })
}

/** The first not-yet-confirmed payment to this owner whose code is in the transfer note. */
async function findSettlement(tx: Transaction, uid: string, input: z.infer<typeof sepaySchema>) {
  if (input.transferAmount > MAX_AMOUNT) return null
  const codes = findPaymentCodes([input.code, input.content, input.description].join(" "))
  for (const code of codes) {
    const index = (await tx.get(db.doc(`paymentCodes/${code}`))).data()
    if (!index || index.to !== uid) continue
    const ref = db.doc(`groups/${index.groupId}/settlements/${index.settlementId}`)
    const settlement = (await tx.get(ref)).data()
    if (settlement && settlement.status !== "confirmed") return ref
  }
  return null
}
