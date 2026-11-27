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
  type DocumentData,
  type Query,
} from "firebase/firestore"
import * as React from "react"

import { db } from "@/lib/firebase"
import { balancesChanged, PAGE_SIZE, type Live } from "@/lib/data"

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

export function toSettlement(id: string, d: DocumentData): Settlement {
  return {
    id,
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
}

function useSettlementQuery(key: string, make: () => Query<DocumentData>): Live<Settlement[]> {
  return useSnapshot(key, (set) =>
    onSnapshot(
      make(),
      (snap) => set({ data: snap.docs.map((s) => toSettlement(s.id, s.data())), error: null }),
      (error) => set({ data: undefined, error }),
    ),
  )
}

/** Bank transfers waiting for the money, all of them (there are only ever a few). */
export function usePendingSettlements(groupId: string): Live<Settlement[]> {
  return useSettlementQuery(`settlements:pending:${groupId}`, () =>
    query(collection(db, "groups", groupId, "settlements"), where("status", "==", "pending")),
  )
}

/** The latest `max` bank transfers that arrived. */
export function useConfirmedSettlements(
  groupId: string,
  max = PAGE_SIZE,
): Live<Settlement[]> & { more: boolean } {
  const live = useSettlementQuery(`settlements:confirmed:${groupId}:${max}`, () =>
    query(
      collection(db, "groups", groupId, "settlements"),
      where("status", "==", "confirmed"),
      orderBy("confirmedAt", "desc"),
      limit(max + 1),
    ),
  )
  return { ...live, data: live.data?.slice(0, max), more: (live.data?.length ?? 0) > max }
}

/** One bank transfer, live (to keep showing it after it's confirmed or called off). */
export function useSettlement(groupId: string, id: string | null): Live<Settlement | null> {
  return useSnapshot(id ? `settlement:${groupId}:${id}` : null, (set) =>
    onSnapshot(
      doc(db, "groups", groupId, "settlements", id!),
      (snap) => set({ data: snap.exists() ? toSettlement(snap.id, snap.data()) : null, error: null }),
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

/** Calls a Cloud Function, loading the Functions SDK the first time. */
export async function callFunction<In, Out>(name: string, input?: In): Promise<Out> {
  const { functions, httpsCallable } = await import("@/lib/functions")
  return (await httpsCallable<In, Out>(functions, name)(input as In)).data
}

export function savePaymentAccount(input: SettlementBank) {
  return callFunction<SettlementBank, { sepayTurnedOff: boolean }>("savePaymentAccount", input)
}

export async function removePaymentAccount() {
  await callFunction("removePaymentAccount")
}

/** The key is shown once; only its hash is kept. */
export async function createSepayKey(): Promise<string> {
  return (await callFunction<void, { apiKey: string }>("createSepayKey")).apiKey
}

export async function disableSepay() {
  await callFunction("disableSepay")
}

export async function startSettlement(groupId: string, to: string, amount: number) {
  const out = await callFunction<
    { groupId: string; to: string; amount: number },
    { settlementId: string }
  >("startSettlement", { groupId, to, amount })
  return out.settlementId
}

/** The payee saw the money arrive. */
export async function confirmSettlement(groupId: string, settlement: Settlement) {
  await updateDoc(doc(db, "groups", groupId, "settlements", settlement.id), {
    status: "confirmed",
    via: "payee",
    paidAmount: settlement.amount,
    confirmedAt: serverTimestamp(),
  })
  balancesChanged(groupId)
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
