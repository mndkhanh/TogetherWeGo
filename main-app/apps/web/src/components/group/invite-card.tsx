import { INVITE_EXPIRY_DAYS, type InviteResponse } from "@twg/shared"
import { CheckIcon, CopyIcon, LinkIcon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

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
  { value: "none", maxUses: null },
  { value: "1", maxUses: 1 },
  { value: "5", maxUses: 5 },
] as const

function CopyLink({ code }: { code: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)
  const url = inviteUrl(code)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success(t("inviteCard.copied"))
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t("inviteCard.copyFailed"))
    }
  }

  return (
    <InputGroup>
      <InputGroupInput
        readOnly
        value={url}
        aria-label={t("inviteCard.link")}
        onFocus={(event) => event.currentTarget.select()}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton onClick={() => void copy()} aria-label={t("inviteCard.copyLink")}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t("common.copied") : t("common.copy")}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

function usageLabel(invite: InviteResponse, t: TFunction): string {
  if (invite.maxUses === null) {
    return invite.uses === 0
      ? t("inviteCard.notUsed")
      : t("inviteCard.used", { count: invite.uses })
  }
  return t("inviteCard.usedOf", { uses: invite.uses, max: invite.maxUses })
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
  const { t } = useTranslation()
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
        () => toast.success(t("inviteCard.createdCopied")),
        () => toast.success(t("inviteCard.created"))
      )
    } catch (error) {
      toast.error(formErrorMessage(error) ?? t("inviteCard.createFailed"))
    }
  }

  function revoke(invite: InviteResponse) {
    onConfirm({
      title: t("inviteCard.revokeTitle"),
      description: t("inviteCard.revokeHint", { group: groupName }),
      confirmLabel: t("inviteCard.revokeConfirm"),
      destructive: true,
      onConfirm: async () => {
        try {
          await revokeInvite.mutateAsync(invite.code)
          toast.success(t("inviteCard.revoked"))
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("inviteCard.revokeFailed"))
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("inviteCard.title")}</CardTitle>
        <CardDescription>{t("inviteCard.hint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invite-expiry">{t("inviteCard.worksFor")}</FieldLabel>
            <ToggleGroup
              id="invite-expiry"
              variant="outline"
              value={[String(expiresInDays)]}
              onValueChange={(value: string[]) => value[0] && setExpiresInDays(Number(value[0]))}
            >
              {INVITE_EXPIRY_DAYS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)}>
                  {t("inviteCard.days", { count: days })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-limit">{t("inviteCard.howMany")}</FieldLabel>
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
                  {option.maxUses === null
                    ? t("inviteCard.noLimit")
                    : t("inviteCard.people", { count: option.maxUses })}
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
            {t("inviteCard.create")}
          </Button>
        </FieldGroup>

        {invites.data && invites.data.length > 0 && (
          <>
            <Separator />
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-medium">{t("inviteCard.active")}</h3>
              {invites.data.map((invite) => (
                <div key={invite.code} className="flex flex-col gap-2">
                  <CopyLink code={invite.code} />
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>
                      {t("inviteCard.usageExpires", {
                        usage: usageLabel(invite, t),
                        when: formatRelative(invite.expiresAt),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revoke(invite)}
                      aria-label={t("inviteCard.revokeThis")}
                    >
                      <XIcon data-icon="inline-start" />
                      {t("inviteCard.turnOff")}
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
