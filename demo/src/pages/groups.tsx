import { ChevronRight, Plus } from "lucide-react"
import * as React from "react"
import { Link, useNavigate } from "react-router"

import { Button, Empty, ErrorText, Input, Loading, Panel, useAction } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { useMe } from "@/lib/me"
import { createGroup, dataErrorMessage, useMyGroups } from "@/lib/data"

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
                <li key={g.id}>
                  <Link
                    to={`/g/${g.id}`}
                    className="flex items-center justify-between rounded-lg py-3 font-semibold hover:text-brand"
                  >
                    {g.name}
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </Link>
                </li>
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
