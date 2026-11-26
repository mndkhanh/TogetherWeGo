import { Check, Link2, RefreshCw, X } from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router"

import { useConfirm } from "@/components/confirm"
import { BalancesTab } from "@/components/balances"
import { EventsTab } from "@/components/events"
import { ExpensesTab } from "@/components/expenses"
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
  useGroup,
  useMembers,
  type Group,
  type Member,
} from "@/lib/data"

const TABS = [
  { id: "expenses", label: "Expenses" },
  { id: "balances", label: "Balances" },
  { id: "events", label: "Plans" },
] as const

type TabId = (typeof TABS)[number]["id"]

export function GroupPage() {
  const { groupId = "" } = useParams()
  const group = useGroup(groupId)
  const members = useMembers(groupId)
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
          {tab === "expenses" && <ExpensesTab groupId={groupId} members={members.data} />}
          {tab === "balances" && <BalancesTab groupId={groupId} members={members.data} />}
          {tab === "events" && <EventsTab groupId={groupId} />}
        </div>
      </div>
    </div>
  )
}

function MemberRow({ group, members }: { group: Group; members: Member[] }) {
  const user = useUser()
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

  return (
    <div className="mt-3 flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2" aria-label="Members">
        {members.map((m) => (
          <li
            key={m.uid}
            className="flex items-center gap-2 rounded-full bg-surface py-1 pr-3 pl-1 text-sm ring-1 ring-line"
          >
            <Avatar name={m.name} uid={m.uid} photo={m.photo} size="sm" />
            <span>
              {m.name}
              {m.altName && <span className="text-muted"> · {m.altName}</span>}
            </span>
            {isOwner && m.uid !== user.uid && (
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                title={`Remove ${m.name}`}
                onClick={() => void remove(m)}
                className="-mr-1 rounded-full p-0.5 text-muted hover:bg-brand-soft hover:text-ink"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {dialog}
      <ErrorText>{error}</ErrorText>
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
          copied ? "bg-owed text-white" : "bg-brand-soft text-brand hover:bg-brand hover:text-white",
        )}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
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
                {owner ? "Make a new one to invite more people." : "Ask the group's owner for a new one."}
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
