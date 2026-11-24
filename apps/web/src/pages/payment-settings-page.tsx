import {
  BANKS,
  bankByBin,
  normalizeHolderName,
  type PaymentAccountResponse,
  paymentAccountSchema,
  type SepayKeyResponse,
} from "@twg/shared"
import { ArrowLeftIcon, BanknoteIcon, CircleCheckIcon, ZapIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { ConfirmDialog, type ConfirmRequest } from "@/components/confirm-dialog"
import { CopyValue } from "@/components/payments/copy-value"
import { UnmatchedTransfersCard } from "@/components/payments/unmatched-transfers-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { formatRelative } from "@/lib/format"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"
import {
  useCreateSepayKey,
  usePaymentAccount,
  useRemovePaymentAccount,
  useRemoveSepayKey,
  useSavePaymentAccount,
} from "@/lib/payments"

const bankItems = BANKS.map((bank) => ({ value: bank.bin, label: bank.name }))

function BankAccountCard({
  account,
  defaultName,
  onConfirm,
}: {
  account: PaymentAccountResponse | null
  defaultName: string
  onConfirm: (request: ConfirmRequest) => void
}) {
  const [bankBin, setBankBin] = React.useState(account?.bankBin ?? "")
  const [holderName, setHolderName] = React.useState(
    account?.holderName ?? normalizeHolderName(defaultName)
  )
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const save = useSavePaymentAccount()
  const remove = useRemovePaymentAccount()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { data, errors } = validate(paymentAccountSchema, {
      bankBin,
      accountNumber: form.get("accountNumber"),
      holderName,
    })
    setFieldErrors(errors ?? {})
    setFormError(null)
    if (!data) return
    const movesAccount =
      account?.sepayConnected &&
      (account.bankBin !== data.bankBin || account.accountNumber !== data.accountNumber)
    try {
      const saved = await save.mutateAsync(data)
      setHolderName(saved.holderName)
      toast.success(
        movesAccount
          ? "Bank account saved. SePay is off until you set it up again."
          : "Bank account saved"
      )
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  function confirmRemove() {
    onConfirm({
      title: "Remove your bank account?",
      description:
        "People paying you won't see a QR code any more, and SePay stops confirming payments. Payments you already got stay as they are.",
      confirmLabel: "Remove bank account",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(undefined)
          setBankBin("")
          toast.success("Bank account removed")
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Couldn't remove it. Try again.")
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>Bank account</CardTitle>
          <CardDescription>
            Where people in your groups send money they owe you. Only the person paying you sees it,
            on the payment screen.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-invalid={!!fieldErrors.bankBin || undefined}>
              <FieldLabel htmlFor="bank">Bank</FieldLabel>
              <Select
                items={bankItems}
                value={bankBin || null}
                onValueChange={(value) => {
                  setBankBin((value as string | null) ?? "")
                  setFieldErrors((e) => ({ ...e, bankBin: undefined }))
                }}
              >
                <SelectTrigger
                  id="bank"
                  className="w-full"
                  aria-invalid={!!fieldErrors.bankBin || undefined}
                >
                  <SelectValue placeholder="Choose your bank" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {bankItems.map((bank) => (
                      <SelectItem key={bank.value} value={bank.value}>
                        {bank.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError>{fieldErrors.bankBin}</FieldError>
            </Field>
            <Field data-invalid={!!fieldErrors.accountNumber || undefined}>
              <FieldLabel htmlFor="account-number">Account number</FieldLabel>
              <Input
                id="account-number"
                name="accountNumber"
                inputMode="numeric"
                autoComplete="off"
                defaultValue={account?.accountNumber}
                aria-invalid={!!fieldErrors.accountNumber || undefined}
                onChange={() => setFieldErrors((e) => ({ ...e, accountNumber: undefined }))}
              />
              <FieldError>{fieldErrors.accountNumber}</FieldError>
            </Field>
            <Field data-invalid={!!fieldErrors.holderName || undefined}>
              <FieldLabel htmlFor="holder-name">Name on the account</FieldLabel>
              <Input
                id="holder-name"
                value={holderName}
                autoComplete="off"
                aria-invalid={!!fieldErrors.holderName || undefined}
                onChange={(event) => {
                  setHolderName(event.target.value)
                  setFieldErrors((e) => ({ ...e, holderName: undefined }))
                }}
                onBlur={() => setHolderName(normalizeHolderName(holderName))}
              />
              <FieldDescription>As your bank shows it, without accents.</FieldDescription>
              <FieldError>{fieldErrors.holderName}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            {account ? "Save changes" : "Save bank account"}
          </Button>
          {account && (
            <Button type="button" variant="ghost" onClick={confirmRemove}>
              Remove
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}

function SepayKeyDialog({
  result,
  onClose,
}: {
  result: SepayKeyResponse | null
  onClose: () => void
}) {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Finish in SePay</DialogTitle>
          <DialogDescription>
            In SePay, go to Webhooks and add one for your {result?.account.bankName} account with
            these settings.
          </DialogDescription>
        </DialogHeader>
        {result && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sepay-url">Webhook URL</FieldLabel>
              <CopyValue id="sepay-url" value={result.webhookUrl} label="Webhook URL" />
            </Field>
            <Field>
              <FieldLabel htmlFor="sepay-key">API key</FieldLabel>
              <CopyValue id="sepay-key" value={result.apiKey} label="API key" mono />
              <FieldDescription>
                Choose “API Key” as the authentication type. This is the only time you’ll see the
                key: if you lose it, make a new one.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Event</FieldLabel>
              <FieldDescription>
                Money in (“Có tiền vào”). Leave the rest as it is.
              </FieldDescription>
            </Field>
          </FieldGroup>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SepayCard({
  account,
  onConfirm,
}: {
  account: PaymentAccountResponse
  onConfirm: (request: ConfirmRequest) => void
}) {
  const [result, setResult] = React.useState<SepayKeyResponse | null>(null)
  const create = useCreateSepayKey()
  const remove = useRemoveSepayKey()
  const supported = bankByBin(account.bankBin)?.sepay ?? false

  async function makeKey() {
    try {
      setResult(await create.mutateAsync(undefined))
    } catch (error) {
      toast.error(formErrorMessage(error) ?? "Couldn't set up SePay. Try again.")
    }
  }

  function confirmNewKey() {
    onConfirm({
      title: "Make a new key?",
      description:
        "The old key stops working straight away. Payments won't confirm on their own until you put the new key in SePay.",
      confirmLabel: "Make a new key",
      onConfirm: makeKey,
    })
  }

  function confirmTurnOff() {
    onConfirm({
      title: "Turn off automatic confirmation?",
      description:
        "You'll confirm payments yourself. Remove the webhook in SePay too, so it stops sending.",
      confirmLabel: "Turn off",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(undefined)
          toast.success("Automatic confirmation turned off")
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Couldn't turn it off. Try again.")
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Confirm payments automatically
          {account.sepayConnected && <Badge variant="secondary">On</Badge>}
        </CardTitle>
        <CardDescription>
          With a free SePay account watching your bank account, payments to you are marked as paid
          the moment the money arrives. Without it, you confirm each payment yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!supported && (
          <Alert>
            <AlertTitle>SePay can’t watch {account.bankName} accounts yet</AlertTitle>
            <AlertDescription>
              People can still pay you by QR code; you confirm the payments yourself.
            </AlertDescription>
          </Alert>
        )}
        {account.sepayConnected && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-primary" />
            {account.sepayLastEventAt
              ? `Last heard from SePay ${formatRelative(account.sepayLastEventAt)}.`
              : "Waiting for the first transfer from SePay."}{" "}
            Key ends in {account.sepayKeyHint}.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        {account.sepayConnected ? (
          <>
            <Button variant="outline" onClick={confirmNewKey}>
              Make a new key
            </Button>
            <Button variant="ghost" onClick={confirmTurnOff}>
              Turn off
            </Button>
          </>
        ) : (
          <Button onClick={() => void makeKey()} disabled={!supported || create.isPending}>
            {create.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ZapIcon data-icon="inline-start" />
            )}
            Set up SePay
          </Button>
        )}
      </CardFooter>
      <SepayKeyDialog result={result} onClose={() => setResult(null)} />
    </Card>
  )
}

export function PaymentSettingsPage() {
  const me = useMe()
  const account = usePaymentAccount()
  const [confirm, setConfirm] = React.useState<ConfirmRequest | null>(null)

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
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            <BanknoteIcon className="size-8 text-primary" aria-hidden />
            Getting paid
          </h1>
          <p className="max-w-prose text-muted-foreground">
            Money goes straight from their bank to yours. TogetherWeGo never holds it.
          </p>
        </div>
      </section>

      {account.isPending ? (
        <div className="flex flex-col gap-4" aria-label="Loading">
          <Skeleton className="h-80" />
          <Skeleton className="h-40" />
        </div>
      ) : account.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            Couldn't load your bank details.
            <Button variant="outline" size="sm" onClick={() => void account.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <BankAccountCard
            key={account.data?.updatedAt ?? "new"}
            account={account.data}
            defaultName={me.name}
            onConfirm={setConfirm}
          />
          <div className="flex flex-col gap-6">
            {account.data && <SepayCard account={account.data} onConfirm={setConfirm} />}
            <UnmatchedTransfersCard myUserId={me.id} />
          </div>
        </div>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </AppShell>
  )
}
