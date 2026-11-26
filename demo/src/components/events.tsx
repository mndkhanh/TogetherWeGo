import { MapPin, Trash2, Wallet } from "lucide-react"
import * as React from "react"

import { useConfirm } from "@/components/confirm"
import {
  Button,
  cx,
  Empty,
  ErrorText,
  Field,
  Input,
  Loading,
  Panel,
  useAction,
} from "@/components/ui"
import { useUser } from "@/lib/auth"
import { useMe } from "@/lib/me"
import {
  addEvent,
  dataErrorMessage,
  deleteEvent,
  setRsvp,
  useEvents,
  useExpenses,
  useRsvps,
  type HangoutEvent,
  type RsvpStatus,
} from "@/lib/data"
import { formatVnd } from "@/lib/money"

const RSVP_LABELS: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can't go" }

export function EventsTab({ groupId }: { groupId: string }) {
  const events = useEvents(groupId)
  const expenses = useExpenses(groupId)
  // What was spent for each plan: total and number of expenses.
  const spent = new Map<string, { total: number; count: number }>()
  for (const e of expenses.data ?? []) {
    if (!e.eventId) continue
    const s = spent.get(e.eventId) ?? { total: 0, count: 0 }
    spent.set(e.eventId, { total: s.total + e.amount, count: s.count + 1 })
  }
  const [showPast, setShowPast] = React.useState(false)

  if (events.error) return <ErrorText>{dataErrorMessage(events.error)}</ErrorText>
  if (!events.data) return <Loading />

  const now = Date.now()
  const upcoming = events.data.filter((e) => e.startsAt.getTime() >= now - 3 * 3600_000)
  const past = events.data.filter((e) => e.startsAt.getTime() < now - 3 * 3600_000).reverse()

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="lg:sticky lg:top-6">
        <AddEvent groupId={groupId} />
      </div>
      <div className="flex flex-col gap-6">
        {upcoming.length === 0 ? (
          <Panel>
            <Empty>Nothing planned yet. Suggest a time.</Empty>
          </Panel>
        ) : (
          upcoming.map((e) => (
            <EventCard key={e.id} groupId={groupId} event={e} spent={spent.get(e.id)} />
          ))
        )}
        {past.length > 0 && (
          <div>
            <Button variant="ghost" size="sm" onClick={() => setShowPast(!showPast)}>
              {showPast ? "Hide past plans" : `Show past plans (${past.length})`}
            </Button>
            {showPast && (
              <div className="mt-3 flex flex-col gap-3 opacity-75">
                {past.map((e) => (
                  <EventCard
                    key={e.id}
                    groupId={groupId}
                    event={e}
                    spent={spent.get(e.id)}
                    past
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EventCard({
  groupId,
  event,
  spent,
  past = false,
}: {
  groupId: string
  event: HangoutEvent
  spent?: { total: number; count: number }
  past?: boolean
}) {
  const user = useUser()
  const me = useMe()
  const rsvps = useRsvps(groupId, event.id)
  const { busy, error, run } = useAction()
  const { confirm, dialog } = useConfirm()
  const mine = rsvps.data?.find((r) => r.uid === user.uid)?.status
  const going = rsvps.data?.filter((r) => r.status === "going") ?? []
  const maybe = rsvps.data?.filter((r) => r.status === "maybe") ?? []

  return (
    <article className="flex gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line">
      {dialog}
      <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-marigold-soft py-2 text-ink">
        <span className="text-xs font-semibold uppercase">
          {event.startsAt.toLocaleDateString(undefined, { month: "short" })}
        </span>
        <span className="text-2xl leading-none font-extrabold tabular-nums">
          {event.startsAt.getDate()}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold">{event.title}</h3>
          {event.createdBy === user.uid && (
            <Button
              variant="danger"
              size="sm"
              aria-label={`Delete ${event.title}`}
              disabled={busy}
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete “${event.title}”?`,
                  body: (
                    <>
                      Everyone's answers go with it. Expenses added for it stay, without the plan.
                      This can't be undone.
                    </>
                  ),
                  action: "Delete plan",
                })
                if (ok) void run(() => deleteEvent(groupId, event.id), dataErrorMessage)
              }}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          )}
        </div>
        <p className="text-sm text-muted">
          {event.startsAt.toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
        {event.location && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <MapPin className="size-3.5" aria-hidden />
            {event.location}
          </p>
        )}
        <p className="mt-3 text-sm">
          <span className="font-semibold">{going.length} going</span>
          {going.length > 0 && (
            <span className="text-muted">: {going.map((r) => r.name).join(", ")}</span>
          )}
          {maybe.length > 0 && <span className="text-muted"> · {maybe.length} maybe</span>}
        </p>
        {spent && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted">
            <Wallet className="size-3.5" aria-hidden />
            <span className="font-semibold text-ink tabular-nums">{formatVnd(spent.total)}</span>
            spent · {spent.count} expense{spent.count === 1 ? "" : "s"}
          </p>
        )}
        {!past && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Your answer">
            {(Object.keys(RSVP_LABELS) as RsvpStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={mine === s}
                disabled={busy}
                onClick={() =>
                  void run(
                    () => setRsvp(groupId, event.id, { uid: user.uid, name: me.name }, s),
                    dataErrorMessage,
                  )
                }
                className={cx(
                  "rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition-colors",
                  mine === s
                    ? s === "no"
                      ? "bg-ink text-white ring-ink"
                      : "bg-brand text-white ring-brand"
                    : "bg-surface text-muted ring-line hover:text-ink",
                )}
              >
                {RSVP_LABELS[s]}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
    </article>
  )
}

function AddEvent({ groupId }: { groupId: string }) {
  const user = useUser()
  const [title, setTitle] = React.useState("")
  const [date, setDate] = React.useState("")
  const [time, setTime] = React.useState("19:00")
  const [location, setLocation] = React.useState("")
  const { busy, error, run, setError } = useAction()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return setError("Give the plan a name.")
    const startsAt = new Date(`${date}T${time}`)
    if (!date || Number.isNaN(startsAt.getTime())) return setError("Pick a date and time.")
    const ok = await run(
      () => addEvent(groupId, { title, startsAt, location }, user.uid),
      dataErrorMessage,
    )
    if (ok) {
      setTitle("")
      setDate("")
      setLocation("")
    }
  }

  return (
    <Panel title="Plan a hangout">
      <form onSubmit={submit} className="@container flex flex-col gap-4" noValidate>
        <Field label="What">
          <Input
            placeholder="Cà phê Sunday, karaoke night…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
          />
        </Field>
        <div className="grid gap-4 @lg:grid-cols-[1fr_8rem_1.5fr]">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Where (optional)">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="self-start">
          Add plan
        </Button>
      </form>
    </Panel>
  )
}
