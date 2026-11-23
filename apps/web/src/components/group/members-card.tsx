import { type GroupDetailResponse, type GroupMemberResponse, type GroupRole } from "@twg/shared"
import { CrownIcon, EllipsisIcon, ShieldIcon, UserIcon, UserMinusIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

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
import { formatDate, ROLE_LABEL } from "@/lib/format"
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
  const changeRole = useChangeRole(group.id)
  const removeMember = useRemoveMember(group.id)
  const isOwner = group.myRole === "owner"
  const canRemove = RANK[group.myRole] > RANK[member.role] && group.myRole !== "member"
  if (group.archivedAt || (!isOwner && !canRemove)) return null

  const firstName = member.name.split(/\s+/)[0] ?? member.name

  async function setRole(role: GroupRole) {
    try {
      await changeRole.mutateAsync({ userId: member.userId, role })
      toast.success(`${member.name} is now ${role === "admin" ? "an admin" : `the ${role}`}`)
    } catch (error) {
      toast.error(formErrorMessage(error) ?? "Couldn't change the role. Try again.")
      throw error
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={`Actions for ${member.name}`}
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {isOwner && (
          <DropdownMenuGroup>
            {member.role === "member" ? (
              <DropdownMenuItem onClick={() => void setRole("admin").catch(() => {})}>
                <ShieldIcon />
                Make admin
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => void setRole("member").catch(() => {})}>
                <UserIcon />
                Make regular member
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() =>
                onConfirm({
                  title: `Make ${member.name} the owner?`,
                  description:
                    "You'll become an admin. The owner can archive the group and change everyone's role, so only do this for someone you trust.",
                  confirmLabel: `Make ${firstName} owner`,
                  onConfirm: () => setRole("owner"),
                })
              }
            >
              <CrownIcon />
              Make owner
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
                  title: `Remove ${member.name} from ${group.name}?`,
                  description: "They'll lose access to the group. You can invite them back later.",
                  confirmLabel: `Remove ${firstName}`,
                  destructive: true,
                  onConfirm: async () => {
                    try {
                      await removeMember.mutateAsync(member.userId)
                      toast.success(`Removed ${member.name}`)
                    } catch (error) {
                      toast.error(formErrorMessage(error) ?? "Couldn't remove them. Try again.")
                      throw error
                    }
                  },
                })
              }
            >
              <UserMinusIcon />
              Remove from group
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>
          {group.memberCount === 1
            ? "Only you for now. Share an invite link to add friends."
            : `${group.memberCount} people`}
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
                    <span className="font-normal text-muted-foreground"> (you)</span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  Joined {formatDate(member.joinedAt)}
                </span>
              </div>
              {member.role !== "member" && (
                <Badge variant={member.role === "owner" ? "default" : "secondary"}>
                  {ROLE_LABEL[member.role]}
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
