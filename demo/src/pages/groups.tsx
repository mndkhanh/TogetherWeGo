import { ChevronRight, Plus } from "lucide-react"
import * as React from "react"
import { Link, useNavigate } from "react-router"

import { Button, cx, Empty, ErrorText, Input, Loading, Panel, useAction } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { useMe } from "@/lib/me"
import {
  createGroup,
  dataErrorMessage,
  useBalances,
  useLastChange,
  useMyGroups,
  type Group,
} from "@/lib/data"
import { formatVnd } from "@/lib/money"
import { lastSeen } from "@/lib/seen"

export function GroupsPage() {
  const user = useUser()
  const me = useMe()
  const groups = useMyGroups(user.uid)
  const navigate = useNavigate()
  const [name, setName] = React.useState("")
  const { busy, error, run } = useAction()

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    let id = ""
    const ok = await run(async () => {
      id = await createGroup(name, me)
    }, dataErrorMessage)
    if (ok) navigate(`/g/${id}`)
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-extrabold tracking-tight">Your groups</h1>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel>
          {groups.error ? (
            <ErrorText>{dataErrorMessage(groups.error)}</ErrorText>
          ) : !groups.data ? (
            <Loading />
          ) : groups.data.length === 0 ? (
            <Empty>No groups yet. Start one, or open an invite link from a friend.</Empty>
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {groups.data.map((g) => (
                <GroupRow key={g.id} group={g} />
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Start a group">
            <form onSubmit={create} className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Input
                aria-label="Group name"
                placeholder="Đà Lạt trip, flatmates, Friday futsal…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
              <Button type="submit" disabled={busy || !name.trim()} className="shrink-0">
                <Plus className="size-4" aria-hidden />
                Create group
              </Button>
            </form>
            <div className="mt-3">
              <ErrorText>{error}</ErrorText>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

/** A group, where you stand in it, and a dot when someone else changed its money since your last visit. */
function GroupRow({ group }: { group: Group }) {
  const user = useUser()
  const balances = useBalances(group.id)
  const change = useLastChange(group.id)
  const mine = balances.data?.net.get(user.uid) ?? 0
  const seen = lastSeen(user.uid, group.id)
  const fresh =
    change.data != null && change.data.by !== user.uid && (!seen || change.data.at > seen)
  return (
    <li>
      <Link
        to={`/g/${group.id}`}
        className="flex items-center gap-3 rounded-lg py-3 hover:text-brand"
      >
        <span className="min-w-0 flex-1 truncate font-semibold">{group.name}</span>
        {fresh && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <span className="size-2 rounded-full bg-marigold" aria-hidden />
            New
          </span>
        )}
        {balances.data && (
          <span
            className={cx(
              "text-sm tabular-nums",
              mine > 0 ? "text-owed" : mine < 0 ? "text-owe" : "text-muted",
            )}
          >
            {mine > 0
              ? `owed ${formatVnd(mine)}`
              : mine < 0
                ? `you owe ${formatVnd(-mine)}`
                : "all square"}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  )
}
