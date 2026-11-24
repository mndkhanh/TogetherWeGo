import { BellIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"

import { NotificationList } from "@/components/notifications/notification-list"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { unreadCountOf, useMarkAllRead, useNotifications } from "@/lib/notifications"

export function NotificationBell() {
  const feed = useNotifications()
  const markAll = useMarkAllRead()
  const [open, setOpen] = React.useState(false)
  const unread = unreadCountOf(feed.data)
  const items = feed.data?.pages.flatMap((p) => p.items).slice(0, 8) ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-lg" className="relative rounded-full" />}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <BellIcon />
        {unread > 0 && (
          <span
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground tabular-nums"
            aria-hidden
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">Notifications</h2>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate(undefined)}
            >
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto p-1.5">
          {feed.isPending ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing yet. New expenses, events and payments show up here.
            </p>
          ) : (
            <NotificationList items={items} onOpen={() => setOpen(false)} />
          )}
        </div>
        <div className="flex justify-between border-t px-2 py-1.5">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/notifications" onClick={() => setOpen(false)} />}
          >
            See all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/settings/notifications" onClick={() => setOpen(false)} />}
          >
            Settings
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
