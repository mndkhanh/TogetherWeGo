import { type GroupDetailResponse, type GroupMemberResponse, type GroupRole } from "@twg/shared"
import { CrownIcon, EllipsisIcon, ShieldIcon, UserIcon, UserMinusIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import type { ConfirmRequest } from "@/components/confirm-dialog"
import { PersonAvatar } from "@/components/member-avatars"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { formErrorMessage } from "@/lib/form-errors"
import { formatDate, roleLabel } from "@/lib/format"
import { useChangeRole, useRemoveMember } from "@/lib/groups"

const RANK: Record<GroupRole, number> = { owner: 3, admin: 2, member: 1 }

function MemberActions({
  group,
  member,
  onConfirm,
}: {
  group: GroupDetailResponse
  member: GroupMemberResponse
  onConfirm: (request: ConfirmRequest) => void
}) {
  const { t } = useTranslation()
  const changeRole = useChangeRole(group.id)
  const removeMember = useRemoveMember(group.id)
  const isOwner = group.myRole === "owner"
  const canRemove = RANK[group.myRole] > RANK[member.role] && group.myRole !== "member"
  if (group.archivedAt || (!isOwner && !canRemove)) return null

  const firstName = member.name.split(/\s+/)[0] ?? member.name

  async function setRole(role: GroupRole) {
    try {
      await changeRole.mutateAsync({ userId: member.userId, role })
      toast.success(t(`members.roleChanged.${role}`, { name: member.name }))
    } catch (error) {
      toast.error(formErrorMessage(error) ?? t("members.roleFailed"))
      throw error
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={t("members.actionsFor", { name: member.name })}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {isOwner && (
          <DropdownMenuGroup>
            {member.role === "member" ? (
              <DropdownMenuItem onClick={() => void setRole("admin").catch(() => {})}>
                <ShieldIcon />
                {t("members.makeAdmin")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => void setRole("member").catch(() => {})}>
                <UserIcon />
                {t("members.makeMember")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                onConfirm({
                  title: t("members.makeOwnerTitle", { name: member.name }),
                  description: t("members.makeOwnerHint"),
                  confirmLabel: t("members.makeOwnerConfirm", { name: firstName }),
                  onConfirm: () => setRole("owner"),
                })
              }
            >
              <CrownIcon />
              {t("members.makeOwner")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
        {isOwner && canRemove && <DropdownMenuSeparator />}
        {canRemove && (
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                onConfirm({
                  title: t("members.removeTitle", { name: member.name, group: group.name }),
                  description: t("members.removeHint"),
                  confirmLabel: t("members.removeConfirm", { name: firstName }),
                  destructive: true,
                  onConfirm: async () => {
                    try {
                      await removeMember.mutateAsync(member.userId)
                      toast.success(t("members.removed", { name: member.name }))
                    } catch (error) {
                      toast.error(formErrorMessage(error) ?? t("members.removeFailed"))
                      throw error
                    }
                  },
                })
              }
            >
              <UserMinusIcon />
              {t("members.remove")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function MembersCard({
  group,
  myUserId,
  onConfirm,
}: {
  group: GroupDetailResponse
  myUserId: string
  onConfirm: (request: ConfirmRequest) => void
}) {
  const { t } = useTranslation()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("members.title")}</CardTitle>
        <CardDescription>
          {group.memberCount === 1
            ? t("members.onlyYou")
            : t("members.people", { count: group.memberCount })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col">
        {group.members.map((member, index) => (
          <React.Fragment key={member.userId}>
            {index > 0 && <Separator />}
            <div className="flex items-center gap-3 py-3">
              <PersonAvatar person={member} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {member.name}
                  {member.userId === myUserId && (
                    <span className="font-normal text-muted-foreground">{t("members.you")}</span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("members.joined", { date: formatDate(member.joinedAt) })}
                </span>
              </div>
              {member.role !== "member" && (
                <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                  {roleLabel(member.role)}
                </Badge>
              )}
              {member.userId !== myUserId && (
                <MemberActions group={group} member={member} onConfirm={onConfirm} />
              )}
            </div>
          </React.Fragment>
        ))}
      </CardContent>
    </Card>
  )
}
