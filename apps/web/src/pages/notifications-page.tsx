import { ArrowLeftIcon, BellIcon } from "lucide-react"
import { Link } from "react-router"

import { AppShell } from "@/components/app-shell"
import { NotificationList } from "@/components/notifications/notification-list"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { unreadCountOf, useMarkAllRead, useNotifications } from "@/lib/notifications"

export function NotificationsPage() {
  const feed = useNotifications()
  const markAll = useMarkAllRead()
  const items = feed.data?.pages.flatMap((p) => p.items) ?? []
  const unread = unreadCountOf(feed.data)

  return (
    <AppShell>
      <section className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link to="/" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Your groups
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Notifications</h1>
          <div className="flex gap-2">
            {unread > 0 && (
              <Button
                variant="outline"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate(undefined)}
              >
                Mark all read
              </Button>
            )}
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/settings/notifications" />}
            >
              Settings
            </Button>
          </div>
        </div>
      </section>

      {feed.isPending ? (
        <Skeleton className="h-64" />
      ) : feed.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            Couldn't load your notifications.
            <Button variant="outline" size="sm" onClick={() => void feed.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Empty className="border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>No notifications yet</EmptyTitle>
            <EmptyDescription>
              You’ll hear about new expenses you’re part of, events in your groups, payments, and
              reminders before events you’re going to.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <NotificationList items={items} />
            {feed.hasNextPage && (
              <Button
                variant="outline"
                className="self-center"
                disabled={feed.isFetchingNextPage}
                onClick={() => void feed.fetchNextPage()}
              >
                {feed.isFetchingNextPage && <Spinner data-icon="inline-start" />}
                Show older
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
