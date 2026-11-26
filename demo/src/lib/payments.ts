import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  limit,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import * as React from "react"

import { db, functions } from "@/lib/firebase"
import type { Live } from "@/lib/data"

/**
 * Bank accounts, bank-transfer payments and SePay. Writes go through Cloud Functions
 * (functions/src/index.ts); reads are live Firestore listeners under the security rules.
 */

export interface PaymentAccount {
  bankBin: string
  accountNumber: string
  holderName: string
  sepay: { keyHint: string; connectedAt: Date | null; lastEventAt: Date | null } | null
}

export type SettlementStatus = "pending" | "confirmed" | "cancelled"

export interface Settlement {
  id: string
  from: string
  to: string
  amount: number
  code: string
  status: SettlementStatus
  via: "payee" | "sepay" | null
  paidAmount: number | null
  createdAt: Date | null
  confirmedAt: Date | null
}

export interface SettlementBank {
  bankBin: string
  accountNumber: string
  holderName: string
}

export interface SepayTransfer {
  id: string
  amount: number
  content: string
  status: "matched" | "unmatched"
  receivedAt: Date | null
}

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)

function useSnapshot<T>(key: string | null, subscribe: (set: (v: Live<T>) => void) => () => void) {
  const [state, setState] = React.useState<Live<T>>({ data: undefined, error: null })
  const latest = React.useRef(subscribe)
  latest.current = subscribe
  React.useEffect(() => {
    setState({ data: undefined, error: null })
    if (!key) return
    return latest.current(setState)
  }, [key])
  return state
}

/** Yours only; null when you haven't added one. */
export function usePaymentAccount(uid: string): Live<PaymentAccount | null> {
  return useSnapshot(`account:${uid}`, (set) =>
    onSnapshot(
      doc(db, "paymentAccounts", uid),
      (snap) => {
        const d = snap.data()
        set({
          data: d
            ? {
                bankBin: d.bankBin,
                accountNumber: d.accountNumber,
                holderName: d.holderName,
                sepay: d.sepay
                  ? {
                      keyHint: d.sepay.keyHint,
                      connectedAt: toDate(d.sepay.connectedAt),
                      lastEventAt: toDate(d.sepay.lastEventAt),
                    }
                  : null,
              }
            : null,
          error: null,
        })
      },
      (error) => set({ data: undefined, error }),
    ),
  )
}

export function useSettlements(groupId: string): Live<Settlement[]> {
  return useSnapshot(`settlements:${groupId}`, (set) =>
    onSnapshot(
      query(collection(db, "groups", groupId, "settlements"), orderBy("createdAt", "desc")),
      (snap) =>
        set({
          data: snap.docs.map((s) => {
            const d = s.data()
            return {
              id: s.id,
              from: d.from,
              to: d.to,
              amount: d.amount,
              code: d.code,
              status: d.status,
              via: d.via,
              paidAmount: d.paidAmount,
              createdAt: toDate(d.createdAt),
              confirmedAt: toDate(d.confirmedAt),
            }
          }),
          error: null,
        }),
      (error) => set({ data: undefined, error }),
    ),
  )
}

/** Only the payer and payee can read this. */
export function useSettlementBank(groupId: string, settlementId: string | null) {
  return useSnapshot<SettlementBank | null>(
    settlementId ? `bank:${groupId}:${settlementId}` : null,
    (set) =>
      onSnapshot(
        doc(db, "groups", groupId, "settlements", settlementId!, "private", "bank"),
        (snap) => {
          const d = snap.data()
          set({
            data: d
              ? { bankBin: d.bankBin, accountNumber: d.accountNumber, holderName: d.holderName }
              : null,
            error: null,
          })
        },
        (error) => set({ data: undefined, error }),
      ),
  )
}

export function useSepayTransfers(uid: string): Live<SepayTransfer[]> {
  return useSnapshot(`transfers:${uid}`, (set) =>
    onSnapshot(
      query(
        collection(db, "sepayTransfers"),
        where("owner", "==", uid),
        orderBy("receivedAt", "desc"),
        limit(10),
      ),
      (snap) =>
        set({
          data: snap.docs.map((t) => {
            const d = t.data()
            return {
              id: t.id,
              amount: d.amount,
              content: d.content,
              status: d.status,
              receivedAt: toDate(d.receivedAt),
            }
          }),
          error: null,
        }),
      (error) => set({ data: undefined, error }),
    ),
  )
}

// ---------- Calls to the functions ----------

export async function savePaymentAccount(input: SettlementBank) {
  const call = httpsCallable<SettlementBank, { sepayTurnedOff: boolean }>(
    functions,
    "savePaymentAccount",
  )
  return (await call(input)).data
}

export async function removePaymentAccount() {
  await httpsCallable(functions, "removePaymentAccount")()
}

/** The key is shown once; only its hash is kept. */
export async function createSepayKey(): Promise<string> {
  const call = httpsCallable<void, { apiKey: string }>(functions, "createSepayKey")
  return (await call()).data.apiKey
}

export async function disableSepay() {
  await httpsCallable(functions, "disableSepay")()
}

export async function startSettlement(groupId: string, to: string, amount: number) {
  const call = httpsCallable<
    { groupId: string; to: string; amount: number },
    { settlementId: string }
  >(functions, "startSettlement")
  return (await call({ groupId, to, amount })).data.settlementId
}

/** The payee saw the money arrive. */
export function confirmSettlement(groupId: string, settlement: Settlement) {
  return updateDoc(doc(db, "groups", groupId, "settlements", settlement.id), {
    status: "confirmed",
    via: "payee",
    paidAmount: settlement.amount,
    confirmedAt: serverTimestamp(),
  })
}

export function cancelSettlement(groupId: string, settlementId: string) {
  return updateDoc(doc(db, "groups", groupId, "settlements", settlementId), {
    status: "cancelled",
  })
}

/** Where SePay should send its webhook: this app's own origin (see firebase.json rewrites). */
export function sepayWebhookUrl(): string {
  return `${location.origin}/api/sepay-webhook`
}

/** Function errors carry a message written for people; anything else gets a generic one. */
export function callErrorMessage(error: unknown): string {
  const e = error as { code?: string; message?: string }
  if (
    e.code &&
    [
      "functions/invalid-argument",
      "functions/failed-precondition",
      "functions/permission-denied",
    ].includes(e.code) &&
    e.message
  ) {
    return e.message
  }
  if (e.code === "permission-denied") return "You don't have access to this."
  return "Something went wrong. Try again."
}
