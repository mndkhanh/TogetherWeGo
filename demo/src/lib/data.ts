import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Query,
} from "firebase/firestore"
import * as React from "react"

import { db } from "@/lib/firebase"
import type { SplitKind } from "@/lib/money"
import { deleteExpensePhotos, uploadExpensePhotos } from "@/lib/photos"

/** Long lists load this many at a time, newest first, with "Show older" for more. */
export const PAGE_SIZE = 30

export interface Group {
  id: string
  name: string
  ownerId: string
  inviteCode: string
  /** When the invite link stops working; null for groups from before links expired. */
  inviteExpiresAt: Date | null
}

export interface Member {
  uid: string
  name: string
  /** A nickname or full name, so friends recognise them. */
  altName: string | null
  /** Their profile photo's URL, or null for initials. */
  photo: string | null
  role: "owner" | "member"
}

export interface Expense {
  id: string
  description: string
  amount: number
  paidBy: string
  participants: string[]
  /** How it's shared; see SplitKind. */
  split: SplitKind
  /** One per participant for "shares" (in halves) and "amounts" (dong); null when equal. */
  weights: number[] | null
  spentOn: string
  createdBy: string
  /** File names in Storage, under groups/{groupId}/expenses/{id}/. */
  photos: string[]
  /** A bill number, booking link or note, as typed. */
  reference: string | null
  /** The plan (event) it was spent for, if any. */
  eventId: string | null
  /** When it was added (null for a moment while the server stamps it). */
  createdAt: Date | null
  /** When it was last changed, if ever. */
  editedAt: Date | null
  editedBy: string | null
  /**
   * When it was deleted, and by whom. A deleted expense stays in the history, marked, and counts
   * for nothing; it can be brought back.
   */
  deletedAt: Date | null
  deletedBy: string | null
}

export interface Payment {
  id: string
  from: string
  to: string
  amount: number
  note: string
  createdBy: string
  createdAt: Date | null
}

export interface HangoutEvent {
  id: string
  title: string
  startsAt: Date
  location: string
  createdBy: string
}

export type RsvpStatus = "going" | "maybe" | "no"

export interface Rsvp {
  uid: string
  status: RsvpStatus
  name: string
}

/** Live results. `data` is undefined until the first snapshot arrives. */
export interface Live<T> {
  data: T | undefined
  error: Error | null
}

export interface Me {
  uid: string
  name: string
  altName?: string | null
  photo?: string | null
}

export interface Profile {
  name: string
  altName: string | null
  photo: string | null
}

function toDate(value: unknown): Date | null {
  return value instanceof Timestamp ? value.toDate() : null
}

/** Subscribes while mounted; `key` says when the query actually changed. */
export function useLive<T>(
  key: string,
  source: () => Query<DocumentData> | DocumentReference<DocumentData>,
  map: (id: string, d: DocumentData, path: string) => T,
): Live<T[]> {
  const [state, setState] = React.useState<Live<T[]>>({ data: undefined, error: null })
  const latest = React.useRef({ source, map })
  latest.current = { source, map }
  React.useEffect(() => {
    setState({ data: undefined, error: null })
    const { source, map } = latest.current
    const target = source()
    const onError = (error: Error) => setState({ data: undefined, error })
    if (target.type === "document") {
      return onSnapshot(
        target,
        (snap) =>
          setState({
            data: snap.exists() ? [map(snap.id, snap.data(), snap.ref.path)] : [],
            error: null,
          }),
        onError,
      )
    }
    return onSnapshot(
      target,
      (snap) =>
        setState({ data: snap.docs.map((d) => map(d.id, d.data(), d.ref.path)), error: null }),
      onError,
    )
  }, [key])
  return state
}

const groupRef = (groupId: string) => doc(db, "groups", groupId)
const sub = (groupId: string, name: string) => collection(db, "groups", groupId, name)

const toGroup = (id: string, d: DocumentData): Group => ({
  id,
  name: d.name,
  ownerId: d.ownerId,
  inviteCode: d.inviteCode,
  inviteExpiresAt: toDate(d.inviteExpiresAt),
})

// ---------- Groups ----------

/** The groups you're in, most recently joined first. */
export function useMyGroups(uid: string): Live<Group[]> {
  const [state, setState] = React.useState<Live<Group[]>>({ data: undefined, error: null })
  React.useEffect(() => {
    let version = 0
    // Membership documents live at groups/{groupId}/members/{uid}: find them, then read
    // each group (allowed, since you're a member).
    return onSnapshot(
      query(collectionGroup(db, "members"), where("uid", "==", uid)),
      (snap) => {
        const mine = ++version
        const memberships = snap.docs
          .map((m) => ({ ref: m.ref.parent.parent, joinedAt: toDate(m.data().joinedAt) }))
          .sort((a, b) => (b.joinedAt?.getTime() ?? 0) - (a.joinedAt?.getTime() ?? 0))
        Promise.all(memberships.map((m) => (m.ref ? getDoc(m.ref) : null))).then(
          (groups) => {
            if (mine !== version) return
            const data = groups.flatMap((g) => (g?.exists() ? [toGroup(g.id, g.data())] : []))
            setState({ data, error: null })
          },
          (error: Error) => mine === version && setState({ data: undefined, error }),
        )
      },
      (error) => setState({ data: undefined, error }),
    )
  }, [uid])
  return state
}

export function useGroup(groupId: string): Live<Group | null> {
  const live = useLive(`group:${groupId}`, () => groupRef(groupId), toGroup)
  return { data: live.data && (live.data[0] ?? null), error: live.error }
}

export function useMembers(groupId: string): Live<Member[]> {
  return useLive(
    `members:${groupId}`,
    () => query(sub(groupId, "members"), orderBy("joinedAt")),
    (_id, d) => ({
      uid: d.uid,
      name: d.name,
      altName: d.altName ?? null,
      photo: d.photo ?? null,
      role: d.role,
    }),
  )
}

/** Invite codes: 8 characters, no 0/O or 1/I/L, so they survive being read out or retyped. */
const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
const INVITE_CODE = /^[A-HJKMNP-Z2-9]{8}$/

function newInviteCode(): string {
  let code = ""
  while (code.length < 8) {
    // 248 = 8 × 31: dropping bytes above it keeps every character equally likely.
    const byte = crypto.getRandomValues(new Uint8Array(1))[0] ?? 255
    if (byte < 248) code += INVITE_ALPHABET.charAt(byte % 31)
  }
  return code
}

/** What someone types or pastes: case and spaces don't matter. Null if it can't be a code. */
export function normaliseInviteCode(input: string): string | null {
  const code = input.replace(/\s/g, "").toUpperCase()
  return INVITE_CODE.test(code) ? code : null
}

const inviteRef = (code: string) => doc(db, "invites", code)

/**
 * Codes are random, so two groups almost never draw the same one; when they do, the rules refuse
 * the second (an invite can't be overwritten) and we draw again.
 */
async function withFreshCode(write: (code: string) => Promise<void>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write(newInviteCode())
    } catch (e) {
      if (attempt >= 3 || (e as { code?: string }).code !== "permission-denied") throw e
    }
  }
}

/** How long a new invite link works. 24 hours unless the owner picks another. */
export const INVITE_DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "24 hours" },
  { hours: 24 * 7, label: "7 days" },
] as const
export const DEFAULT_INVITE_HOURS = 24

const expiresIn = (hours: number) => Timestamp.fromMillis(Date.now() + hours * 3_600_000)

/** Whether a group's invite link has run out (links from before expiry existed never do). */
export function inviteExpired(expiresAt: Date | null, now = Date.now()): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now
}

/** The group an invite code belongs to, or null when the code isn't in use (any more). */
export async function groupForInvite(
  code: string,
): Promise<{ groupId: string; expiresAt: Date | null } | null> {
  const snap = await getDoc(inviteRef(code))
  if (!snap.exists()) return null
  return { groupId: snap.data().groupId as string, expiresAt: toDate(snap.data().expiresAt) }
}

/** The group and your owner membership, in one batch (the rules check both together). */
export async function createGroup(name: string, me: Me): Promise<string> {
  const ref = doc(collection(db, "groups"))
  await withFreshCode((inviteCode) => {
    const batch = writeBatch(db)
    const expiresAt = expiresIn(DEFAULT_INVITE_HOURS)
    batch.set(inviteRef(inviteCode), { groupId: ref.id, expiresAt })
    batch.set(ref, {
      name: name.trim(),
      ownerId: me.uid,
      inviteCode,
      inviteExpiresAt: expiresAt,
      memberIds: [me.uid],
      createdAt: serverTimestamp(),
    })
    batch.set(doc(ref, "members", me.uid), {
      uid: me.uid,
      name: me.name,
      ...(me.altName && { altName: me.altName }),
      ...(me.photo && { photo: me.photo }),
      role: "owner",
      code: inviteCode,
      joinedAt: serverTimestamp(),
    })
    return batch.commit()
  })
  return ref.id
}

export async function isMemberOf(groupId: string, uid: string): Promise<boolean> {
  return (await getDoc(doc(db, "groups", groupId, "members", uid))).exists()
}

/**
 * Your member document and your place in the group's memberIds, together (the rules check
 * both). Fails with permission-denied when the code is wrong, replaced or expired.
 */
export function joinGroup(groupId: string, code: string, me: Me) {
  const batch = writeBatch(db)
  batch.set(doc(db, "groups", groupId, "members", me.uid), {
    uid: me.uid,
    name: me.name,
    ...(me.altName && { altName: me.altName }),
    ...(me.photo && { photo: me.photo }),
    role: "member",
    code,
    joinedAt: serverTimestamp(),
  })
  batch.update(groupRef(groupId), { memberIds: arrayUnion(me.uid) })
  return batch.commit()
}

/**
 * The owner takes someone out of the group. Their member document goes, and so does the invite
 * code, so the old link can't bring them back. What they added stays.
 */
export function removeMember(group: Group, uid: string) {
  return withFreshCode((inviteCode) => {
    const expiresAt = expiresIn(DEFAULT_INVITE_HOURS)
    const batch = newCodeBatch(group, inviteCode, expiresAt)
    batch.delete(doc(db, "groups", group.id, "members", uid))
    batch.update(groupRef(group.id), {
      memberIds: arrayRemove(uid),
      inviteCode,
      inviteExpiresAt: expiresAt,
    })
    return batch.commit()
  })
}

/** A new invite link that works for the given hours. The old link stops working. */
export function replaceInviteCode(group: Group, hours: number = DEFAULT_INVITE_HOURS) {
  return withFreshCode((inviteCode) => {
    const expiresAt = expiresIn(hours)
    const batch = newCodeBatch(group, inviteCode, expiresAt)
    batch.update(groupRef(group.id), { inviteCode, inviteExpiresAt: expiresAt })
    return batch.commit()
  })
}

/** Points the new code at the group and drops the old one (groups from before short codes have none). */
function newCodeBatch(group: Group, inviteCode: string, expiresAt: Timestamp) {
  const batch = writeBatch(db)
  batch.set(inviteRef(inviteCode), { groupId: group.id, expiresAt })
  if (INVITE_CODE.test(group.inviteCode)) batch.delete(inviteRef(group.inviteCode))
  return batch
}

/** A short link, like https://togetherwego.web.app/j/K7P3QX9M. Older groups keep the long form. */
export function inviteLink(group: Group): string {
  return INVITE_CODE.test(group.inviteCode)
    ? `${location.origin}/j/${group.inviteCode}`
    : `${location.origin}/join/${group.id}/${encodeURIComponent(group.inviteCode)}`
}

// ---------- Expenses and payments ----------

export function toExpense(id: string, d: DocumentData): Expense {
  return {
    id,
    description: d.description,
    amount: d.amount,
    paidBy: d.paidBy,
    participants: d.participants,
    split: d.split ?? "equal",
    weights: d.weights ?? null,
    spentOn: d.spentOn,
    createdBy: d.createdBy,
    photos: d.photos ?? [],
    reference: d.reference ?? null,
    eventId: d.eventId ?? null,
    createdAt: toDate(d.createdAt),
    editedAt: toDate(d.editedAt),
    editedBy: d.editedBy ?? null,
    // A moment without the server's time still counts as deleted.
    deletedAt: d.deletedBy ? (toDate(d.deletedAt) ?? new Date()) : null,
    deletedBy: d.deletedBy ?? null,
  }
}

/** The group's latest `max` expenses by date. `more` says whether older ones exist. */
export function useExpenses(groupId: string, max = PAGE_SIZE): Live<Expense[]> & { more: boolean } {
  const live = useLive(
    `expenses:${groupId}:${max}`,
    // One extra, to know whether there's more without showing it.
    () => query(sub(groupId, "expenses"), orderBy("spentOn", "desc"), limit(max + 1)),
    toExpense,
  )
  return { ...live, data: live.data?.slice(0, max), more: (live.data?.length ?? 0) > max }
}

/**
 * Every expense for one of the group's plans, deleted ones left out, for the plans' totals. Not
 * paged: a group's plans see a few dozen expenses, not thousands.
 */
export function usePlanExpenses(groupId: string): Live<Expense[]> {
  const live = useLive(
    `plan-expenses:${groupId}`,
    () => query(sub(groupId, "expenses"), where("eventId", "!=", null)),
    toExpense,
  )
  return { ...live, data: live.data?.filter((e) => !e.deletedAt) }
}

/** What the expense form saves, new or edited. */
export type ExpenseInput = Pick<
  Expense,
  "description" | "amount" | "paidBy" | "participants" | "split" | "weights" | "spentOn" | "eventId"
> & { reference: string }

function expenseFields(input: ExpenseInput) {
  const reference = input.reference.trim()
  const uneven = input.split !== "equal" && input.weights
  return {
    description: input.description.trim(),
    amount: input.amount,
    paidBy: input.paidBy,
    participants: input.participants,
    split: uneven ? input.split : deleteField(),
    weights: uneven ? input.weights : deleteField(),
    spentOn: input.spentOn,
    reference: reference || deleteField(),
    eventId: input.eventId || deleteField(),
  }
}

/**
 * Photos go up first, under the new expense's id, then the expense that lists them. If saving
 * the expense fails, the photos are removed again.
 */
export async function addExpense(
  groupId: string,
  input: ExpenseInput & { photoFiles: File[] },
  uid: string,
) {
  const ref = doc(sub(groupId, "expenses"))
  const photos = await uploadExpensePhotos(groupId, ref.id, input.photoFiles)
  // A new document has nothing to delete: leave out the fields that aren't set.
  const fields = Object.fromEntries(
    Object.entries(expenseFields(input)).filter(([, v]) => !isDeleteField(v)),
  )
  try {
    await setDoc(ref, {
      ...fields,
      ...(photos.length > 0 && { photos }),
      createdBy: uid,
      createdAt: serverTimestamp(),
    })
  } catch (e) {
    await deleteExpensePhotos(groupId, ref.id, photos).catch(() => undefined)
    throw e
  }
  balancesChanged(groupId)
}

const DELETE = deleteField()
const isDeleteField = (v: unknown) =>
  typeof v === "object" && v !== null && DELETE.isEqual(v as never)

/** Fixes an expense: everything but its photos, who added it and when. */
export async function updateExpense(groupId: string, id: string, input: ExpenseInput, uid: string) {
  await updateDoc(doc(db, "groups", groupId, "expenses", id), {
    ...expenseFields(input),
    editedAt: serverTimestamp(),
    editedBy: uid,
  })
  balancesChanged(groupId)
}

/**
 * Marks an expense deleted, saying who. It stays in the history (photos too) and counts for
 * nothing until it's brought back.
 */
export async function deleteExpense(groupId: string, id: string, uid: string) {
  await updateDoc(doc(db, "groups", groupId, "expenses", id), {
    deletedAt: serverTimestamp(),
    deletedBy: uid,
  })
  balancesChanged(groupId)
}

/** Brings a deleted expense back as it was. It then shows as edited by you. */
export async function restoreExpense(groupId: string, id: string, uid: string) {
  await updateDoc(doc(db, "groups", groupId, "expenses", id), {
    deletedAt: deleteField(),
    deletedBy: deleteField(),
    editedAt: serverTimestamp(),
    editedBy: uid,
  })
  balancesChanged(groupId)
}

export function toPayment(id: string, d: DocumentData): Payment {
  return {
    id,
    from: d.from,
    to: d.to,
    amount: d.amount,
    note: d.note,
    createdBy: d.createdBy,
    createdAt: toDate(d.createdAt),
  }
}

/** The latest `max` recorded payments. */
export function usePayments(groupId: string, max = PAGE_SIZE): Live<Payment[]> & { more: boolean } {
  const live = useLive(
    `payments:${groupId}:${max}`,
    () => query(sub(groupId, "payments"), orderBy("createdAt", "desc"), limit(max + 1)),
    toPayment,
  )
  return { ...live, data: live.data?.slice(0, max), more: (live.data?.length ?? 0) > max }
}

export async function addPayment(
  groupId: string,
  input: Pick<Payment, "from" | "to" | "amount" | "note">,
  uid: string,
) {
  await addDoc(sub(groupId, "payments"), {
    from: input.from,
    to: input.to,
    amount: input.amount,
    note: input.note.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
  })
  balancesChanged(groupId)
}

export async function deletePayment(groupId: string, paymentId: string) {
  await deleteDoc(doc(db, "groups", groupId, "payments", paymentId))
  balancesChanged(groupId)
}

// ---------- Balances ----------

export interface Balances {
  /** + the group owes them, − they owe. Missing means 0. */
  net: Map<string, number>
  /** Each person's share of everything spent. */
  spent: Map<string, number>
  expenseCount: number
  paymentCount: number
  /** A change you just made hasn't been counted yet (the server recounts in a second or two). */
  updating: boolean
}

/**
 * When you last changed money in a group, so its balances can say "updating" until the server's
 * recount (functions/src/index.ts) has caught up. Only this tab's own changes: other people's
 * just appear when they're counted.
 */
const changedAt = new Map<string, { counted: number; at: number }>()
/** The last count seen per group (the server's time, so the device's clock doesn't matter). */
const lastCounted = new Map<string, number>()
const CHANGED = "twg:balances-changed"

export function balancesChanged(groupId: string) {
  changedAt.set(groupId, { counted: lastCounted.get(groupId) ?? 0, at: Date.now() })
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: groupId }))
}

/**
 * The group's balances, kept up to date by the server: one document, however long the history.
 * A group from before they were stored gets counted on first view.
 */
export function useBalances(groupId: string): Live<Balances> {
  const live = useLive(
    `balances:${groupId}`,
    () => doc(db, "groups", groupId, "summary", "balances"),
    (_id, d) => d,
  )
  const [, rerender] = React.useReducer((n: number) => n + 1, 0)
  const asked = React.useRef("")

  // Recheck "updating" when you change something, and give up on it after half a minute.
  React.useEffect(() => {
    const onChange = (e: Event) => (e as CustomEvent<string>).detail === groupId && rerender()
    window.addEventListener(CHANGED, onChange)
    const timer = setInterval(rerender, 5000)
    return () => {
      window.removeEventListener(CHANGED, onChange)
      clearInterval(timer)
    }
  }, [groupId])

  const missing = live.data !== undefined && live.data.length === 0
  React.useEffect(() => {
    if (!missing || asked.current === groupId) return
    asked.current = groupId
    void import("@/lib/payments").then(({ callFunction }) =>
      callFunction("refreshBalances", { groupId }).catch(() => undefined),
    )
  }, [missing, groupId])

  if (live.error) return { data: undefined, error: live.error }
  const d = live.data?.[0]
  if (!d) return { data: undefined, error: null }
  const counted = toDate(d.updatedAt)?.getTime() ?? 0
  lastCounted.set(groupId, counted)
  const mine = changedAt.get(groupId)
  const toNumbers = (o: unknown) => new Map(Object.entries((o ?? {}) as Record<string, number>))
  return {
    data: {
      net: toNumbers(d.net),
      spent: toNumbers(d.spent),
      expenseCount: d.expenseCount ?? 0,
      paymentCount: d.paymentCount ?? 0,
      // Still the count from before your change (for at most half a minute).
      updating: mine !== undefined && counted <= mine.counted && Date.now() - mine.at < 30_000,
    },
    error: null,
  }
}

/** The latest change to a group's money and who made it (null if not known). */
export function useLastChange(groupId: string): Live<{ at: Date; by: string | null } | null> {
  const live = useLive(
    `activity:${groupId}`,
    () => doc(db, "groups", groupId, "summary", "activity"),
    (_id, d) => ({ at: toDate(d.at) ?? new Date(0), by: (d.by as string | null) ?? null }),
  )
  return { data: live.data && (live.data[0] ?? null), error: live.error }
}

// ---------- Events ----------

export function useEvents(groupId: string): Live<HangoutEvent[]> {
  return useLive(
    `events:${groupId}`,
    () => query(sub(groupId, "events"), orderBy("startsAt")),
    (id, d) => ({
      id,
      title: d.title,
      startsAt: toDate(d.startsAt) ?? new Date(0),
      location: d.location,
      createdBy: d.createdBy,
    }),
  )
}

export function addEvent(
  groupId: string,
  input: { title: string; startsAt: Date; location: string },
  uid: string,
) {
  return addDoc(sub(groupId, "events"), {
    title: input.title.trim(),
    startsAt: Timestamp.fromDate(input.startsAt),
    location: input.location.trim(),
    createdBy: uid,
    createdAt: serverTimestamp(),
  })
}

export function deleteEvent(groupId: string, eventId: string) {
  return deleteDoc(doc(db, "groups", groupId, "events", eventId))
}

export function useRsvps(groupId: string, eventId: string): Live<Rsvp[]> {
  return useLive(
    `rsvps:${groupId}:${eventId}`,
    () => collection(db, "groups", groupId, "events", eventId, "rsvps"),
    (id, d) => ({ uid: id, status: d.status, name: d.name }),
  )
}

export function setRsvp(groupId: string, eventId: string, me: Me, status: RsvpStatus) {
  return setDoc(doc(db, "groups", groupId, "events", eventId, "rsvps", me.uid), {
    status,
    name: me.name,
    updatedAt: serverTimestamp(),
  })
}

/** Firestore errors => something a person can act on. */
export function dataErrorMessage(error: unknown): string {
  const code = (error as { code?: string }).code ?? ""
  if (code === "permission-denied")
    return "You don't have access to this, or the link is no longer valid."
  if (code === "unavailable")
    return "Can't reach the server. Changes will sync when you're back online."
  return "Something went wrong. Try again."
}

// ---------- Your profile ----------

/** Your profile document, or null before you've saved one (then the sign-in name is used). */
export function useMyProfile(uid: string): Live<Profile | null> {
  const live = useLive(
    `profile:${uid}`,
    () => doc(db, "users", uid),
    (_id, d) => ({
      name: d.name as string,
      altName: (d.altName as string | undefined) ?? null,
      photo: (d.photo as string | undefined) ?? null,
    }),
  )
  return { data: live.data && (live.data[0] ?? null), error: live.error }
}

/**
 * Saves your names and photo, and copies them onto your membership in every group, so members
 * see the change straight away. Groups only ever read the copy on the member document.
 */
export async function saveProfile(
  uid: string,
  name: string,
  altName: string,
  photo: string | null = null,
) {
  const trimmed = { name: name.trim(), altName: altName.trim() }
  const memberships = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", uid)))
  const batch = writeBatch(db)
  batch.set(doc(db, "users", uid), {
    name: trimmed.name,
    ...(trimmed.altName && { altName: trimmed.altName }),
    ...(photo && { photo }),
    updatedAt: serverTimestamp(),
  })
  for (const m of memberships.docs) {
    batch.update(m.ref, {
      name: trimmed.name,
      altName: trimmed.altName || deleteField(),
      photo: photo || deleteField(),
    })
  }
  await batch.commit()
}
