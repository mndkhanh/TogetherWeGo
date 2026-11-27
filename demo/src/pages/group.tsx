import { ArrowRight, Check, CircleCheck, Circle, Link2, RefreshCw, X } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router"

import { useConfirm } from "@/components/confirm"
import { BalancesTab, Updating } from "@/components/balances"
import { EventsTab } from "@/components/events"
import { ExpensesTab } from "@/components/expenses"
import { Sheet } from "@/components/sheet"
import { Avatar, Button, cx, ErrorText, Loading, Panel, useAction } from "@/components/ui"
import { useUser } from "@/lib/auth"
import {
  dataErrorMessage,
  DEFAULT_INVITE_HOURS,
  INVITE_DURATIONS,
  inviteExpired,
  inviteLink,
  removeMember,
  replaceInviteCode,
  useBalances,
  useGroup,
  useMembers,
  type Balances,
  type Group,
  type Member,
} from "@/lib/data"
import { formatVnd, simplifyDebts } from "@/lib/money"
import { usePaymentAccount } from "@/lib/payments"
import { useLastVisit } from "@/lib/seen"

const TABS = [
  { id: "expenses", label: "Expenses" },
  { id: "balances", label: "Balances" },
  { id: "events", label: "Plans" },
] as const

type TabId = (typeof TABS)[number]["id"]

export function GroupPage() {
  const { groupId = "" } = useParams()
  const user = useUser()
  const group = useGroup(groupId)
  const members = useMembers(groupId)
  const balances = useBalances(groupId)
  const newSince = useLastVisit(user.uid, groupId)
  const [tab, setTab] = React.useState<TabId>("expenses")

  if (group.error || group.data === null) {
    return (
      <Panel className="text-center">
        <p className="text-sm text-muted">
          This group doesn't exist, or you're not a member. Ask a member for an invite link.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm font-semibold text-brand">
          Back to your groups
        </Link>
      </Panel>
    )
  }
  if (!group.data || !members.data) return <Loading />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 text-2xl font-extrabold tracking-tight">{group.data.name}</h1>
          <InviteButton group={group.data} />
        </div>
        <MemberRow group={group.data} members={members.data} />
      </div>

      {balances.data && (
        <>
          <GettingStarted group={group.data} members={members.data} balances={balances.data} />
          <YourBalance
            members={members.data}
            balances={balances.data}
            onSettle={() => setTab("balances")}
            settling={tab === "balances"}
          />
        </>
      )}

      <div>
        <div role="tablist" aria-label="Group sections" className="flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cx(
                "-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                tab === t.id
                  ? "border-brand text-brand"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
          {tab === "expenses" && (
            <ExpensesTab groupId={groupId} members={members.data} newSince={newSince} />
          )}
          {tab === "balances" && <BalancesTab groupId={groupId} members={members.data} />}
          {tab === "events" && <EventsTab groupId={groupId} />}
        </div>
      </div>
    </div>
  )
}

/**
 * The answer people open the group for: who you owe, and who owes you. One line each, from the
 * same settle-up plan as the Balances tab.
 */
function YourBalance({
  members,
  balances,
  onSettle,
  settling,
}: {
  members: Member[]
  balances: Balances
  onSettle: () => void
  settling: boolean
}) {
  const user = useUser()
  const names = new Map(members.map((m) => [m.uid, m.name]))
  const name = (uid: string) => names.get(uid) ?? "a former member"
  const mine = simplifyDebts(balances.net).filter((t) => t.from === user.uid || t.to === user.uid)
  const owe = mine.filter((t) => t.from === user.uid)
  if (balances.expenseCount === 0) return null

  return (
    <section
      aria-label="Your balance"
      className={cx(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl px-5 py-4",
        owe.length > 0
          ? "bg-owe/10"
          : mine.length > 0
            ? "bg-owed/10"
            : "bg-surface ring-1 ring-line",
      )}
    >
      {mine.length === 0 ? (
        <p className="text-sm font-semibold">You're all square here.</p>
      ) : (
        <ul className="flex flex-1 flex-col gap-1">
          {mine.map((t) =>
            t.from === user.uid ? (
              <li key={t.to} className="text-sm">
                You owe <span className="font-semibold">{name(t.to)}</span>{" "}
                <span className="font-bold text-owe tabular-nums">{formatVnd(t.amount)}</span>
              </li>
            ) : (
              <li key={t.from} className="text-sm">
                <span className="font-semibold">{name(t.from)}</span> owes you{" "}
                <span className="font-bold text-owed tabular-nums">{formatVnd(t.amount)}</span>
              </li>
            ),
          )}
        </ul>
      )}
      {balances.updating && <Updating />}
      {mine.length > 0 && !settling && (
        <Button size="sm" variant={owe.length > 0 ? "primary" : "secondary"} onClick={onSettle}>
          {owe.length > 0 ? "Pay back" : "Settle up"}
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      )}
    </section>
  )
}

/**
 * A new group's first steps, ticked off as they happen: friends in, a first expense, and a way
 * to get paid back. Gone once all three are done, or when hidden.
 */
function GettingStarted({
  group,
  members,
  balances,
}: {
  group: Group
  members: Member[]
  balances: Balances
}) {
  const user = useUser()
  const account = usePaymentAccount(user.uid)
  const hiddenKey = `twg:started-hidden:${group.id}`
  const [hidden, setHidden] = React.useState(() => localStorage.getItem(hiddenKey) !== null)
  if (account.data === undefined) return null

  const steps = [
    {
      done: members.length > 1,
      title: "Invite your friends",
      how: (
        <>
          Tap <Link2 className="inline size-3.5 align-[-2px]" aria-label="the link button" /> next
          to the group's name to copy the invite link.
        </>
      ),
    },
    {
      done: balances.expenseCount > 0,
      title: "Add the first expense",
      how: "What it was for, how much, and who's in. That's all it needs.",
    },
    {
      done: account.data !== null,
      title: "Set how you get paid back",
      how: (
        <>
          Add your bank account on{" "}
          <Link to="/settings/payments" className="font-semibold text-brand">
            Getting paid
          </Link>{" "}
          so friends can pay you by QR code.
        </>
      ),
    },
  ]
  if (hidden || steps.every((s) => s.done)) return null

  return (
    <Panel
      title="Getting started"
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            localStorage.setItem(hiddenKey, new Date().toISOString())
            setHidden(true)
          }}
        >
          Hide
        </Button>
      }
    >
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-2.5">
            {s.done ? (
              <CircleCheck className="mt-0.5 size-5 shrink-0 text-owed" aria-label="Done" />
            ) : (
              <Circle className="mt-0.5 size-5 shrink-0 text-line" aria-label="To do" />
            )}
            <div className="text-sm">
              <p className={cx("font-semibold", s.done && "text-muted line-through")}>{s.title}</p>
              {!s.done && <p className="text-xs text-muted">{s.how}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/** How many faces show before the rest fold into "+N". */
const MAX_FACES = 5

/** The group's faces, overlapping; a tap opens the full list (and, for the owner, Remove). */
function MemberRow({ group, members }: { group: Group; members: Member[] }) {
  const user = useUser()
  const [open, setOpen] = React.useState(false)
  const { error, run } = useAction()
  const { confirm, dialog } = useConfirm()
  const isOwner = group.ownerId === user.uid

  const remove = async (m: Member) => {
    const ok = await confirm({
      title: `Remove ${m.name}?`,
      body: "They lose access to the group straight away. What they added stays, and your invite link changes so the old one can't bring them back.",
      action: "Remove",
    })
    if (ok) void run(() => removeMember(group, m.uid), dataErrorMessage)
  }

  const shown = members.slice(0, MAX_FACES)
  const extra = members.length - shown.length

  return (
    <div className="mt-3 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${members.length} member${members.length === 1 ? "" : "s"}: show all`}
        title={members.map((m) => m.name).join(", ")}
        className="flex w-fit items-center rounded-full p-0.5 hover:bg-brand-soft"
      >
        {shown.map((m, i) => (
          <span key={m.uid} className={cx("rounded-full ring-2 ring-canvas", i > 0 && "-ml-2")}>
            <Avatar name={m.name} uid={m.uid} photo={m.photo} size="sm" />
          </span>
        ))}
        {extra > 0 && (
          <span className="-ml-2 inline-flex size-7 items-center justify-center rounded-full bg-brand-soft text-[0.65rem] font-bold text-ink ring-2 ring-canvas">
            +{extra}
          </span>
        )}
      </button>

      {open && (
        <Sheet title={`Members (${members.length})`} onClose={() => setOpen(false)}>
          <ul className="flex flex-col divide-y divide-line" aria-label="Members">
            {members.map((m) => (
              <li key={m.uid} className="flex items-center gap-3 py-2.5">
                <Avatar name={m.name} uid={m.uid} photo={m.photo} />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate font-semibold">
                    {m.name}
                    {m.uid === user.uid && <span className="font-normal text-muted"> (you)</span>}
                  </p>
                  {(m.altName || m.uid === group.ownerId) && (
                    <p className="truncate text-xs text-muted">
                      {[m.altName, m.uid === group.ownerId && "Created the group"]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                {isOwner && m.uid !== user.uid && (
                  <button
                    type="button"
                    aria-label={`Remove ${m.name}`}
                    title={`Remove ${m.name}`}
                    onClick={() => void remove(m)}
                    className="rounded-full p-1.5 text-muted hover:bg-brand-soft hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <ErrorText>{error}</ErrorText>
        </Sheet>
      )}
      {dialog}
    </div>
  )
}

/** The current time, refreshed every minute so "expires in" stays right. */
function useNow(): number {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function timeLeft(ms: number): string {
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`
  return `${Math.round(hours / 24)} days`
}

/**
 * One round button beside the group's name. A click copies the invite link and opens a small
 * card: how long the link still works, and for the owner, a new link with its own lifetime.
 */
function InviteButton({ group }: { group: Group }) {
  const user = useUser()
  const now = useNow()
  const [open, setOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [hours, setHours] = React.useState<number>(DEFAULT_INVITE_HOURS)
  const { busy, error, run } = useAction()
  const box = React.useRef<HTMLDivElement>(null)
  const link = inviteLink(group)
  const owner = group.ownerId === user.uid
  const expires = group.inviteExpiresAt
  const expired = inviteExpired(expires, now)

  // Close on a click outside or Escape.
  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an older browser, or not allowed): the link is in the card to copy by hand.
    }
  }

  const toggle = () => {
    if (!open && !expired) void copy()
    setOpen(!open)
  }

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={expired ? "Invite link expired" : "Copy invite link"}
        title={expired ? "Invite link expired" : "Copy invite link"}
        className={cx(
          "relative inline-flex size-9 items-center justify-center rounded-full transition-colors",
          copied
            ? "bg-owed text-white"
            : "bg-brand-soft text-brand hover:bg-brand hover:text-white",
        )}
      >
        {copied ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Link2 className="size-4" aria-hidden />
        )}
        {expired && (
          <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-owe ring-2 ring-canvas" />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Invite link"
          className="absolute top-11 left-0 z-20 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-2xl bg-surface p-4 shadow-lg ring-1 ring-line"
        >
          {expired ? (
            <div>
              <p className="text-sm font-semibold">The invite link has expired</p>
              <p className="text-xs text-muted">
                {owner
                  ? "Make a new one to invite more people."
                  : "Ask the group's owner for a new one."}
              </p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-semibold">{copied ? "Link copied" : "Invite link"}</p>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs text-muted select-all">{link}</p>
                <Button size="sm" variant="ghost" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              {expires && (
                <p className="text-xs text-muted" title={expires.toLocaleString()}>
                  Works for {timeLeft(expires.getTime() - now)} more
                </p>
              )}
            </div>
          )}

          {owner && (
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <select
                aria-label="New link works for"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
                className="h-8 rounded-lg bg-surface px-2 text-xs font-semibold ring-1 ring-line"
              >
                {INVITE_DURATIONS.map((d) => (
                  <option key={d.hours} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant={expired ? "primary" : "secondary"}
                disabled={busy}
                title="The current link stops working"
                onClick={() =>
                  void run(async () => {
                    await replaceInviteCode(group, hours)
                  }, dataErrorMessage)
                }
              >
                <RefreshCw className="size-3.5" aria-hidden />
                New link
              </Button>
            </div>
          )}
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  )
}
