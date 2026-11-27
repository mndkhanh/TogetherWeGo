import { CalendarDays, Camera, ImageIcon, Link2, Minus, Plus, Trash2, X } from "lucide-react"
import * as React from "react"

import { useConfirm } from "@/components/confirm"
import {
  Avatar,
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
import { AmountField } from "@/components/amount-field"
import { useUser } from "@/lib/auth"
import {
  addExpense,
  dataErrorMessage,
  deleteExpense,
  useEvents,
  useExpenses,
  type Expense,
  type HangoutEvent,
  type Member,
} from "@/lib/data"
import {
  expenseShares,
  formatVnd,
  parseVnd,
  splitByAmounts,
  splitByWeights,
  splitEqually,
  type SplitKind,
} from "@/lib/money"
import { expensePhotoUrl, MAX_PHOTOS, PhotoError } from "@/lib/photos"

function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ExpensesTab({ groupId, members }: { groupId: string; members: Member[] }) {
  const user = useUser()
  const expenses = useExpenses(groupId)
  const events = useEvents(groupId)
  const plans = new Map((events.data ?? []).map((ev) => [ev.id, ev.title]))
  const names = new Map(members.map((m) => [m.uid, m.name]))
  const photos = new Map(members.map((m) => [m.uid, m.photo]))
  const remove = useAction()
  const { confirm, dialog } = useConfirm()

  const askDelete = async (e: Expense) => {
    const ok = await confirm({
      title: `Delete “${e.description}”?`,
      body: (
        <>
          {formatVnd(e.amount)} comes off everyone's balances
          {e.photos.length > 0 ? ", and its photos are deleted" : ""}. This can't be undone.
        </>
      ),
      action: "Delete expense",
    })
    if (ok) void remove.run(() => deleteExpense(groupId, e), dataErrorMessage)
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {dialog}
      <div className="lg:sticky lg:top-6">
        <AddExpense groupId={groupId} members={members} events={events.data ?? []} />
      </div>

      <Panel title="History">
        <ErrorText>{remove.error}</ErrorText>
        {expenses.error ? (
          <ErrorText>{dataErrorMessage(expenses.error)}</ErrorText>
        ) : !expenses.data ? (
          <Loading />
        ) : expenses.data.length === 0 ? (
          <Empty>Nothing yet. Add the first thing someone paid for.</Empty>
        ) : (
          <ul className="-my-2 divide-y divide-line">
            {expenses.data.map((e) => {
              const myShare = expenseShares(e).get(user.uid) ?? 0
              const payer =
                e.paidBy === user.uid ? "You" : (names.get(e.paidBy) ?? "A former member")
              const addedBy =
                e.createdBy === e.paidBy
                  ? null
                  : e.createdBy === user.uid
                    ? "you"
                    : (names.get(e.createdBy) ?? "a former member")
              return (
                <li key={e.id} className="flex items-start gap-3 py-3">
                  <Avatar name={names.get(e.paidBy) ?? "?"} uid={e.paidBy} photo={photos.get(e.paidBy)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{e.description}</p>
                    <p className="text-xs text-muted">
                      {payer} paid ·{" "}
                      {e.split !== "equal"
                        ? `${e.participants.length} people`
                        : e.participants.length === 1
                          ? "not split"
                          : `split ${e.participants.length} ways`}{" "}
                      ·{" "}
                      {new Date(`${e.spentOn}T00:00`).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                    {addedBy && <p className="text-xs text-muted">Added by {addedBy}</p>}
                    {e.eventId && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                        <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">
                          {plans.get(e.eventId) ?? "A plan that was deleted"}
                        </span>
                      </p>
                    )}
                    {e.split !== "equal" && <SplitDetails expense={e} names={names} />}
                    {e.reference && <Reference text={e.reference} />}
                    {e.photos.length > 0 && <ExpensePhotos groupId={groupId} expense={e} />}
                  </div>
                  <div className="text-right">
                    <p className="font-bold tabular-nums">{formatVnd(e.amount)}</p>
                    {myShare > 0 && (
                      <p className="text-xs text-muted tabular-nums">
                        your share {formatVnd(myShare)}
                      </p>
                    )}
                  </div>
                  {(e.createdBy === user.uid || e.paidBy === user.uid) && (
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={`Delete ${e.description}`}
                      disabled={remove.busy}
                      onClick={() => void askDelete(e)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}

const selectClass =
  "h-11 w-full rounded-xl bg-surface px-3 text-sm ring-1 ring-line focus:ring-2 focus:ring-brand focus:outline-none"

const SPLIT_MODES: { id: SplitKind; label: string }[] = [
  { id: "equal", label: "Equally" },
  { id: "shares", label: "By shares" },
  { id: "amounts", label: "By amounts" },
]

/** Shares go up and down in halves: a child might count as ½, a couple as 2. */
const SHARE_STEP = 0.5
const MAX_SHARES = 20

function formatShares(n: number) {
  return n % 1 === 0 ? String(n) : `${Math.floor(n) || ""}½`
}

/** What the form would save: who's in, how much each owes, and the weights to store. */
type Split =
  | { ok: true; participants: string[]; weights: number[] | null; shares: Map<string, number> }
  | { ok: false; message: string }

function computeSplit(
  mode: SplitKind,
  amount: number | null,
  people: string[],
  shareCounts: Record<string, number>,
  amountTexts: Record<string, string>,
): Split {
  if (people.length === 0) return { ok: false, message: "Pick at least one person to split with." }
  if (mode === "equal") {
    return {
      ok: true,
      participants: people,
      weights: null,
      shares: amount ? splitEqually(amount, people) : new Map(),
    }
  }
  if (mode === "shares") {
    const inSplit = people.filter((p) => (shareCounts[p] ?? 1) > 0)
    if (inSplit.length === 0) return { ok: false, message: "Give someone at least ½ a share." }
    const weights = inSplit.map((p) => Math.round((shareCounts[p] ?? 1) * 2))
    return {
      ok: true,
      participants: inSplit,
      weights,
      shares: amount ? splitByWeights(amount, inSplit, weights) : new Map(),
    }
  }
  // By amounts.
  const entries: [string, number | null][] = []
  for (const p of people) {
    const text = (amountTexts[p] ?? "").trim()
    if (!text) {
      entries.push([p, null])
      continue
    }
    const value = parseVnd(text)
    if (!value) return { ok: false, message: `“${text}” isn't an amount. Try 250000 or 250k.` }
    entries.push([p, value])
  }
  if (!amount) return { ok: false, message: "Enter the total first." }
  const result = splitByAmounts(amount, entries)
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.left > 0
          ? `Left to assign: ${formatVnd(result.left)}. Leave someone blank to share the rest.`
          : `That's ${formatVnd(-result.left)} more than the bill.`,
    }
  }
  const inSplit = people.filter((p) => (result.shares.get(p) ?? 0) > 0)
  return {
    ok: true,
    participants: inSplit,
    weights: inSplit.map((p) => result.shares.get(p) ?? 0),
    shares: result.shares,
  }
}

function AddExpense({
  groupId,
  members,
  events,
}: {
  groupId: string
  members: Member[]
  events: HangoutEvent[]
}) {
  const user = useUser()
  const [description, setDescription] = React.useState("")
  const [amountText, setAmountText] = React.useState("")
  const [spentOn, setSpentOn] = React.useState(today)
  const [paidBy, setPaidBy] = React.useState(user.uid)
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set())
  const [mode, setMode] = React.useState<SplitKind>("equal")
  const [shareCounts, setShareCounts] = React.useState<Record<string, number>>({})
  const [amountTexts, setAmountTexts] = React.useState<Record<string, string>>({})
  const [reference, setReference] = React.useState("")
  const [eventId, setEventId] = React.useState("")
  const [photos, setPhotos] = React.useState<File[]>([])
  const { busy, error, run, setError } = useAction()
  // Upcoming plans first (soonest on top), then past ones (most recent on top).
  const now = Date.now()
  const planOptions = [
    ...events.filter((ev) => ev.startsAt.getTime() >= now),
    ...events.filter((ev) => ev.startsAt.getTime() < now).reverse(),
  ]

  const people = members.map((m) => m.uid).filter((uid) => !excluded.has(uid))
  const amount = parseVnd(amountText)
  const split = computeSplit(mode, amount, people, shareCounts, amountTexts)

  const toggle = (uid: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!description.trim()) return setError("Say what it was for.")
    if (!amount) return setError("Enter an amount in dong, like 250000, 250k or 1m.")
    if (!split.ok) return setError(split.message)
    const ok = await run(
      () =>
        addExpense(
          groupId,
          {
            description,
            amount,
            paidBy: members.some((m) => m.uid === paidBy) ? paidBy : user.uid,
            participants: split.participants,
            split: mode,
            weights: split.weights,
            spentOn,
            reference,
            eventId: events.some((ev) => ev.id === eventId) ? eventId : null,
            photoFiles: photos,
          },
          user.uid,
        ),
      (e) => (e instanceof PhotoError ? e.message : dataErrorMessage(e)),
    )
    if (ok) {
      setDescription("")
      setAmountText("")
      setPaidBy(user.uid)
      setExcluded(new Set())
      setMode("equal")
      setShareCounts({})
      setAmountTexts({})
      setReference("")
      setEventId("")
      setPhotos([])
    }
  }

  const shareOf = (uid: string) => (split.ok ? split.shares.get(uid) : undefined)

  return (
    <Panel title="Add an expense">
      <form onSubmit={submit} className="@container flex flex-col gap-4" noValidate>
        <div className="grid gap-4 @xl:grid-cols-[1fr_16rem]">
          <Field label="What for">
            <Input
              placeholder="Lẩu dinner, Grab to the airport…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={120}
            />
          </Field>
          <AmountField value={amountText} onChange={setAmountText} />
        </div>
        <div className="grid gap-4 @md:grid-cols-2">
          <Field label="Paid by">
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className={selectClass}
            >
              <option value={user.uid}>You</option>
              {members
                .filter((m) => m.uid !== user.uid)
                .map((m) => (
                  <option key={m.uid} value={m.uid}>
                    {m.name}
                    {m.altName ? ` (${m.altName})` : ""}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={spentOn}
              max={today()}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </Field>
          {planOptions.length > 0 && (
            <Field label="Plan (optional)" hint="Which plan it was for, from the Plans tab.">
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className={selectClass}
              >
                <option value="">No plan</option>
                {planOptions.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ·{" "}
                    {ev.startsAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">Who's in</legend>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = !excluded.has(m.uid)
              return (
                // Phones: a chip with the name. Large screens: just the avatar, and the name in a
                // small popover on hover or keyboard focus.
                <span key={m.uid} className="group relative">
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={m.name}
                    onClick={() => toggle(m.uid)}
                    className={cx(
                      "flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-sm font-medium ring-1 transition lg:p-0.5",
                      on
                        ? "bg-brand text-white ring-brand"
                        : "bg-surface text-muted ring-line lg:opacity-45 lg:grayscale",
                    )}
                  >
                    <Avatar name={m.name} uid={m.uid} photo={m.photo} size="sm" />
                    <span className="lg:hidden">{m.name}</span>
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 lg:block"
                  >
                    <span className="font-semibold">{m.name}</span>
                    {m.altName && <span className="text-white/70"> · {m.altName}</span>}
                    <span className="block text-white/70">{on ? "In the split" : "Not in the split"}</span>
                  </span>
                </span>
              )
            })}
          </div>

          <div
            role="radiogroup"
            aria-label="How to split"
            className="inline-flex self-start rounded-xl bg-canvas p-1 ring-1 ring-line"
          >
            {SPLIT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => {
                  setMode(m.id)
                  setError(null)
                }}
                className={cx(
                  "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  mode === m.id ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === "equal" ? (
            amount && split.ok && people.length > 0 ? (
              <EqualPreview amount={amount} shares={split.shares} members={members} />
            ) : null
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
              {members
                .filter((m) => !excluded.has(m.uid))
                .map((m) => (
                  <li key={m.uid} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                    {mode === "shares" ? (
                      <ShareStepper
                        name={m.name}
                        value={shareCounts[m.uid] ?? 1}
                        onChange={(v) => setShareCounts((prev) => ({ ...prev, [m.uid]: v }))}
                      />
                    ) : (
                      <div className="w-28 shrink-0">
                        <Input
                          aria-label={`${m.name}'s amount`}
                          placeholder="rest"
                          value={amountTexts[m.uid] ?? ""}
                          onChange={(e) =>
                            setAmountTexts((prev) => ({ ...prev, [m.uid]: e.target.value }))
                          }
                          autoComplete="off"
                          className="h-9 text-right tabular-nums"
                        />
                      </div>
                    )}
                    <span className="w-24 shrink-0 text-right text-sm tabular-nums text-muted">
                      {shareOf(m.uid) !== undefined ? formatVnd(shareOf(m.uid) ?? 0) : "–"}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          {mode === "amounts" && (
            <p className={cx("text-xs", split.ok || !amount ? "text-muted" : "text-owe")}>
              {split.ok || !amount
                ? "Type what each person had. Leave boxes blank to share the rest equally."
                : split.message}
            </p>
          )}
        </fieldset>

        <Field label="Reference (optional)">
          <Input
            placeholder="Bill no. 0123, booking link…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={300}
          />
        </Field>
        <PhotoPicker files={photos} onChange={setPhotos} />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy} className="self-start">
          {busy && photos.length > 0 ? "Uploading photos…" : "Add expense"}
        </Button>
      </form>
    </Panel>
  )
}

/** "333.333 ₫ each, Chi 333.334 ₫": exact, with whoever takes the last dong named. */
function EqualPreview({
  amount,
  shares,
  members,
}: {
  amount: number
  shares: Map<string, number>
  members: Member[]
}) {
  if (shares.size < 2) return null
  const base = Math.floor(amount / shares.size)
  const names = new Map(members.map((m) => [m.uid, m.name]))
  const more = [...shares].filter(([, v]) => v > base)
  return (
    <p className="text-xs text-muted tabular-nums">
      {formatVnd(base)} each
      {more.length > 0 && (
        <>
          , {more.map(([p]) => names.get(p) ?? "?").join(", ")} {formatVnd(base + 1)}
        </>
      )}
      .
    </p>
  )
}

function ShareStepper({
  name,
  value,
  onChange,
}: {
  name: string
  value: number
  onChange: (value: number) => void
}) {
  const step = (by: number) => onChange(Math.min(MAX_SHARES, Math.max(0, value + by)))
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={`Fewer shares for ${name}`}
        disabled={value <= 0}
        onClick={() => step(-SHARE_STEP)}
      >
        <Minus className="size-3.5" aria-hidden />
      </Button>
      <span className="w-9 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {formatShares(value)}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={`More shares for ${name}`}
        disabled={value >= MAX_SHARES}
        onClick={() => step(SHARE_STEP)}
      >
        <Plus className="size-3.5" aria-hidden />
      </Button>
    </div>
  )
}

/** "split by shares ▸": who owes what for an uneven expense, opened on demand. */
function SplitDetails({ expense, names }: { expense: Expense; names: Map<string, string> }) {
  const shares = expenseShares(expense)
  return (
    <details className="mt-1 text-xs text-muted">
      <summary className="cursor-pointer select-none hover:text-ink">
        {expense.split === "shares" ? "split by shares" : "split by amounts"}
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {expense.participants.map((p, i) => (
          <li key={p} className="flex justify-between gap-4 tabular-nums">
            <span className="truncate">
              {names.get(p) ?? "A former member"}
              {expense.split === "shares" && expense.weights && (
                <> × {formatShares((expense.weights[i] ?? 0) / 2)}</>
              )}
            </span>
            <span>{formatVnd(shares.get(p) ?? 0)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Receipt or bill photos for a new expense: picked or taken, shown as thumbnails, removable. */
function PhotoPicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const input = React.useRef<HTMLInputElement>(null)
  const previews = React.useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  React.useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews])

  const add = (picked: FileList | null) => {
    const images = [...(picked ?? [])].filter((f) => f.type.startsWith("image/"))
    onChange([...files, ...images].slice(0, MAX_PHOTOS))
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">Photos (optional)</span>
      <div className="flex flex-wrap gap-2">
        {previews.map((url, i) => (
          <div key={url} className="relative">
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              className="size-16 rounded-lg object-cover ring-1 ring-line"
            />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-white ring-2 ring-surface"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        ))}
        {files.length < MAX_PHOTOS && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex size-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line text-xs text-muted hover:bg-brand-soft hover:text-ink"
          >
            <Camera className="size-5" aria-hidden />
            Add
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ""
        }}
      />
      <span className="text-xs text-muted">Receipts or bills, up to {MAX_PHOTOS}.</span>
    </div>
  )
}

/** A reference as typed. A web link opens in a new tab; anything else is just text. */
function Reference({ text }: { text: string }) {
  const url = /^https?:\/\/\S+$/i.test(text) ? text : null
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
      <Link2 className="size-3.5 shrink-0" aria-hidden />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="truncate font-medium text-brand hover:underline"
        >
          {text}
        </a>
      ) : (
        <span className="truncate">{text}</span>
      )}
    </p>
  )
}

/** Thumbnails of an expense's photos; each opens full size in a new tab. */
function ExpensePhotos({ groupId, expense }: { groupId: string; expense: Expense }) {
  const [urls, setUrls] = React.useState<(string | null)[] | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void Promise.all(
      expense.photos.map((name) => expensePhotoUrl(groupId, expense.id, name).catch(() => null)),
    ).then((found) => !cancelled && setUrls(found))
    return () => {
      cancelled = true
    }
  }, [groupId, expense.id, expense.photos])

  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Photos">
      {expense.photos.map((name, i) => {
        const url = urls?.[i]
        return (
          <li key={name}>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                <img
                  src={url}
                  alt={`Photo ${i + 1} of ${expense.description}`}
                  loading="lazy"
                  className="size-12 rounded-md object-cover ring-1 ring-line hover:ring-brand"
                />
              </a>
            ) : (
              <span
                title={urls ? "This photo is gone" : "Loading"}
                className="flex size-12 items-center justify-center rounded-md bg-canvas text-muted ring-1 ring-line"
              >
                <ImageIcon className="size-4" aria-hidden />
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
