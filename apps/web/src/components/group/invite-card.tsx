import { INVITE_EXPIRY_DAYS, type InviteResponse } from "@twg/shared"
import { CheckIcon, CopyIcon, LinkIcon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import type { ConfirmRequest } from "@/components/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formErrorMessage } from "@/lib/form-errors"
import { formatRelative } from "@/lib/format"
import { inviteUrl, useCreateInvite, useInvites, useRevokeInvite } from "@/lib/groups"

const USE_LIMITS = [
  { value: "none", label: "No limit", maxUses: null },
  { value: "1", label: "1 person", maxUses: 1 },
  { value: "5", label: "5 people", maxUses: 5 },
] as const

function CopyLink({ code }: { code: string }) {
  const [copied, setCopied] = React.useState(false)
  const url = inviteUrl(code)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success("Invite link copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.")
    }
  }

  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={url}
        aria-label="Invite link"
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={() => void copy()} aria-label="Copy invite link">
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy"}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function usageLabel(invite: InviteResponse): string {
  if (invite.maxUses === null) {
    return invite.uses === 0
      ? "Not used yet"
      : `Used ${invite.uses} ${invite.uses === 1 ? "time" : "times"}`
  }
  return `${invite.uses} of ${invite.maxUses} used`
}

export function InviteCard({
  groupId,
  groupName,
  onConfirm,
}: {
  groupId: string
  groupName: string
  onConfirm: (request: ConfirmRequest) => void
}) {
  const [expiresInDays, setExpiresInDays] = React.useState<number>(7)
  const [limit, setLimit] = React.useState<(typeof USE_LIMITS)[number]["value"]>("none")
  const invites = useInvites(groupId, true)
  const createInvite = useCreateInvite(groupId)
  const revokeInvite = useRevokeInvite(groupId)

  async function create() {
    const maxUses = USE_LIMITS.find((option) => option.value === limit)?.maxUses ?? null
    try {
      const invite = await createInvite.mutateAsync({ expiresInDays, maxUses })
      await navigator.clipboard.writeText(inviteUrl(invite.code)).then(
        () => toast.success("Invite link created and copied"),
        () => toast.success("Invite link created")
      )
    } catch (error) {
      toast.error(formErrorMessage(error) ?? "Couldn't create the link. Try again.")
    }
  }

  function revoke(invite: InviteResponse) {
    onConfirm({
      title: "Turn off this invite link?",
      description: `People who haven't joined yet won't be able to use it. Members already in ${groupName} stay.`,
      confirmLabel: "Turn off link",
      destructive: true,
      onConfirm: async () => {
        try {
          await revokeInvite.mutateAsync(invite.code)
          toast.success("Invite link turned off")
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Couldn't turn off the link. Try again.")
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite friends</CardTitle>
        <CardDescription>Anyone signed in with the link can join until it expires.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-expiry">Link works for</FieldLabel>
            <ToggleGroup
              id="invite-expiry"
              variant="outline"
              value={[String(expiresInDays)]}
              onValueChange={(value: string[]) => value[0] && setExpiresInDays(Number(value[0]))}
            >
              {INVITE_EXPIRY_DAYS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {days === 1 ? "1 day" : `${days} days`}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-limit">How many people can use it</FieldLabel>
            <ToggleGroup
              id="invite-limit"
              variant="outline"
              value={[limit]}
              onValueChange={(value: string[]) => {
                const next = USE_LIMITS.find((option) => option.value === value[0])
                if (next) setLimit(next.value)
              }}
            >
              {USE_LIMITS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Button onClick={() => void create()} disabled={createInvite.isPending}>
            {createInvite.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <LinkIcon data-icon="inline-start" />
            )}
            Create invite link
          </Button>
        </FieldGroup>

        {invites.data && invites.data.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">Active links</h3>
              {invites.data.map((invite) => (
                <div key={invite.code} className="flex flex-col gap-2">
                  <CopyLink code={invite.code} />
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>
                      {usageLabel(invite)}, expires {formatRelative(invite.expiresAt)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(invite)}
                      aria-label="Turn off this invite link"
                    >
                      <XIcon data-icon="inline-start" />
                      Turn off
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
