import {
  collectionGroup,
  limit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore"
import { ArrowDownLeft, ArrowUpRight, Receipt } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"

import { cx, Empty, ErrorText, Loading, Panel, ShowOlder } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { db } from "@/lib/firebase"
import {
  dataErrorMessage,
  PAGE_SIZE,
  toExpense,
  toPayment,
  useBalances,
  useLive,
  useMembers,
  useMyGroups,
  type Expense,
  type Group,
  type Payment,
} from "@/lib/data"
import { expenseShares, formatVnd } from "@/lib/money"
import { toSettlement, type Settlement } from "@/lib/payments"

/** One line of your history, from any group. */
interface Item {
  id: string
  groupId: string
  groupName: string
  kind: "expense" | "paid" | "received"
  title: string
  detail: string
  /** What it did to your balance: + the group owes you more, − you owe more. */
  effect: number
  /** The bill's total for expenses; the amount for payments. */
  amount: number
  /** Your part of an expense; 0 for payments. */
  share: number
  at: Date
}

/**
 * Everything that involves you across your groups, newest first: expenses you paid or have a
 * share in, and money you sent or received (cash, or by bank through SePay). Read with one query
 * per kind across all groups, a page at a time, so it stays quick however long you've used the app.
 */
export function ActivityPage() {
  const user = useUser()
  const groups = useMyGroups(user.uid)
  const [pages, setPages] = React.useState(1)
  const feed = useMyEntries(user.uid, pages * PAGE_SIZE)
  const [byGroup, setByGroup] = React.useState<Record<string, GroupInfo | undefined>>({})
  const [filter, setFilter] = React.useState("all")

  const report = React.useCallback(
    (groupId: string, info: GroupInfo | undefined) =>
      setByGroup((prev) => (prev[groupId] === info ? prev : { ...prev, [groupId]: info })),
    [],
  )

  if (groups.error) return <ErrorText>{dataErrorMessage(groups.error)}</ErrorText>
  if (feed.error) return <ErrorText>{dataErrorMessage(feed.error)}</ErrorText>
  if (!groups.data) return <Loading />

  const shown = groups.data.filter((g) => filter === "all" || g.id === filter)
  const loading = !feed.data || shown.some((g) => byGroup[g.id] === undefined)
  const items = loading ? [] : toItems(feed.data ?? [], shown, byGroup, user.uid)
  // Your share of everything spent, from each group's running totals (not just what's shown).
  const myShare = shown.reduce((sum, g) => sum + (byGroup[g.id]?.spent ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      {groups.data.map((g) => (
        <GroupInfoFeed key={g.id} groupId={g.id} onInfo={report} />
      ))}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Your activity</h1>
          <p className="mt-1 text-sm text-muted">
            What you paid, your shares, and money you sent or got, across your groups.
          </p>
        </div>
        {groups.data.length > 1 && (
          <select
            aria-label="Group"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 rounded-lg bg-surface px-3 text-sm font-semibold ring-1 ring-line"
          >
            <option value="all">All groups</option>
            {groups.data.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <Panel>
        {groups.data.length === 0 ? (
          <Empty>You're not in any groups yet.</Empty>
        ) : loading ? (
          <Loading />
        ) : items.length === 0 && !feed.more ? (
          <Empty>Nothing yet. Expenses and payments that involve you show up here.</Empty>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Your share of spending:{" "}
              <span className="font-semibold text-ink tabular-nums">{formatVnd(myShare)}</span>
            </p>
            <Timeline items={items} showGroup={filter === "all" && groups.data.length > 1} />
            {feed.more && <ShowOlder onClick={() => setPages(pages + 1)} />}
          </>
        )}
      </Panel>
    </div>
  )
}

/** Names in a group, and your share of all its spending. */
interface GroupInfo {
  names: Map<string, string>
  spent: number
}

function GroupInfoFeed({
  groupId,
  onInfo,
}: {
  groupId: string
  onInfo: (groupId: string, info: GroupInfo | undefined) => void
}) {
  const user = useUser()
  const members = useMembers(groupId)
  const balances = useBalances(groupId)
  const spent = balances.data?.spent.get(user.uid)
  const info = React.useMemo(() => {
    // A group that can't be read (you were just removed, say) simply adds nothing.
    if (members.error) return { names: new Map<string, string>(), spent: 0 }
    if (!members.data) return undefined
    return { names: new Map(members.data.map((m) => [m.uid, m.name])), spent: spent ?? 0 }
  }, [members, spent])
  React.useEffect(() => onInfo(groupId, info), [onInfo, groupId, info])
  return null
}

type Entry =
  | { kind: "expense"; groupId: string; at: Date; expense: Expense }
  | { kind: "payment"; groupId: string; at: Date; payment: Payment }
  | { kind: "settlement"; groupId: string; at: Date; settlement: Settlement }

const groupOf = (path: string) => path.split("/")[1] ?? ""
const dayOf = (spentOn: string) => new Date(`${spentOn}T12:00`)

/**
 * Your entries from all groups, merged. Each of the six queries returns its newest `max`; where
 * one has more, anything older than its last row might be missing, so the list stops there and
 * "Show older" asks for more.
 */
function useMyEntries(uid: string, max: number) {
  const expense = (path: string, id: string, d: DocumentData): Entry => ({
    kind: "expense",
    groupId: groupOf(path),
    at: dayOf(d.spentOn),
    expense: toExpense(id, d),
  })
  const payment = (path: string, id: string, d: DocumentData): Entry => {
    const p = toPayment(id, d)
    return { kind: "payment", groupId: groupOf(path), at: p.createdAt ?? new Date(), payment: p }
  }
  const settlement = (path: string, id: string, d: DocumentData): Entry => {
    const s = toSettlement(id, d)
    return {
      kind: "settlement",
      groupId: groupOf(path),
      at: s.confirmedAt ?? s.createdAt ?? new Date(),
      settlement: s,
    }
  }
  const confirmed = where("status", "==", "confirmed")
  const streams = [
    {
      map: expense,
      live: useStreamPaths(
        `mine:e:in:${uid}`,
        "expenses",
        [where("participants", "array-contains", uid), orderBy("spentOn", "desc")],
        max,
      ),
    },
    {
      map: expense,
      live: useStreamPaths(
        `mine:e:paid:${uid}`,
        "expenses",
        [where("paidBy", "==", uid), orderBy("spentOn", "desc")],
        max,
      ),
    },
    {
      map: payment,
      live: useStreamPaths(
        `mine:p:from:${uid}`,
        "payments",
        [where("from", "==", uid), orderBy("createdAt", "desc")],
        max,
      ),
    },
    {
      map: payment,
      live: useStreamPaths(
        `mine:p:to:${uid}`,
        "payments",
        [where("to", "==", uid), orderBy("createdAt", "desc")],
        max,
      ),
    },
    {
      map: settlement,
      live: useStreamPaths(
        `mine:s:from:${uid}`,
        "settlements",
        [where("from", "==", uid), confirmed, orderBy("confirmedAt", "desc")],
        max,
      ),
    },
    {
      map: settlement,
      live: useStreamPaths(
        `mine:s:to:${uid}`,
        "settlements",
        [where("to", "==", uid), confirmed, orderBy("confirmedAt", "desc")],
        max,
      ),
    },
  ]

  const error = streams.find((s) => s.live.error)?.live.error ?? null
  if (error) return { data: undefined, error, more: false }
  if (streams.some((s) => !s.live.data)) return { data: undefined, error: null, more: false }

  let cutoff = -Infinity
  const seen = new Set<string>()
  const entries: Entry[] = []
  for (const { map, live } of streams) {
    const rows = live.data ?? []
    const kept = rows.slice(0, max).map((r) => map(r.path, r.id, r.d))
    if (rows.length > max) cutoff = Math.max(cutoff, kept[kept.length - 1]?.at.getTime() ?? cutoff)
    for (const e of kept) {
      // You can be both the payer and in the split: the same expense from two queries.
      const key = `${e.groupId}/${e.kind}/${e.kind === "expense" ? e.expense.id : e.kind === "payment" ? e.payment.id : e.settlement.id}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(e)
    }
  }
  return {
    // Deleted expenses count for nothing; their group's history still shows them.
    data: entries.filter(
      (e) => e.at.getTime() > cutoff && !(e.kind === "expense" && e.expense.deletedAt),
    ),
    error: null,
    more: cutoff > -Infinity,
  }
}

/** A collection group query whose rows keep their path (which group they're in). */
function useStreamPaths(
  key: string,
  name: "expenses" | "payments" | "settlements",
  constraints: QueryConstraint[],
  max: number,
) {
  return useLive(
    `${key}:${max}`,
    () => query(collectionGroup(db, name), ...constraints, limit(max + 1)),
    (id, d, path) => ({ id, d, path }),
  )
}

function toItems(
  entries: Entry[],
  groups: Group[],
  info: Record<string, GroupInfo | undefined>,
  me: string,
): Item[] {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const out: Item[] = []
  for (const e of entries) {
    const group = byId.get(e.groupId)
    if (!group) continue
    const names = info[e.groupId]?.names
    const name = (uid: string) => names?.get(uid) ?? "a former member"
    if (e.kind === "expense") {
      const x = e.expense
      const share = expenseShares(x).get(me) ?? 0
      if (x.paidBy !== me && share === 0) continue
      out.push({
        id: x.id,
        groupId: group.id,
        groupName: group.name,
        kind: "expense",
        title: x.description,
        detail:
          x.paidBy === me
            ? share > 0
              ? `You paid · your share ${formatVnd(share)}`
              : "You paid · not in the split"
            : `${name(x.paidBy)} paid · your share ${formatVnd(share)}`,
        effect: x.paidBy === me ? x.amount - share : -share,
        amount: x.amount,
        share,
        at: e.at,
      })
      continue
    }
    const p =
      e.kind === "payment"
        ? {
            id: e.payment.id,
            from: e.payment.from,
            to: e.payment.to,
            amount: e.payment.amount,
            how: e.payment.note ? `cash · ${e.payment.note}` : "cash",
          }
        : {
            id: e.settlement.id,
            from: e.settlement.from,
            to: e.settlement.to,
            amount: e.settlement.paidAmount ?? e.settlement.amount,
            how: "bank transfer",
          }
    const paid = p.from === me
    out.push({
      id: p.id,
      groupId: group.id,
      groupName: group.name,
      kind: paid ? "paid" : "received",
      title: paid ? `You paid ${name(p.to)}` : `${name(p.from)} paid you`,
      detail: p.how,
      effect: paid ? p.amount : -p.amount,
      amount: p.amount,
      share: 0,
      at: e.at,
    })
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}

function Timeline({ items, showGroup }: { items: Item[]; showGroup: boolean }) {
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "long", year: "numeric" })
  let lastMonth = ""
  return (
    <ol className="flex flex-col">
      {items.map((i) => {
        const heading = month(i.at)
        const showHeading = heading !== lastMonth
        lastMonth = heading
        const Icon =
          i.kind === "expense" ? Receipt : i.kind === "paid" ? ArrowUpRight : ArrowDownLeft
        return (
          <React.Fragment key={`${i.groupId}/${i.id}`}>
            {showHeading && (
              <li className="mt-3 border-b border-line pb-1 text-xs font-semibold text-muted first:mt-0">
                {heading}
              </li>
            )}
            <li className="flex items-start gap-3 border-b border-line py-3 last:border-0">
              <span
                className={cx(
                  "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                  i.kind === "expense"
                    ? "bg-brand-soft text-brand"
                    : "bg-canvas text-muted ring-1 ring-line",
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{i.title}</p>
                <p className="text-xs text-muted">
                  {i.detail} ·{" "}
                  {i.at.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  {showGroup && (
                    <>
                      {" · "}
                      <Link to={`/g/${i.groupId}`} className="font-medium hover:text-brand">
                        {i.groupName}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold tabular-nums">{formatVnd(i.amount)}</p>
                {i.effect !== 0 && (
                  <p
                    className={cx("text-xs tabular-nums", i.effect > 0 ? "text-owed" : "text-owe")}
                  >
                    {i.kind === "expense"
                      ? i.effect > 0
                        ? `you lent ${formatVnd(i.effect)}`
                        : `you owe ${formatVnd(-i.effect)}`
                      : i.kind === "paid"
                        ? "you paid"
                        : "you got"}
                  </p>
                )}
              </div>
            </li>
          </React.Fragment>
        )
      })}
    </ol>
  )
}
