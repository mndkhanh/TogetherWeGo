import {
  type CommentResponse,
  type EventDetailResponse,
  type ExpenseDetailResponse,
  MAX_COMMENT_LENGTH,
  type RsvpStatus,
} from "@twg/shared"
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  EllipsisIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  SendIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react"
import * as React from "react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { ConfirmDialog, type ConfirmRequest } from "@/components/confirm-dialog"
import { EventFormDialog } from "@/components/events/event-form-dialog"
import { ExpenseDetailDialog } from "@/components/expenses/expense-detail-dialog"
import { ExpenseFormDialog } from "@/components/expenses/expense-form-dialog"
import { PersonAvatar } from "@/components/member-avatars"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ApiError } from "@/lib/api"
import {
  formatEventTime,
  useAddComment,
  useCancelEvent,
  useComments,
  useDeleteComment,
  useEvent,
  useRsvp,
} from "@/lib/events"
import { money, useEventExpenses } from "@/lib/expenses"
import { formatRelative } from "@/lib/format"
import { formErrorMessage } from "@/lib/form-errors"
import { useGroup } from "@/lib/groups"
import { cn } from "@/lib/utils"

const RSVP_LABEL: Record<RsvpStatus, string> = { going: "Going", maybe: "Maybe", no: "Can’t go" }

/** A maps search for the place. The text is only ever a query parameter, never a URL. */
function mapsUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
}

function RsvpPicker({ event, disabled }: { event: EventDetailResponse; disabled: boolean }) {
  const rsvp = useRsvp(event.groupId, event.id)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id="rsvp-label">
        Are you coming?
      </span>
      <ToggleGroup
        variant="outline"
        aria-labelledby="rsvp-label"
        value={event.myRsvp ? [event.myRsvp] : []}
        disabled={disabled || rsvp.isPending}
        onValueChange={(value: string[]) => {
          const next = value[0] as RsvpStatus | undefined
          if (!next) return
          rsvp.mutate(next, {
            onError: (err) => toast.error(formErrorMessage(err) ?? "Couldn't save your answer"),
          })
        }}
        className="w-full sm:w-auto"
      >
        {(Object.keys(RSVP_LABEL) as RsvpStatus[]).map((status) => (
          <ToggleGroupItem key={status} value={status} className="flex-1 sm:flex-none sm:px-5">
            {RSVP_LABEL[status]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function WhosComing({ event, myUserId }: { event: EventDetailResponse; myUserId: string }) {
  const groups: { status: RsvpStatus; title: string }[] = [
    { status: "going", title: "Going" },
    { status: "maybe", title: "Maybe" },
    { status: "no", title: "Can’t go" },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Who’s coming</CardTitle>
        <CardDescription>
          {event.going} going{event.maybe > 0 && `, ${event.maybe} maybe`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {groups.map(({ status, title }) => {
          const people = event.rsvps.filter((r) => r.status === status)
          if (people.length === 0) return null
          return (
            <section key={status} className="flex flex-col gap-2" aria-label={title}>
              <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
              <ul className="flex flex-col gap-2">
                {people.map((p) => (
                  <li key={p.userId} className="flex items-center gap-2 text-sm">
                    <PersonAvatar person={p} size="sm" />
                    <span className="truncate">
                      {p.userId === myUserId ? `${p.name} (you)` : p.name}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </CardContent>
    </Card>
  )
}

function Spending({
  event,
  myUserId,
  canAdd,
  onAdd,
  onOpen,
}: {
  event: EventDetailResponse
  myUserId: string
  canAdd: boolean
  onAdd: () => void
  onOpen: (expenseId: string) => void
}) {
  const expenses = useEventExpenses(event.groupId, event.id)
  const items = expenses.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending</CardTitle>
        <CardDescription>
          {event.spending.count === 0
            ? "Nothing added for this event yet."
            : `${money(event.spending.total, event.spending.currency)} across ${event.spending.count} ${
                event.spending.count === 1 ? "expense" : "expenses"
              }.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {items.length > 0 && (
          <ul className="-mx-3 flex flex-col">
            {items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onOpen(e.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{e.title}</span>
                  <span className="text-muted-foreground">
                    {e.payer.userId === myUserId ? "You" : e.payer.name}
                  </span>
                  <span className="font-medium tabular-nums">{money(e.amount, e.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {expenses.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={expenses.isFetchingNextPage}
            onClick={() => void expenses.fetchNextPage()}
          >
            Show more
          </Button>
        )}
        {canAdd && (
          <Button variant="outline" className="self-start" onClick={onAdd}>
            <PlusIcon data-icon="inline-start" />
            Add an expense for this
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function Comment({
  comment,
  myUserId,
  onDelete,
}: {
  comment: CommentResponse
  myUserId: string
  onDelete: (comment: CommentResponse) => void
}) {
  const mine = comment.author.userId === myUserId
  return (
    <li className="group flex gap-3">
      <PersonAvatar person={comment.author} size="sm" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="font-medium">{mine ? "You" : comment.author.name}</span>
          <time
            className="text-xs text-muted-foreground"
            dateTime={comment.createdAt}
            title={comment.createdAt}
          >
            {formatRelative(comment.createdAt)}
          </time>
          {comment.canDelete && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Delete comment"
              onClick={() => onDelete(comment)}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
        {/* Plain text: React escapes it; line breaks are kept, nothing is parsed as HTML. */}
        <p className="text-sm break-words whitespace-pre-wrap">{comment.body}</p>
      </div>
    </li>
  )
}

function Comments({
  eventId,
  myUserId,
  canPost,
  onConfirm,
}: {
  eventId: string
  myUserId: string
  canPost: boolean
  onConfirm: (request: ConfirmRequest) => void
}) {
  const comments = useComments(eventId)
  const add = useAddComment(eventId)
  const remove = useDeleteComment(eventId)
  const [text, setText] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)

  // The API pages newest first; read top to bottom, oldest first.
  const items = (comments.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse()

  async function send() {
    const body = text.trim()
    if (!body) {
      setError("Write something first")
      return
    }
    try {
      await add.mutateAsync(body)
      setText("")
      setError(null)
    } catch (err) {
      setError(
        err instanceof ApiError && err.issues[0]
          ? err.issues[0].message
          : (formErrorMessage(err) ?? "Couldn't post it. Try again.")
      )
    }
  }

  function confirmDelete(comment: CommentResponse) {
    onConfirm({
      title: "Delete this comment?",
      description:
        comment.author.userId === myUserId
          ? "It disappears for everyone."
          : `It disappears for everyone. ${comment.author.name} won’t be told.`,
      confirmLabel: "Delete comment",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(comment.id)
        } catch (err) {
          toast.error(formErrorMessage(err) ?? "Couldn't delete it")
          throw err
        }
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Chat</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {comments.hasNextPage && (
          <Button
            variant="ghost"
            size="sm"
            className="self-center"
            disabled={comments.isFetchingNextPage}
            onClick={() => void comments.fetchNextPage()}
          >
            Show earlier messages
          </Button>
        )}
        {comments.isPending ? (
          <Skeleton className="h-16" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet. Ask who’s driving.</p>
        ) : (
          <ol className="flex flex-col gap-4" aria-label="Messages">
            {items.map((c) => (
              <Comment key={c.id} comment={c} myUserId={myUserId} onDelete={confirmDelete} />
            ))}
          </ol>
        )}
        {canPost && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="comment-body" className="sr-only">
                Message
              </FieldLabel>
              <Textarea
                id="comment-body"
                value={text}
                rows={2}
                maxLength={MAX_COMMENT_LENGTH}
                placeholder="Write a message"
                aria-invalid={!!error || undefined}
                onChange={(e) => {
                  setText(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Button type="submit" className="self-end" disabled={add.isPending}>
              {add.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <SendIcon data-icon="inline-start" />
              )}
              Send
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function NotFound({ groupId }: { groupId: string }) {
  return (
    <Empty className="border border-dashed bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CalendarDaysIcon />
        </EmptyMedia>
        <EmptyTitle>Event not found</EmptyTitle>
        <EmptyDescription>It may be in a group you’re not part of.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to={`/groups/${groupId}?tab=events`} />} nativeButton={false}>
          Back to the group
        </Button>
      </EmptyContent>
    </Empty>
  )
}

export function EventPage() {
  const { groupId = "", eventId = "" } = useParams()
  const me = useMe()
  const event = useEvent(eventId)
  const group = useGroup(groupId)
  const cancel = useCancelEvent(groupId, eventId)
  const [editing, setEditing] = React.useState(false)
  const [addingExpense, setAddingExpense] = React.useState(false)
  const [openExpenseId, setOpenExpenseId] = React.useState<string | null>(null)
  const [editingExpense, setEditingExpense] = React.useState<ExpenseDetailResponse | null>(null)
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null)

  if (event.isPending || group.isPending) {
    return (
      <AppShell>
        <div className="flex flex-col gap-4" aria-label="Loading">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-40" />
        </div>
      </AppShell>
    )
  }
  if (!event.data || !group.data || event.data.groupId !== groupId) {
    const status = event.error instanceof ApiError ? event.error.status : 0
    return (
      <AppShell>
        {status === 404 || event.data ? (
          <NotFound groupId={groupId} />
        ) : (
          <Alert variant="destructive">
            <AlertDescription>
              {formErrorMessage(event.error ?? group.error) ?? "Couldn't load this event."}
            </AlertDescription>
          </Alert>
        )}
      </AppShell>
    )
  }

  const data = event.data
  const archived = group.data.archivedAt !== null
  const cancelled = data.status === "cancelled"
  const canChange = data.canEdit && !cancelled && !archived

  function confirmCancel() {
    setConfirm({
      title: `Cancel ${data.title}?`,
      description:
        "Everyone sees it as cancelled and can’t RSVP any more. The chat and any expenses stay.",
      confirmLabel: "Cancel event",
      destructive: true,
      onConfirm: async () => {
        try {
          await cancel.mutateAsync(undefined)
          toast.success("Event cancelled")
        } catch (err) {
          toast.error(formErrorMessage(err) ?? "Couldn't cancel it. Try again.")
          throw err
        }
      },
    })
  }

  return (
    <AppShell>
      <section className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link to={`/groups/${groupId}?tab=events`} />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          {group.data.name}
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1
              className={cn(
                "text-3xl font-extrabold tracking-tight break-words sm:text-4xl",
                cancelled && "text-muted-foreground line-through"
              )}
            >
              {data.title}
            </h1>
            <p className="flex items-center gap-2 text-muted-foreground">
              <CalendarDaysIcon className="size-4 shrink-0" aria-hidden />
              {formatEventTime(data.startsAt, data.endsAt)}
            </p>
            {data.location && (
              <p className="flex items-center gap-2 text-muted-foreground">
                <MapPinIcon className="size-4 shrink-0" aria-hidden />
                <a
                  href={mapsUrl(data.location)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-words underline-offset-4 hover:text-foreground hover:underline"
                >
                  {data.location}
                </a>
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Planned by {data.createdBy.userId === me.id ? "you" : data.createdBy.name}
            </p>
          </div>
          {canChange && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon" />}
                aria-label="Event options"
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon />
                    Edit event
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={confirmCancel}>
                    <XCircleIcon />
                    Cancel event
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {cancelled && (
          <Alert>
            <AlertTitle>This event was cancelled</AlertTitle>
            <AlertDescription>The chat and expenses are kept for the record.</AlertDescription>
          </Alert>
        )}
        {data.description && (
          <p className="max-w-prose break-words whitespace-pre-wrap">{data.description}</p>
        )}
        {!cancelled && !archived && <RsvpPicker event={data} disabled={false} />}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Comments eventId={data.id} myUserId={me.id} canPost={!archived} onConfirm={setConfirm} />
        <div className="flex flex-col gap-6">
          <WhosComing event={data} myUserId={me.id} />
          <Spending
            event={data}
            myUserId={me.id}
            canAdd={!archived}
            onAdd={() => setAddingExpense(true)}
            onOpen={setOpenExpenseId}
          />
        </div>
      </div>

      <EventFormDialog groupId={groupId} event={data} open={editing} onOpenChange={setEditing} />
      <ExpenseFormDialog
        group={group.data}
        myUserId={me.id}
        eventId={data.id}
        open={addingExpense}
        onOpenChange={setAddingExpense}
      />
      {editingExpense && (
        <ExpenseFormDialog
          key={editingExpense.id}
          group={group.data}
          myUserId={me.id}
          expense={editingExpense}
          open
          onOpenChange={(open) => !open && setEditingExpense(null)}
        />
      )}
      <ExpenseDetailDialog
        groupId={groupId}
        expenseId={openExpenseId}
        myUserId={me.id}
        archived={archived}
        onClose={() => setOpenExpenseId(null)}
        onEdit={(expense) => {
          setOpenExpenseId(null)
          setEditingExpense(expense)
        }}
        onConfirm={setConfirm}
      />
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </AppShell>
  )
}
