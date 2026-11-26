import { LinkIcon } from "lucide-react"
import { Link, useNavigate, useParams } from "react-router"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

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
import { translateMessage } from "@/i18n/messages"
import { ApiError } from "@/lib/api"
import { formErrorMessage } from "@/lib/form-errors"
import { useAcceptInvite, useInvitePreview } from "@/lib/groups"

function InvalidInvite({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <LinkIcon />
        </EmptyMedia>
        <EmptyTitle>{t("invite.invalidTitle")}</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/" />} nativeButton={false}>
          {t("invite.goToGroups")}
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function InvitePage() {
  const { t } = useTranslation()
  const { code = "" } = useParams()
  const navigate = useNavigate()
  const preview = useInvitePreview(code)
  const accept = useAcceptInvite(code)

  async function join() {
    try {
      const { groupId } = await accept.mutateAsync()
      toast.success(t("invite.joined", { group: preview.data?.groupName ?? t("invite.theGroup") }))
      navigate(`/groups/${groupId}`, { replace: true })
    } catch (error) {
      toast.error(formErrorMessage(error) ?? t("invite.joinFailed"))
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
                ? translateMessage(preview.error.message)
                : t("errors.offline")
            }
          />
        )}

        {preview.data && (
          <Card>
            <CardHeader>
              <CardDescription>
                {t("invite.invitedBy", { name: preview.data.invitedBy })}
              </CardDescription>
              <CardTitle className="text-3xl font-extrabold tracking-tight break-words">
                {preview.data.groupName}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-muted-foreground">
              {preview.data.alreadyMember
                ? t("invite.alreadyMember")
                : preview.data.memberCount === 1
                  ? t("invite.secondMember")
                  : t("invite.memberCount", { count: preview.data.memberCount })}
            </CardContent>
            <CardFooter>
              {preview.data.alreadyMember ? (
                <Button
                  className="w-full"
                  render={<Link to={`/groups/${preview.data.groupId}`} />}
                  nativeButton={false}
                >
                  {t("invite.openGroup")}
                </Button>
              ) : (
                <Button className="w-full" onClick={() => void join()} disabled={accept.isPending}>
                  {accept.isPending && <Spinner data-icon="inline-start" />}
                  {t("invite.join", { group: preview.data.groupName })}
                </Button>
              )}
            </CardFooter>
          </Card>
        )}
      </div>
    </AppShell>
  )
}
