import {
  computeSplits,
  createExpenseSchema,
  type CreateExpenseInput,
  type Currency,
  CURRENCY_DECIMALS,
  type ExpenseDetailResponse,
  formatAmountInput,
  type GroupDetailResponse,
  parseAmount,
  type SplitType,
} from "@twg/shared"
import { ImageIcon, XIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import { PersonAvatar } from "@/components/member-avatars"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ApiError } from "@/lib/api"
import {
  money,
  ReceiptError,
  today,
  uploadReceipt,
  useCreateExpense,
  useUpdateExpense,
} from "@/lib/expenses"
import { formatEventTime, useEvents } from "@/lib/events"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"

const NO_EVENT = "none"

const SPLIT_TYPES: SplitType[] = ["equal", "exact", "percent", "shares"]

/** What each person's input box holds, as typed. */
type Entries = Record<string, { included: boolean; text: string }>

interface FormState {
  title: string
  amountText: string
  payerId: string
  spentOn: string
  splitType: SplitType
  entries: Entries
  note: string
  receiptKey: string | null
  receiptPreview: string | null
  eventId: string | null
}

function initialState(
  group: GroupDetailResponse,
  myUserId: string,
  expense?: ExpenseDetailResponse,
  eventId: string | null = null
): FormState {
  const entries: Entries = {}
  for (const member of group.members) {
    entries[member.userId] = { included: !expense, text: "" }
  }
  if (expense) {
    for (const split of expense.splits) {
      entries[split.userId] = {
        included: true,
        text:
          expense.splitType === "exact"
            ? formatAmountInput(split.value, expense.currency)
            : expense.splitType === "percent"
              ? String(split.value / 100)
              : expense.splitType === "shares"
                ? String(split.value)
                : "",
      }
    }
  }
  return {
    title: expense?.title ?? "",
    amountText: expense ? formatAmountInput(expense.amount, expense.currency) : "",
    payerId: expense?.payer.userId ?? myUserId,
    spentOn: expense?.spentOn ?? today(),
    splitType: expense?.splitType ?? "equal",
    entries,
    note: expense?.note ?? "",
    receiptKey: expense?.hasReceipt ? "existing" : null,
    receiptPreview: expense?.receiptUrl ?? null,
    eventId: expense ? (expense.event?.id ?? null) : eventId,
  }
}

/** "33.33" -> 3333 basis points; null when it isn't a number with at most 2 decimals. */
function parsePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"))
}

/** Converts what was typed into the API's split entries. Unparseable boxes become null. */
function toSplitEntries(
  state: FormState,
  currency: Currency
): { userId: string; value: number }[] | null {
  const result: { userId: string; value: number }[] = []
  for (const [userId, entry] of Object.entries(state.entries)) {
    if (state.splitType === "equal") {
      if (entry.included) result.push({ userId, value: 0 })
      continue
    }
    if (entry.text.trim() === "") continue
    const value =
      state.splitType === "exact"
        ? parseAmount(entry.text, currency)
        : state.splitType === "percent"
          ? parsePercent(entry.text)
          : /^\d+$/.test(entry.text.trim())
            ? Number(entry.text.trim())
            : null
    if (value === null) return null
    if (value > 0) result.push({ userId, value })
  }
  return result
}

/** A one-line status under the people list, e.g. "45.000 ₫ left to assign". */
function remainderHint(
  state: FormState,
  amount: number | null,
  entries: { userId: string; value: number }[] | null,
  currency: Currency,
  t: TFunction
): string | null {
  if (!entries) return null
  if (state.splitType === "exact" && amount !== null) {
    const left = amount - entries.reduce((sum, e) => sum + e.value, 0)
    if (left > 0) return t("expenseForm.leftToAssign", { value: money(left, currency) })
    if (left < 0) return t("expenseForm.tooMuch", { value: money(-left, currency) })
    return null
  }
  if (state.splitType === "percent") {
    const left = 10_000 - entries.reduce((sum, e) => sum + e.value, 0)
    if (left > 0) return t("expenseForm.leftToAssign", { value: `${left / 100}%` })
    if (left < 0) return t("expenseForm.tooMuch", { value: `${-left / 100}%` })
  }
  return null
}

export function ExpenseFormDialog({
  group,
  myUserId,
  expense,
  eventId = null,
  open,
  onOpenChange,
}: {
  group: GroupDetailResponse
  myUserId: string
  /** Given when editing. */
  expense?: ExpenseDetailResponse
  /** For a new expense started from an event's page. */
  eventId?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const currency = group.currency
  const [state, setState] = React.useState(() => initialState(group, myUserId, expense, eventId))
  const upcoming = useEvents(group.id, "upcoming", open)
  const recent = useEvents(group.id, "past", open)
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const create = useCreateExpense(group.id)
  const update = useUpdateExpense(group.id, expense?.id ?? "")
  const pending = create.isPending || update.isPending
  const fileInput = React.useRef<HTMLInputElement>(null)

  // Upcoming and recent events, plus the linked one even if it's older than that.
  const eventOptions = React.useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>()
    const add = (e: { id: string; title: string; startsAt: string }) =>
      seen.set(e.id, { value: e.id, label: `${e.title} · ${formatEventTime(e.startsAt, null)}` })
    for (const page of upcoming.data?.pages ?? []) page.items.forEach(add)
    for (const page of recent.data?.pages ?? []) page.items.forEach(add)
    if (expense?.event) add(expense.event)
    return [...seen.values()]
  }, [upcoming.data, recent.data, expense?.event])

  React.useEffect(() => {
    if (open) {
      setState(initialState(group, myUserId, expense, eventId))
      setFieldErrors({})
      setFormError(null)
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Editing a field clears its error, so stale messages never hide live hints.
  const FIELD_FOR: Partial<Record<keyof FormState, string>> = {
    title: "title",
    amountText: "amount",
    payerId: "payerId",
    spentOn: "spentOn",
    splitType: "splits",
    entries: "splits",
    note: "note",
    receiptKey: "receiptKey",
    eventId: "eventId",
  }
  const clearError = (key: keyof FormState) => {
    const field = FIELD_FOR[key]
    if (field) setFieldErrors(({ [field]: _cleared, ...rest }) => rest)
  }
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    clearError(key)
    setState((s) => ({ ...s, [key]: value }))
  }
  const setEntry = (userId: string, patch: Partial<Entries[string]>) => {
    clearError("entries")
    setState((s) => ({
      ...s,
      entries: { ...s.entries, [userId]: { ...s.entries[userId]!, ...patch } },
    }))
  }

  const amount = parseAmount(state.amountText, currency)
  const entries = toSplitEntries(state, currency)
  const preview =
    amount !== null && amount > 0 && entries && entries.length > 0
      ? computeSplits(amount, state.splitType, entries)
      : null
  const previewAmounts = new Map(preview?.ok ? preview.splits.map((s) => [s.userId, s.amount]) : [])
  const hint = remainderHint(state, amount, entries, currency, t)

  async function onPickReceipt(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    setUploading(true)
    try {
      const key = await uploadReceipt(group.id, file)
      setState((s) => ({ ...s, receiptKey: key, receiptPreview: URL.createObjectURL(file) }))
    } catch (error) {
      toast.error(
        error instanceof ReceiptError
          ? error.message
          : (formErrorMessage(error) ?? t("receipt.uploadFailed"))
      )
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    const errors: FieldErrors = {}
    if (amount === null) {
      errors.amount =
        CURRENCY_DECIMALS[currency] === 0 ? t("expenseForm.amountVnd") : t("expenseForm.amountUsd")
    }
    if (entries === null) {
      errors.splits =
        state.splitType === "percent"
          ? t("expenseForm.percentages")
          : state.splitType === "shares"
            ? t("expenseForm.wholeShares")
            : t("expenseForm.checkAmounts")
    }

    const receiptKey =
      state.receiptKey === "existing" ? (expense?.receiptKey ?? null) : state.receiptKey
    const candidate = {
      title: state.title,
      amount: amount ?? 0,
      payerId: state.payerId,
      splitType: state.splitType,
      splits: entries ?? [],
      spentOn: state.spentOn,
      note: state.note.trim() === "" ? null : state.note,
      receiptKey,
      eventId: state.eventId,
    }
    const { data, errors: schemaErrors } = validate(createExpenseSchema(currency), candidate)
    const merged = { ...schemaErrors, ...errors }
    setFieldErrors(merged)
    if (!data || Object.keys(errors).length > 0) return

    try {
      if (expense) {
        await update.mutateAsync({ ...data, version: expense.version })
        toast.success(t("expenseForm.updated"))
      } else {
        await create.mutateAsync(data as CreateExpenseInput)
        toast.success(t("expenseForm.added", { title: data.title }))
      }
      onOpenChange(false)
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  const peopleLabel =
    state.splitType === "equal"
      ? t("expenseForm.whoShared")
      : state.splitType === "exact"
        ? t("expenseForm.howMuchEach")
        : state.splitType === "percent"
          ? t("expenseForm.eachPercent")
          : t("expenseForm.eachShares")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>
              {expense ? t("expenseForm.editTitle") : t("expenseForm.addTitle")}
            </DialogTitle>
            <DialogDescription>
              {expense
                ? t("expenseForm.editHint")
                : t("expenseForm.addHint", { group: group.name })}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <FieldGroup>
            <Field data-invalid={!!fieldErrors.title || undefined}>
              <FieldLabel htmlFor="expense-title">{t("expenseForm.whatFor")}</FieldLabel>
              <Input
                id="expense-title"
                value={state.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder={t("expenseForm.titlePlaceholder")}
                aria-invalid={!!fieldErrors.title || undefined}
                autoFocus
              />
              <FieldError>{fieldErrors.title}</FieldError>
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={!!fieldErrors.amount || undefined}>
                <FieldLabel htmlFor="expense-amount">{t("expenseForm.amount")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="expense-amount"
                    inputMode="decimal"
                    value={state.amountText}
                    onChange={(e) => set("amountText", e.target.value)}
                    onBlur={() =>
                      amount !== null && set("amountText", formatAmountInput(amount, currency))
                    }
                    placeholder={currency === "VND" ? "150.000" : "12.50"}
                    aria-invalid={!!fieldErrors.amount || undefined}
                    className="tabular-nums"
                  />
                  <InputGroupAddon align="inline-end">
                    {currency === "VND" ? "₫" : "$"}
                  </InputGroupAddon>
                </InputGroup>
                <FieldError>{fieldErrors.amount}</FieldError>
              </Field>

              <Field data-invalid={!!fieldErrors.spentOn || undefined}>
                <FieldLabel htmlFor="expense-date">{t("expenseForm.date")}</FieldLabel>
                <Input
                  id="expense-date"
                  type="date"
                  value={state.spentOn}
                  max={today()}
                  onChange={(e) => set("spentOn", e.target.value)}
                  aria-invalid={!!fieldErrors.spentOn || undefined}
                />
                <FieldError>{fieldErrors.spentOn}</FieldError>
              </Field>
            </div>

            <Field data-invalid={!!fieldErrors.payerId || undefined}>
              <FieldLabel htmlFor="expense-payer">{t("expenseForm.paidBy")}</FieldLabel>
              <Select
                items={group.members.map((m) => ({
                  value: m.userId,
                  label: m.userId === myUserId ? t("balances.nameYou", { name: m.name }) : m.name,
                }))}
                value={state.payerId}
                onValueChange={(value) => value && set("payerId", value as string)}
              >
                <SelectTrigger id="expense-payer" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {group.members.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.userId === myUserId ? t("balances.nameYou", { name: m.name }) : m.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError>{fieldErrors.payerId}</FieldError>
            </Field>

            <FieldSet data-invalid={!!fieldErrors.splits || undefined}>
              <FieldLegend variant="label">{t("expenseForm.split")}</FieldLegend>
              <ToggleGroup
                variant="outline"
                value={[state.splitType]}
                onValueChange={(value: string[]) =>
                  value[0] && set("splitType", value[0] as SplitType)
                }
                className="w-full"
              >
                {SPLIT_TYPES.map((type) => (
                  <ToggleGroupItem key={type} value={type} className="flex-1">
                    {t(`expenseForm.splitLabel.${type}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              <FieldDescription>{peopleLabel}</FieldDescription>
              <ul className="flex flex-col divide-y rounded-lg border">
                {group.members.map((member) => {
                  const entry = state.entries[member.userId] ?? { included: false, text: "" }
                  const share = previewAmounts.get(member.userId)
                  const inputId = `split-${member.userId}`
                  return (
                    <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
                      {state.splitType === "equal" ? (
                        <Checkbox
                          id={inputId}
                          checked={entry.included}
                          onCheckedChange={(checked) =>
                            setEntry(member.userId, { included: checked === true })
                          }
                        />
                      ) : null}
                      <PersonAvatar person={member} size="sm" />
                      <label htmlFor={inputId} className="min-w-0 flex-1 truncate text-sm">
                        {member.userId === myUserId
                          ? t("balances.nameYou", { name: member.name })
                          : member.name}
                      </label>
                      {state.splitType !== "equal" && (
                        <InputGroup className="w-32">
                          <InputGroupInput
                            id={inputId}
                            inputMode={state.splitType === "shares" ? "numeric" : "decimal"}
                            value={entry.text}
                            onChange={(e) => setEntry(member.userId, { text: e.target.value })}
                            placeholder="0"
                            className="text-right tabular-nums"
                          />
                          <InputGroupAddon align="inline-end">
                            {state.splitType === "percent"
                              ? "%"
                              : state.splitType === "shares"
                                ? "×"
                                : currency === "VND"
                                  ? "₫"
                                  : "$"}
                          </InputGroupAddon>
                        </InputGroup>
                      )}
                      {state.splitType !== "exact" && (
                        <span className="w-24 text-right text-sm text-muted-foreground tabular-nums">
                          {share !== undefined ? money(share, currency) : "—"}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
              {hint && !fieldErrors.splits && <FieldDescription>{hint}</FieldDescription>}
              <FieldError>{fieldErrors.splits}</FieldError>
            </FieldSet>

            {eventOptions.length > 0 && (
              <Field data-invalid={!!fieldErrors.eventId || undefined}>
                <FieldLabel htmlFor="expense-event">{t("expenseForm.event")}</FieldLabel>
                <Select
                  items={[{ value: NO_EVENT, label: t("expenseForm.noEvent") }, ...eventOptions]}
                  value={state.eventId ?? NO_EVENT}
                  onValueChange={(value) =>
                    set("eventId", value === NO_EVENT || !value ? null : (value as string))
                  }
                >
                  <SelectTrigger id="expense-event" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_EVENT}>{t("expenseForm.noEvent")}</SelectItem>
                      {eventOptions.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError>{fieldErrors.eventId}</FieldError>
              </Field>
            )}

            <Field data-invalid={!!fieldErrors.note || undefined}>
              <FieldLabel htmlFor="expense-note">{t("expenseForm.note")}</FieldLabel>
              <Textarea
                id="expense-note"
                value={state.note}
                onChange={(e) => set("note", e.target.value)}
                rows={2}
                aria-invalid={!!fieldErrors.note || undefined}
              />
              <FieldError>{fieldErrors.note}</FieldError>
            </Field>

            <Field>
              <FieldLabel>{t("expenseForm.receiptPhoto")}</FieldLabel>
              <input
                ref={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => void onPickReceipt(e)}
              />
              {state.receiptKey ? (
                <div className="flex items-center gap-3">
                  {state.receiptPreview && (
                    <img
                      src={state.receiptPreview}
                      alt={t("expenseForm.receipt")}
                      className="size-16 rounded-md border object-cover"
                    />
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setState((s) => ({ ...s, receiptKey: null, receiptPreview: null }))
                    }
                  >
                    <XIcon data-icon="inline-start" />
                    {t("expenseForm.removePhoto")}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ImageIcon data-icon="inline-start" />
                  )}
                  {uploading ? t("expenseForm.uploading") : t("expenseForm.addPhoto")}
                </Button>
              )}
              <FieldError>{fieldErrors.receiptKey}</FieldError>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={pending || uploading}>
              {pending && <Spinner data-icon="inline-start" />}
              {expense ? t("common.saveChanges") : t("group.addExpense")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
