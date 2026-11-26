import * as React from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router"

import { Button, ErrorText, Loading, Panel, useAction } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { useMe } from "@/lib/me"
import {
  dataErrorMessage,
  groupForInvite,
  inviteExpired,
  isMemberOf,
  joinGroup,
  normaliseInviteCode,
} from "@/lib/data"

/** /j/K7P3QX9M: the short link. The code says which group. */
export function ShortJoinPage() {
  const { code: raw = "" } = useParams()
  const code = normaliseInviteCode(raw)
  const [invite, setInvite] = React.useState<
    Awaited<ReturnType<typeof groupForInvite>> | undefined
  >(undefined)

  React.useEffect(() => {
    if (!code) return
    let cancelled = false
    groupForInvite(code).then(
      (found) => !cancelled && setInvite(found),
      () => !cancelled && setInvite(null),
    )
    return () => {
      cancelled = true
    }
  }, [code])

  if (!code || invite === null) return <LinkGone />
  if (invite === undefined) return <Loading />
  // Members can still open an old link to get to their group; Join sends them straight there.
  return <Join groupId={invite.groupId} code={code} expired={inviteExpired(invite.expiresAt)} />
}

/** /join/:groupId/:code: links made before short codes. */
export function JoinPage() {
  const { groupId = "", code = "" } = useParams()
  return <Join groupId={groupId} code={code} />
}

function Join({
  groupId,
  code,
  expired = false,
}: {
  groupId: string
  code: string
  expired?: boolean
}) {
  const user = useUser()
  const me = useMe()
  const navigate = useNavigate()
  const [already, setAlready] = React.useState<boolean | null>(null)
  const { busy, error, run } = useAction()

  React.useEffect(() => {
    let cancelled = false
    isMemberOf(groupId, user.uid).then(
      (member) => !cancelled && setAlready(member),
      () => !cancelled && setAlready(false),
    )
    return () => {
      cancelled = true
    }
  }, [groupId, user.uid])

  if (already === null || !me.ready) return <Loading />
  if (already) return <Navigate to={`/g/${groupId}`} replace />
  if (expired) return <LinkGone expired />

  const join = async () => {
    const ok = await run(
      () => joinGroup(groupId, code, me),
      (e) =>
        (e as { code?: string }).code === "permission-denied"
          ? "This invite has expired or been replaced. Ask a member for a new link."
          : dataErrorMessage(e),
    )
    if (ok) navigate(`/g/${groupId}`, { replace: true })
  }

  return (
    <Panel className="mx-auto max-w-md text-center">
      <h1 className="text-xl font-extrabold">You've been invited to a group</h1>
      <p className="mt-2 text-sm text-muted">
        You'll join as <span className="font-semibold text-ink">{me.name}</span>
        {me.altName && <span> ({me.altName})</span>}. Members see each other's names, expenses and
        plans.
      </p>
      <div className="mt-5 flex flex-col gap-3">
        <ErrorText>{error}</ErrorText>
        <Button onClick={() => void join()} disabled={busy}>
          Join group
        </Button>
        <Link to="/" className="text-sm text-muted hover:text-ink">
          Not now
        </Link>
      </div>
    </Panel>
  )
}

function LinkGone({ expired = false }: { expired?: boolean }) {
  return (
    <Panel className="mx-auto max-w-md text-center">
      <h1 className="text-xl font-extrabold">
        {expired ? "This invite has expired" : "This invite doesn't work"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {expired
          ? "Invite links only work for a while. Ask a member to send you a new one."
          : "The code is wrong, or the group has made a new one. Ask a member for the current link."}
      </p>
      <Link to="/" className="mt-4 inline-block text-sm font-semibold text-brand">
        Back to your groups
      </Link>
    </Panel>
  )
}
