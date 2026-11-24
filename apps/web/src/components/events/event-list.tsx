import type { EventSummaryResponse, RsvpStatus } from "@twg/shared"
import { CalendarDaysIcon, MapPinIcon, MessageCircleIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"

import { MemberAvatars } from "@/components/member-avatars"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { formatEventTime, useEvents } from "@/lib/events"
import { cn } from "@/lib/utils"

const MY_RSVP: Record<RsvpStatus, string> = {
  going: "You’re going",
  maybe: "You might go",
  no: "You can’t go",
}

const monthFormat = new Intl.DateTimeFormat("en", { month: "short" })

/** A calendar-page date: the month over a big day number. */
function DateBlock({ iso, muted }: { iso: string; muted: boolean }) {
  const date = new Date(iso)
  return (
    <div
      className={cn(
        "flex w-14 shrink-0 flex-col items-center rounded-lg border bg-background py-1.5",
        muted && "opacity-60"
      )}
      aria-hidden
    >
      <span className="text-xs font-semibold text-primary uppercase">
        {monthFormat.format(date)}
      </span>
      <span className="text-2xl leading-none font-extrabold tabular-nums">{date.getDate()}</span>
    </div>
  )
}

function EventRow({ event }: { event: EventSummaryResponse }) {
  const cancelled = event.status === "cancelled"
  return (
    <li>
      <Link
        to={`/groups/${event.groupId}/events/${event.id}`}
        className="flex items-center gap-4 rounded-xl px-3 py-3 outline-offset-2 transition-colors hover:bg-muted"
      >
        <DateBlock iso={event.startsAt} muted={cancelled} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("truncate font-semibold", cancelled && "line-through")}>
              {event.title}
            </span>
            {cancelled && <Badge variant="outline">Cancelled</Badge>}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {formatEventTime(event.startsAt, event.endsAt)}
            {event.location && (
              <>
                {" · "}
                <MapPinIcon className="inline size-3.5 align-[-2px]" aria-label="at" />{" "}
                {event.location}
              </>
            )}
          </span>
          <span className="flex items-center gap-3 text-sm text-muted-foreground">
            {event.goingPreview.length > 0 && (
              <MemberAvatars
                people={event.goingPreview}
                total={event.going}
                label={`${event.going} going`}
                size="sm"
              />
            )}
            <span>
              {event.going} going{event.maybe > 0 && `, ${event.maybe} maybe`}
            </span>
            {event.commentCount > 0 && (
              <span className="flex items-center gap-1">
                <MessageCircleIcon className="size-3.5" aria-hidden />
                {event.commentCount}
              </span>
            )}
          </span>
        </div>
        {!cancelled && event.myRsvp && (
          <Badge
            variant={event.myRsvp === "going" ? "default" : "secondary"}
            className="max-sm:hidden"
          >
            {MY_RSVP[event.myRsvp]}
          </Badge>
        )}
      </Link>
    </li>
  )
}

function PastEvents({ groupId }: { groupId: string }) {
  const past = useEvents(groupId, "past")
  if (past.isPending) return <Skeleton className="h-20" />
  const items = past.data?.pages.flatMap((p) => p.items) ?? []
  if (items.length === 0) {
    return <p className="px-3 text-sm text-muted-foreground">No past events yet.</p>
  }
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col rounded-xl border bg-card">
        {items.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </ul>
      {past.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={past.isFetchingNextPage}
          onClick={() => void past.fetchNextPage()}
        >
          {past.isFetchingNextPage && <Spinner data-icon="inline-start" />}
          Show older events
        </Button>
      )}
    </div>
  )
}

export function EventList({
  groupId,
  planButton,
}: {
  groupId: string
  /** Shown in the empty state; omitted when the group is archived. */
  planButton?: React.ReactNode
}) {
  const upcoming = useEvents(groupId, "upcoming")
  const [showPast, setShowPast] = React.useState(false)

  if (upcoming.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading events">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    )
  }
  if (upcoming.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          Couldn't load the events.
          <Button variant="outline" size="sm" onClick={() => void upcoming.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const items = upcoming.data.pages.flatMap((p) => p.items)
  return (
    <div className="flex flex-col gap-6">
      {items.length === 0 ? (
        <Empty className="border border-dashed bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDaysIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing planned</EmptyTitle>
            <EmptyDescription>
              Plan the next hangout. Everyone can say if they’re coming and talk it over.
            </EmptyDescription>
          </EmptyHeader>
          {planButton && <EmptyContent>{planButton}</EmptyContent>}
        </Empty>
      ) : (
        <section aria-label="Coming up" className="flex flex-col gap-2">
          <h3 className="px-3 text-sm font-medium text-muted-foreground">Coming up</h3>
          <ul className="flex flex-col rounded-xl border bg-card">
            {items.map((e) => (
              <EventRow key={e.id} event={e} />
            ))}
          </ul>
          {upcoming.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              disabled={upcoming.isFetchingNextPage}
              onClick={() => void upcoming.fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </section>
      )}

      <section aria-label="Past events" className="flex flex-col gap-2">
        {showPast ? (
          <>
            <h3 className="px-3 text-sm font-medium text-muted-foreground">Past</h3>
            <PastEvents groupId={groupId} />
          </>
        ) : (
          <Button variant="ghost" className="self-start" onClick={() => setShowPast(true)}>
            Show past events
          </Button>
        )}
      </section>
    </div>
  )
}
