import { ArrowLeftIcon, BellIcon } from "lucide-react"
import { Link } from "react-router"
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
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
          {t("common.yourGroups")}
        </Button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
            {t("notifications.title")}
          </h1>
          <div className="flex gap-2">
            {unread > 0 && (
              <Button
                variant="outline"
                disabled={markAll.isPending}
                onClick={() => markAll.mutate(undefined)}
              >
                {t("notifications.markAllRead")}
              </Button>
            )}
            <Button
              variant="ghost"
              nativeButton={false}
              render={<Link to="/settings/notifications" />}
            >
              {t("notifications.settings")}
            </Button>
          </div>
        </div>
      </section>

      {feed.isPending ? (
        <Skeleton className="h-64" />
      ) : feed.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            {t("notifications.loadFailed")}
            <Button variant="outline" size="sm" onClick={() => void feed.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Empty className="border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellIcon />
            </EmptyMedia>
            <EmptyTitle>{t("notifications.none")}</EmptyTitle>
            <EmptyDescription>{t("notifications.noneHint")}</EmptyDescription>
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
                {t("common.showOlder")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
