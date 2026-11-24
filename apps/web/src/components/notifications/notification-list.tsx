import type { NotificationResponse, NotificationType } from "@twg/shared"
import {
  BanknoteIcon,
  CalendarDaysIcon,
  type LucideIcon,
  MessageCircleIcon,
  ReceiptTextIcon,
  UserPlusIcon,
} from "lucide-react"
import { useNavigate } from "react-router"

import { formatRelative } from "@/lib/format"
import { useMarkRead } from "@/lib/notifications"
import { cn } from "@/lib/utils"

function iconFor(type: NotificationType): LucideIcon {
  if (type.startsWith("expense.")) return ReceiptTextIcon
  if (type === "event.commented") return MessageCircleIcon
  if (type.startsWith("event.")) return CalendarDaysIcon
  if (type === "group.member_joined") return UserPlusIcon
  return BanknoteIcon
}

/** Notifications as a list; tapping one marks it read and opens what it's about. */
export function NotificationList({
  items,
  onOpen,
}: {
  items: NotificationResponse[]
  onOpen?: () => void
}) {
  const navigate = useNavigate()
  const markRead = useMarkRead()

  return (
    <ul className="flex flex-col">
      {items.map((n) => {
        const Icon = iconFor(n.type)
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => {
                if (!n.read) markRead.mutate(n.id)
                onOpen?.()
                void navigate(n.link)
              }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-offset-2 transition-colors hover:bg-muted"
            >
              <span
                className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted",
                  !n.read && "bg-primary/10 text-primary"
                )}
                aria-hidden
              >
                <Icon className="size-3.5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("break-words", !n.read && "font-medium")}>{n.text}</span>
                <time className="text-xs text-muted-foreground" dateTime={n.createdAt}>
                  {formatRelative(n.createdAt)}
                </time>
              </span>
              {!n.read && (
                <span
                  className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                  aria-label="Unread"
                />
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
