import { roleAtLeast } from "@twg/shared"
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  EllipsisIcon,
  LogOutIcon,
  PencilIcon,
  SearchXIcon,
} from "lucide-react"
import * as React from "react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { ConfirmDialog, type ConfirmRequest } from "@/components/confirm-dialog"
import { EditGroupDialog } from "@/components/group/edit-group-dialog"
import { InviteCard } from "@/components/group/invite-card"
import { MembersCard } from "@/components/group/members-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api"
import { formErrorMessage } from "@/lib/form-errors"
import { useGroup, useRemoveMember, useSetArchived } from "@/lib/groups"

function BackLink() {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-fit"
      render={<Link to="/" />}
      nativeButton={false}
    >
      <ArrowLeftIcon data-icon="inline-start" />
      All groups
    </Button>
  )
}

function GroupNotFound() {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchXIcon />
        </EmptyMedia>
        <EmptyTitle>You're not in this group</EmptyTitle>
        <EmptyDescription>
          It may have been deleted, or you left or were removed. Ask a member for a new invite link.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          Go to your groups
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function GroupPage() {
  const { groupId = "" } = useParams()
  const me = useMe()
  const navigate = useNavigate()
  const group = useGroup(groupId)
  const setArchived = useSetArchived(groupId)
  const removeMember = useRemoveMember(groupId)
  const [editing, setEditing] = React.useState(false)
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null)

  if (group.isPending) {
    return (
      <AppShell>
        <BackLink />
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </AppShell>
    )
  }

  if (group.isError) {
    const notFound =
      group.error instanceof ApiError && (group.error.status === 404 || group.error.status === 400)
    return (
      <AppShell>
        <BackLink />
        {notFound ? (
          <GroupNotFound />
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              Couldn't load this group.
              <Button variant="outline" size="sm" onClick={() => void group.refetch()}>
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </AppShell>
    )
  }

  const data = group.data
  const isAdmin = roleAtLeast(data.myRole, "admin")
  const isOwner = data.myRole === "owner"
  const archived = data.archivedAt !== null

  function confirmArchive(next: boolean) {
    setConfirm({
      title: next ? `Archive ${data.name}?` : `Unarchive ${data.name}?`,
      description: next
        ? "Nobody can change the group or join it while it's archived. You can unarchive it at any time."
        : "Members can make changes and use invite links again.",
      confirmLabel: next ? "Archive group" : "Unarchive group",
      onConfirm: async () => {
        try {
          await setArchived.mutateAsync(next)
          toast.success(next ? "Group archived" : "Group unarchived")
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Something went wrong. Try again.")
          throw error
        }
      },
    })
  }

  function confirmLeave() {
    setConfirm({
      title: `Leave ${data.name}?`,
      description: "You'll need a new invite link to join again.",
      confirmLabel: "Leave group",
      destructive: true,
      onConfirm: async () => {
        try {
          await removeMember.mutateAsync(me.id)
          toast.success(`You left ${data.name}`)
          navigate("/", { replace: true })
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Couldn't leave the group. Try again.")
          throw error
        }
      },
    })
  }

  return (
    <AppShell>
      <BackLink />

      <section className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight break-words sm:text-4xl">
              {data.name}
            </h1>
            {archived && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="text-muted-foreground">
            {data.memberCount === 1 ? "1 member" : `${data.memberCount} members`}, expenses in{" "}
            {data.currency}
          </p>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon-lg" />}
            aria-label="Group options"
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            {isAdmin && !archived && (
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit group
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}
            {isOwner && (
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => confirmArchive(!archived)}>
                  {archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
                  {archived ? "Unarchive group" : "Archive group"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}
            {!isOwner && (
              <>
                {isAdmin && !archived && <DropdownMenuSeparator />}
                <DropdownMenuGroup>
                  <DropdownMenuItem variant="destructive" onClick={confirmLeave}>
                    <LogOutIcon />
                    Leave group
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>

      {archived && (
        <Alert>
          <ArchiveIcon />
          <AlertTitle>This group is archived</AlertTitle>
          <AlertDescription>
            {isOwner
              ? "It's read-only. Unarchive it from the group options to make changes."
              : "It's read-only. Only the owner can unarchive it."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <MembersCard group={data} myUserId={me.id} onConfirm={setConfirm} />
        {isAdmin && !archived && (
          <InviteCard groupId={data.id} groupName={data.name} onConfirm={setConfirm} />
        )}
      </div>

      {isAdmin && <EditGroupDialog group={data} open={editing} onOpenChange={setEditing} />}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </AppShell>
  )
}
