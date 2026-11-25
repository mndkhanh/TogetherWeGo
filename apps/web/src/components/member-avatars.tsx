import { useTranslation } from "react-i18next"
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar"
import { initials } from "@/lib/format"

interface Person {
  userId: string
  name: string
  avatarUrl: string | null
}

export function PersonAvatar({
  person,
  size,
  className,
}: {
  person: Person
  size?: "default" | "sm" | "lg"
  className?: string
}) {
  return (
    <Avatar size={size} className={className}>
      {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  )
}

/** Overlapping avatars for the first few members, then "+N". */
export function MemberAvatars({
  people,
  total,
  label,
  size,
}: {
  people: Person[]
  total: number
  label?: string
  size?: "default" | "sm"
}) {
  const { t } = useTranslation()
  const shown = people.slice(0, 4)
  return (
    <AvatarGroup aria-label={label ?? t("home.members", { count: total })}>
      {shown.map((person) => (
        <PersonAvatar key={person.userId} person={person} size={size} />
      ))}
      {total > shown.length && <AvatarGroupCount>+{total - shown.length}</AvatarGroupCount>}
    </AvatarGroup>
  )
}
