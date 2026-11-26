import { ArrowDownLeft, ArrowUpRight, Receipt } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"

import { cx, Empty, ErrorText, Loading, Panel } from "@/components/ui"
import { useUser } from "@/lib/auth"
import {
  dataErrorMessage,
  useExpenses,
  useMembers,
  useMyGroups,
  usePayments,
  type Group,
} from "@/lib/data"
import { expenseShares, formatVnd } from "@/lib/money"
import { useSettlements } from "@/lib/payments"

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
 * share in, and money you sent or received (cash, or by bank through SePay).
 */
export function ActivityPage() {
  const user = useUser()
  const groups = useMyGroups(user.uid)
  const [byGroup, setByGroup] = React.useState<Record<string, Item[] | undefined>>({})
  const [filter, setFilter] = React.useState("all")

  const report = React.useCallback(
    (groupId: string, items: Item[] | undefined) =>
      setByGroup((prev) => (prev[groupId] === items ? prev : { ...prev, [groupId]: items })),
    [],
  )

  if (groups.error) return <ErrorText>{dataErrorMessage(groups.error)}</ErrorText>
  if (!groups.data) return <Loading />

  const shown = groups.data.filter((g) => filter === "all" || g.id === filter)
  const loading = shown.some((g) => byGroup[g.id] === undefined)
  const items = shown
    .flatMap((g) => byGroup[g.id] ?? [])
    .sort((a, b) => b.at.getTime() - a.at.getTime())
  const myShare = items
    .filter((i) => i.kind === "expense")
    .reduce((sum, i) => sum + i.share, 0)

  return (
    <div className="flex flex-col gap-6">
      {groups.data.map((g) => (
        <GroupFeed key={g.id} group={g} onItems={report} />
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
        ) : loading && items.length === 0 ? (
          <Loading />
        ) : items.length === 0 ? (
          <Empty>Nothing yet. Expenses and payments that involve you show up here.</Empty>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              Your share of spending:{" "}
              <span className="font-semibold text-ink tabular-nums">{formatVnd(myShare)}</span>
            </p>
            <Timeline items={items} showGroup={filter === "all" && groups.data.length > 1} />
          </>
        )}
      </Panel>
    </div>
  )
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
        const Icon = i.kind === "expense" ? Receipt : i.kind === "paid" ? ArrowUpRight : ArrowDownLeft
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
                  i.kind === "expense" ? "bg-brand-soft text-brand" : "bg-canvas text-muted ring-1 ring-line",
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

/** Reads one group's expenses and payments and hands the ones involving you to the page. */
function GroupFeed({
  group,
  onItems,
}: {
  group: Group
  onItems: (groupId: string, items: Item[] | undefined) => void
}) {
  const user = useUser()
  const expenses = useExpenses(group.id)
  const payments = usePayments(group.id)
  const settlements = useSettlements(group.id)
  const members = useMembers(group.id)

  const items = React.useMemo(() => {
    // A group that can't be read (you were just removed, say) simply adds nothing.
    if (expenses.error || payments.error || members.error) return []
    if (!expenses.data || !payments.data || !members.data) return undefined
    const me = user.uid
    const names = new Map(members.data.map((m) => [m.uid, m.name]))
    const name = (uid: string) => names.get(uid) ?? "a former member"
    const out: Item[] = []

    for (const e of expenses.data) {
      const share = expenseShares(e).get(me) ?? 0
      if (e.paidBy !== me && share === 0) continue
      out.push({
        id: e.id,
        groupId: group.id,
        groupName: group.name,
        kind: "expense",
        title: e.description,
        detail:
          e.paidBy === me
            ? share > 0
              ? `You paid · your share ${formatVnd(share)}`
              : "You paid · not in the split"
            : `${name(e.paidBy)} paid · your share ${formatVnd(share)}`,
        effect: e.paidBy === me ? e.amount - share : -share,
        amount: e.amount,
        share,
        at: new Date(`${e.spentOn}T12:00`),
      })
    }

    const money = [
      ...payments.data.map((p) => ({
        id: p.id,
        from: p.from,
        to: p.to,
        amount: p.amount,
        at: p.createdAt,
        how: p.note ? `cash · ${p.note}` : "cash",
      })),
      ...(settlements.data ?? [])
        .filter((s) => s.status === "confirmed")
        .map((s) => ({
          id: s.id,
          from: s.from,
          to: s.to,
          amount: s.paidAmount ?? s.amount,
          at: s.confirmedAt ?? s.createdAt,
          how: "bank transfer",
        })),
    ]
    for (const p of money) {
      if (p.from !== me && p.to !== me) continue
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
        at: p.at ?? new Date(),
      })
    }
    return out
  }, [expenses, payments, settlements.data, members, user.uid, group.id, group.name])

  React.useEffect(() => onItems(group.id, items), [onItems, group.id, items])
  return null
}
