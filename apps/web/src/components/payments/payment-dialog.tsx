import {
  type Currency,
  CURRENCY_DECIMALS,
  formatAmountInput,
  MAX_AMOUNT,
  parseAmount,
  type PersonRef,
  type SettlementDetailResponse,
} from "@twg/shared"
import { CircleCheckIcon, ClockIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { PersonAvatar } from "@/components/member-avatars"
import { CopyValue } from "@/components/payments/copy-value"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { money } from "@/lib/expenses"
import { formErrorMessage } from "@/lib/form-errors"
import {
  useCancelSettlement,
  useConfirmSettlement,
  useCreateSettlement,
  useSettlement,
} from "@/lib/payments"
import { translateMessage } from "@/i18n/messages"

/** A payment someone is about to start, from a suggested transfer. */
export interface PaymentDraft {
  from: PersonRef
  to: PersonRef
  amount: number
}

function AmountInput({
  id,
  currency,
  value,
  onChange,
  invalid,
}: {
  id: string
  currency: Currency
  value: string
  onChange: (value: string) => void
  invalid: boolean
}) {
  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        inputMode={CURRENCY_DECIMALS[currency] ? "decimal" : "numeric"}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const amount = parseAmount(value, currency)
          if (amount !== null) onChange(formatAmountInput(amount, currency))
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{currency === "VND" ? "₫" : "$"}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  )
}

function checkAmount(text: string, currency: Currency): { amount: number } | { error: string } {
  const amount = parseAmount(text, currency)
  if (amount === null || amount <= 0) {
    return { error: translateMessage("Enter an amount greater than 0") }
  }
  if (amount > MAX_AMOUNT[currency]) return { error: translateMessage("That amount is too large") }
  return { amount }
}

/** Step 1: how much, then start the payment (payer) or record it as received (payee). */
function StartPayment({
  groupId,
  currency,
  draft,
  myUserId,
  onStarted,
}: {
  groupId: string
  currency: Currency
  draft: PaymentDraft
  myUserId: string
  onStarted: (settlement: SettlementDetailResponse) => void
}) {
  const { t } = useTranslation()
  const [text, setText] = React.useState(formatAmountInput(draft.amount, currency))
  const [error, setError] = React.useState<string | null>(null)
  const create = useCreateSettlement(groupId)
  const iAmPaying = draft.from.userId === myUserId

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const checked = checkAmount(text, currency)
    if ("error" in checked) {
      setError(checked.error)
      return
    }
    try {
      const settlement = await create.mutateAsync({
        fromUserId: draft.from.userId,
        toUserId: draft.to.userId,
        amount: checked.amount,
      })
      if (!iAmPaying)
        toast.success(
          t("payDialog.recordedFrom", {
            amount: money(checked.amount, currency),
            name: draft.from.name,
          })
        )
      onStarted(settlement)
    } catch (err) {
      setError(formErrorMessage(err) ?? t("payDialog.checkAmount"))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>
          {iAmPaying
            ? t("payDialog.payName", { name: draft.to.name })
            : t("payDialog.paidYou", { name: draft.from.name })}
        </DialogTitle>
        <DialogDescription>
          {iAmPaying
            ? t("payDialog.youOweHint", { amount: money(draft.amount, currency) })
            : t("payDialog.recordHint")}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!error || undefined}>
          <FieldLabel htmlFor="payment-amount">{t("payDialog.amount")}</FieldLabel>
          <AmountInput
            id="payment-amount"
            currency={currency}
            value={text}
            invalid={!!error}
            onChange={(value) => {
              setText(value)
              setError(null)
            }}
          />
          <FieldError>{error}</FieldError>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Spinner data-icon="inline-start" />}
          {iAmPaying ? t("payDialog.showHow") : t("payDialog.recordPayment")}
        </Button>
      </DialogFooter>
    </form>
  )
}

function Paid({
  settlement,
  myUserId,
}: {
  settlement: SettlementDetailResponse
  myUserId: string
}) {
  const { t } = useTranslation()
  const paid = settlement.paidAmount ?? settlement.amount
  const iPaid = settlement.from.userId === myUserId
  const short = paid < settlement.amount
  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <CircleCheckIcon className="size-12 text-primary" aria-hidden />
      <p className="text-2xl font-extrabold tracking-tight tabular-nums">
        {money(paid, settlement.currency)}
      </p>
      <p className="text-muted-foreground">
        {iPaid
          ? t("payDialog.paidTo", { name: settlement.to.name })
          : t("payDialog.paidBy", { name: settlement.from.name })}
        {settlement.confirmedVia === "sepay" ? t("payDialog.confirmedByBank") : "."}
      </p>
      {short && (
        <p className="text-sm text-muted-foreground">
          {t("payDialog.stillOwed", {
            amount: money(settlement.amount - paid, settlement.currency),
          })}
        </p>
      )}
    </div>
  )
}

/** What the payer sees: QR code and bank details, and whether it has arrived. */
function HowToPay({ settlement }: { settlement: SettlementDetailResponse }) {
  const { t } = useTranslation()
  const payee = settlement.payee
  if (!payee) {
    return (
      <Alert>
        <AlertDescription>{t("payDialog.noBank", { name: settlement.to.name })}</AlertDescription>
      </Alert>
    )
  }
  return (
    <div className="flex flex-col gap-5">
      {payee.qrUrl && (
        <figure className="flex flex-col items-center gap-2">
          <img
            src={payee.qrUrl}
            alt={t("payDialog.qrAlt", {
              amount: money(settlement.amount, settlement.currency),
              name: payee.holderName,
            })}
            referrerPolicy="no-referrer"
            className="size-56 rounded-xl border bg-white p-2"
          />
          <figcaption className="text-sm text-muted-foreground">{t("payDialog.scan")}</figcaption>
        </figure>
      )}
      <FieldGroup className="gap-4">
        <Field>
          <FieldLabel htmlFor="pay-code">{t("payDialog.transferMessage")}</FieldLabel>
          <CopyValue
            id="pay-code"
            value={settlement.paymentCode}
            label={t("payDialog.paymentCode")}
            mono
          />
          <FieldDescription>{t("payDialog.codeHint")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="pay-account">
            {payee.bankName} · {payee.holderName}
          </FieldLabel>
          <CopyValue
            id="pay-account"
            value={payee.accountNumber}
            label={t("payDialog.accountNumber")}
            mono
          />
        </Field>
      </FieldGroup>
    </div>
  )
}

function PendingStatus({
  settlement,
  myUserId,
}: {
  settlement: SettlementDetailResponse
  myUserId: string
}) {
  const { t } = useTranslation()
  const iAmPaying = settlement.from.userId === myUserId
  const text = iAmPaying
    ? settlement.autoConfirm
      ? t("payDialog.autoUpdates")
      : t("payDialog.willMark", { name: settlement.to.name })
    : settlement.autoConfirm
      ? t("payDialog.sepayConfirms")
      : t("payDialog.checkBank")
  return (
    <p className="flex items-start gap-2 text-sm text-muted-foreground" role="status">
      <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {text}
    </p>
  )
}

/** The payee confirms, optionally with a different amount. */
function ConfirmReceived({
  settlement,
  onDone,
}: {
  settlement: SettlementDetailResponse
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = React.useState(formatAmountInput(settlement.amount, settlement.currency))
  const [error, setError] = React.useState<string | null>(null)
  const confirm = useConfirmSettlement(settlement.groupId)
  const cancel = useCancelSettlement(settlement.groupId)

  async function onConfirm() {
    const checked = checkAmount(text, settlement.currency)
    if ("error" in checked) {
      setError(checked.error)
      return
    }
    try {
      await confirm.mutateAsync({ id: settlement.id, amount: checked.amount })
      toast.success(t("payDialog.markedReceived"))
    } catch (err) {
      setError(formErrorMessage(err) ?? t("payDialog.confirmFailed"))
    }
  }

  async function onCancel() {
    try {
      await cancel.mutateAsync(settlement.id)
      toast.success(t("payDialog.cancelled"))
      onDone()
    } catch (err) {
      setError(formErrorMessage(err) ?? t("payDialog.cancelFailed"))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Field data-invalid={!!error || undefined}>
        <FieldLabel htmlFor="received-amount">{t("payDialog.arrivedAmount")}</FieldLabel>
        <AmountInput
          id="received-amount"
          currency={settlement.currency}
          value={text}
          invalid={!!error}
          onChange={(value) => {
            setText(value)
            setError(null)
          }}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <DialogFooter>
        <Button variant="ghost" onClick={() => void onCancel()} disabled={cancel.isPending}>
          {t("payDialog.didntArrive")}
        </Button>
        <Button onClick={() => void onConfirm()} disabled={confirm.isPending}>
          {confirm.isPending && <Spinner data-icon="inline-start" />}
          {t("payDialog.markReceived")}
        </Button>
      </DialogFooter>
    </div>
  )
}

function ShowPayment({
  settlementId,
  myUserId,
  onClose,
}: {
  settlementId: string
  myUserId: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const query = useSettlement(settlementId)
  const settlement = query.data
  const groupId = settlement?.groupId ?? ""
  const cancel = useCancelSettlement(groupId)

  // Say so when SePay confirms it while the payer is looking at the QR code.
  const lastStatus = React.useRef(settlement?.status)
  React.useEffect(() => {
    const paying = settlement?.from.userId === myUserId
    if (paying && lastStatus.current === "pending" && settlement?.status === "confirmed") {
      toast.success(t("payDialog.confirmedTo", { name: settlement.to.name }))
    }
    lastStatus.current = settlement?.status
  }, [settlement?.status, settlement?.to.name, settlement?.from.userId, myUserId, t])

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3">
        <DialogTitle className="sr-only">{t("payDialog.payment")}</DialogTitle>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56" />
      </div>
    )
  }
  if (!settlement) {
    return (
      <>
        <DialogTitle>{t("payDialog.payment")}</DialogTitle>
        <Alert variant="destructive">
          <AlertDescription>
            {formErrorMessage(query.error) ?? t("payDialog.loadFailed")}
          </AlertDescription>
        </Alert>
      </>
    )
  }

  const iAmPaying = settlement.from.userId === myUserId
  const iAmPaid = settlement.to.userId === myUserId
  const title = iAmPaying
    ? t("payDialog.payName", { name: settlement.to.name })
    : iAmPaid
      ? t("payDialog.from", { name: settlement.from.name })
      : `${settlement.from.name} → ${settlement.to.name}`

  return (
    <div className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <PersonAvatar person={iAmPaying ? settlement.to : settlement.from} size="sm" />
          {title}
        </DialogTitle>
        <DialogDescription>
          {settlement.status === "pending"
            ? `${money(settlement.amount, settlement.currency)}${settlement.stale ? t("payDialog.stale") : ""}`
            : settlement.status === "cancelled"
              ? t("payDialog.wasCancelled")
              : t("payDialog.done")}
        </DialogDescription>
      </DialogHeader>

      {settlement.status === "confirmed" && <Paid settlement={settlement} myUserId={myUserId} />}

      {settlement.status === "pending" && (
        <>
          {iAmPaying && <HowToPay settlement={settlement} />}
          {(iAmPaying || iAmPaid) && <PendingStatus settlement={settlement} myUserId={myUserId} />}
          {iAmPaid && !settlement.autoConfirm && settlement.currency === "VND" && (
            <p className="text-sm text-muted-foreground">
              {t("payDialog.wantAuto")}{" "}
              <Link
                to="/settings/payments"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t("payDialog.setUpSepay")}
              </Link>
              .
            </p>
          )}
          {settlement.canConfirm && <ConfirmReceived settlement={settlement} onDone={onClose} />}
          {iAmPaying && settlement.canCancel && (
            <DialogFooter>
              <Button
                variant="ghost"
                disabled={cancel.isPending}
                onClick={() =>
                  cancel.mutate(settlement.id, {
                    onSuccess: () => {
                      toast.success(t("payDialog.cancelled"))
                      onClose()
                    },
                    onError: (err) =>
                      toast.error(formErrorMessage(err) ?? t("payDialog.cancelFailedShort")),
                  })
                }
              >
                {t("payDialog.cancelPayment")}
              </Button>
              <Button onClick={onClose}>{t("payDialog.sentIt")}</Button>
            </DialogFooter>
          )}
        </>
      )}
    </div>
  )
}

/**
 * One dialog for the whole payment flow: start it from a suggested transfer (draft), then
 * show how to pay and whether it has arrived. Opening an existing payment skips the start.
 */
export function PaymentDialog({
  groupId,
  currency,
  myUserId,
  draft,
  settlementId,
  onClose,
}: {
  groupId: string
  currency: Currency
  myUserId: string
  draft: PaymentDraft | null
  settlementId: string | null
  onClose: () => void
}) {
  const [startedId, setStartedId] = React.useState<string | null>(null)
  const open = draft !== null || settlementId !== null
  const shownId = settlementId ?? startedId

  React.useEffect(() => {
    if (!open) setStartedId(null)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {shownId ? (
          <ShowPayment settlementId={shownId} myUserId={myUserId} onClose={onClose} />
        ) : (
          draft && (
            <StartPayment
              groupId={groupId}
              currency={currency}
              draft={draft}
              myUserId={myUserId}
              onStarted={(s) => setStartedId(s.id)}
            />
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
