import { LinkIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"

import { AppShell } from "@/components/app-shell"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { formErrorMessage } from "@/lib/form-errors"
import { useAcceptInvite, useInvitePreview } from "@/lib/groups"

function InvalidInvite({ message }: { message: string }) {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LinkIcon />
        </EmptyMedia>
        <EmptyTitle>This invite link doesn't work</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          Go to your groups
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function InvitePage() {
  const { code = "" } = useParams()
  const navigate = useNavigate()
  const preview = useInvitePreview(code)
  const accept = useAcceptInvite(code)

  async function join() {
    try {
      const { groupId } = await accept.mutateAsync()
      toast.success(`You joined ${preview.data?.groupName ?? "the group"}`)
      navigate(`/groups/${groupId}`, { replace: true })
    } catch (error) {
      toast.error(formErrorMessage(error) ?? "Couldn't join the group. Try again.")
    }
  }

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-6">
        {preview.isPending && <Skeleton className="h-56" />}

        {preview.isError && (
          <InvalidInvite
            message={
              preview.error instanceof ApiError
                ? preview.error.message
                : "Can't reach the server. Check your connection and try again."
            }
          />
        )}

        {preview.data && (
          <Card>
            <CardHeader>
              <CardDescription>{preview.data.invitedBy} invited you to join</CardDescription>
              <CardTitle className="text-3xl font-extrabold tracking-tight break-words">
                {preview.data.groupName}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              {preview.data.alreadyMember
                ? "You're already a member of this group."
                : preview.data.memberCount === 1
                  ? "You'll be the second member."
                  : `${preview.data.memberCount} people are already in this group.`}
            </CardContent>
            <CardFooter>
              {preview.data.alreadyMember ? (
                <Button
                  className="w-full"
                  render={<Link to={`/groups/${preview.data.groupId}`} />}
                  nativeButton={false}
                >
                  Open group
                </Button>
              ) : (
                <Button className="w-full" onClick={() => void join()} disabled={accept.isPending}>
                  {accept.isPending && <Spinner data-icon="inline-start" />}
                  Join {preview.data.groupName}
                </Button>
              )}
            </CardFooter>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
