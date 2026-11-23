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

export function PersonAvatar({ person, className }: { person: Person; className?: string }) {
  return (
    <Avatar className={className}>
      {person.avatarUrl && <AvatarImage src={person.avatarUrl} alt="" />}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  )
}

/** Overlapping avatars for the first few members, then "+N". */
export function MemberAvatars({ people, total }: { people: Person[]; total: number }) {
  const shown = people.slice(0, 4)
  return (
    <AvatarGroup aria-label={`${total} members`}>
      {shown.map((person) => (
        <PersonAvatar key={person.userId} person={person} />
      ))}
      {total > shown.length && <AvatarGroupCount>+{total - shown.length}</AvatarGroupCount>}
    </AvatarGroup>
  )
}
