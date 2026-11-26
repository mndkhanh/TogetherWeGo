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
import { useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
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
      toast.success(movesAccount ? t("paySettings.savedMoved") : t("paySettings.saved"))
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    }
  }

  function confirmRemove() {
    onConfirm({
      title: t("paySettings.removeTitle"),
      description: t("paySettings.removeHint"),
      confirmLabel: t("paySettings.removeConfirm"),
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(undefined)
          setBankBin("")
          toast.success(t("paySettings.removed"))
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("paySettings.removeFailed"))
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>{t("paySettings.bankAccount")}</CardTitle>
          <CardDescription>{t("paySettings.bankAccountHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <FieldGroup>
            <Field data-invalid={!!fieldErrors.bankBin || undefined}>
              <FieldLabel htmlFor="bank">{t("paySettings.bank")}</FieldLabel>
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
                  <SelectValue placeholder={t("paySettings.chooseBank")} />
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
              <FieldLabel htmlFor="account-number">{t("paySettings.accountNumber")}</FieldLabel>
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
              <FieldLabel htmlFor="holder-name">{t("paySettings.holderName")}</FieldLabel>
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
              <FieldDescription>{t("paySettings.holderHint")}</FieldDescription>
              <FieldError>{fieldErrors.holderName}</FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner data-icon="inline-start" />}
            {account ? t("common.saveChanges") : t("paySettings.saveAccount")}
          </Button>
          {account && (
            <Button type="button" variant="ghost" onClick={confirmRemove}>
              {t("paySettings.remove")}
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
  const { t } = useTranslation()
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("paySettings.finishTitle")}</DialogTitle>
          <DialogDescription>
            {t("paySettings.finishHint", { bank: result?.account.bankName ?? "" })}
          </DialogDescription>
        </DialogHeader>
        {result && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="sepay-url">{t("paySettings.webhookUrl")}</FieldLabel>
              <CopyValue
                id="sepay-url"
                value={result.webhookUrl}
                label={t("paySettings.webhookUrl")}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sepay-key">{t("paySettings.apiKey")}</FieldLabel>
              <CopyValue
                id="sepay-key"
                value={result.apiKey}
                label={t("paySettings.apiKey")}
                mono
              />
              <FieldDescription>{t("paySettings.apiKeyHint")}</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>{t("paySettings.event")}</FieldLabel>
              <FieldDescription>{t("paySettings.eventHint")}</FieldDescription>
            </Field>
          </FieldGroup>
        )}
        <DialogFooter>
          <Button onClick={onClose}>{t("paySettings.done")}</Button>
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
  const { t } = useTranslation()
  const [result, setResult] = React.useState<SepayKeyResponse | null>(null)
  const create = useCreateSepayKey()
  const remove = useRemoveSepayKey()
  const supported = bankByBin(account.bankBin)?.sepay ?? false

  async function makeKey() {
    try {
      setResult(await create.mutateAsync(undefined))
    } catch (error) {
      toast.error(formErrorMessage(error) ?? t("paySettings.setupFailed"))
    }
  }

  function confirmNewKey() {
    onConfirm({
      title: t("paySettings.newKeyTitle"),
      description: t("paySettings.newKeyHint"),
      confirmLabel: t("paySettings.newKey"),
      onConfirm: makeKey,
    })
  }

  function confirmTurnOff() {
    onConfirm({
      title: t("paySettings.turnOffTitle"),
      description: t("paySettings.turnOffHint"),
      confirmLabel: t("paySettings.turnOff"),
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(undefined)
          toast.success(t("paySettings.turnedOff"))
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("paySettings.turnOffFailed"))
          throw error
        }
      },
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t("paySettings.autoTitle")}
          {account.sepayConnected && <Badge variant="secondary">{t("paySettings.on")}</Badge>}
        </CardTitle>
        <CardDescription>{t("paySettings.autoHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!supported && (
          <Alert>
            <AlertTitle>{t("paySettings.unsupported", { bank: account.bankName })}</AlertTitle>
            <AlertDescription>{t("paySettings.unsupportedHint")}</AlertDescription>
          </Alert>
        )}
        {account.sepayConnected && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4 text-primary" />
            {account.sepayLastEventAt
              ? t("paySettings.lastHeard", { when: formatRelative(account.sepayLastEventAt) })
              : t("paySettings.waitingFirst")}{" "}
            {t("paySettings.keyEnds", { hint: account.sepayKeyHint })}
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-3">
        {account.sepayConnected ? (
          <>
            <Button variant="outline" onClick={confirmNewKey}>
              {t("paySettings.newKey")}
            </Button>
            <Button variant="ghost" onClick={confirmTurnOff}>
              {t("paySettings.turnOff")}
            </Button>
          </>
        ) : (
          <Button onClick={() => void makeKey()} disabled={!supported || create.isPending}>
            {create.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ZapIcon data-icon="inline-start" />
            )}
            {t("paySettings.setUp")}
          </Button>
        )}
      </CardFooter>
      <SepayKeyDialog result={result} onClose={() => setResult(null)} />
    </Card>
  )
}

export function PaymentSettingsPage() {
  const { t } = useTranslation()
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
          {t("common.yourGroups")}
        </Button>
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight sm:text-4xl">
            <BanknoteIcon className="size-8 text-primary" aria-hidden />
            {t("paySettings.heading")}
          </h1>
          <p className="max-w-prose text-muted-foreground">{t("paySettings.intro")}</p>
        </div>
      </section>

      {account.isPending ? (
        <div className="flex flex-col gap-4" aria-label={t("common.loading")}>
          <Skeleton className="h-80" />
          <Skeleton className="h-40" />
        </div>
      ) : account.isError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            {t("paySettings.loadFailed")}
            <Button variant="outline" size="sm" onClick={() => void account.refetch()}>
              {t("common.tryAgain")}
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
