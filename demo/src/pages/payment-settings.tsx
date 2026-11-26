import { Check, Copy } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"

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
  Select,
  useAction,
} from "@/components/ui"
import { useUser } from "@/lib/auth"
import { formatVnd } from "@/lib/money"
import {
  callErrorMessage,
  createSepayKey,
  disableSepay,
  removePaymentAccount,
  savePaymentAccount,
  sepayWebhookUrl,
  usePaymentAccount,
  useSepayTransfers,
  type PaymentAccount,
} from "@/lib/payments"
import { BANKS, bankByBin } from "@/shared/banks"

export function PaymentSettingsPage() {
  const user = useUser()
  const account = usePaymentAccount(user.uid)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Getting paid</h1>
        <p className="mt-1 text-sm text-muted">
          Money goes straight from their bank to yours. TogetherWeGo never holds it.
        </p>
      </div>
      {account.error ? (
        <ErrorText>{callErrorMessage(account.error)}</ErrorText>
      ) : account.data === undefined ? (
        <Loading />
      ) : (
        <div
          className={cx(
            "grid grid-cols-1 items-start gap-6",
            account.data?.sepay ? "lg:grid-cols-2" : "max-w-3xl",
          )}
        >
          <div className="flex flex-col gap-6">
            <BankAccountForm account={account.data} />
            {account.data && <SepaySection account={account.data} />}
          </div>
          {account.data?.sepay && <RecentTransfers />}
        </div>
      )}
    </div>
  )
}

function BankAccountForm({ account }: { account: PaymentAccount | null }) {
  const [bankBin, setBankBin] = React.useState(account?.bankBin ?? "")
  const [accountNumber, setAccountNumber] = React.useState(account?.accountNumber ?? "")
  const [holderName, setHolderName] = React.useState(account?.holderName ?? "")
  const [notice, setNotice] = React.useState<string | null>(null)
  const save = useAction()
  const remove = useAction()
  const { confirm, dialog } = useConfirm()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotice(null)
    let turnedOff = false
    const ok = await save.run(async () => {
      turnedOff = (await savePaymentAccount({ bankBin, accountNumber, holderName })).sepayTurnedOff
    }, callErrorMessage)
    if (ok) {
      setNotice(
        turnedOff
          ? "Bank account saved. SePay is off until you set it up again."
          : "Bank account saved.",
      )
    }
  }

  return (
    <Panel title="Bank account">
      <p className="-mt-2 mb-4 text-sm text-muted">
        Where people in your groups send money they owe you. Only the person paying you sees it.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Bank">
          <Select value={bankBin} onChange={(e) => setBankBin(e.target.value)}>
            <option value="" disabled>
              Choose your bank
            </option>
            {BANKS.map((b) => (
              <option key={b.bin} value={b.bin}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Account number">
            <Input
              inputMode="numeric"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\s/g, ""))}
              maxLength={25}
            />
          </Field>
          <Field label="Name on the account" hint="As your bank shows it, without accents.">
            <Input
              value={holderName}
              onChange={(e) => setHolderName(e.target.value.toUpperCase())}
              autoComplete="name"
              maxLength={60}
            />
          </Field>
        </div>
        <ErrorText>{save.error ?? remove.error}</ErrorText>
        {notice && <p className="text-sm font-medium text-owed">{notice}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.busy}>
            Save bank account
          </Button>
          {account && (
            <Button
              variant="danger"
              disabled={remove.busy}
              onClick={async () => {
                const ok = await confirm({
                  title: "Remove your bank account?",
                  body: (
                    <>
                      Friends can't pay you by QR code until you add one again
                      {account.sepay ? ", and SePay is turned off" : ""}. Payments already in
                      progress keep the details they started with.
                    </>
                  ),
                  action: "Remove account",
                })
                if (!ok) return
                void remove.run(async () => {
                  await removePaymentAccount()
                  setBankBin("")
                  setAccountNumber("")
                  setHolderName("")
                  setNotice(null)
                }, callErrorMessage)
              }}
            >
              Remove
            </Button>
          )}
          {dialog}
        </div>
      </form>
    </Panel>
  )
}

function SepaySection({ account }: { account: PaymentAccount }) {
  const bank = bankByBin(account.bankBin)
  const [newKey, setNewKey] = React.useState<string | null>(null)
  const action = useAction()
  const { confirm, dialog } = useConfirm()

  if (!bank?.sepay) {
    return (
      <Panel title="Confirm payments automatically">
        <p className="text-sm text-muted">
          SePay can't watch {bank?.name ?? "this bank's"} accounts yet. People can still pay you by
          QR code; you confirm the payments yourself.
        </p>
      </Panel>
    )
  }

  const makeKey = async () => {
    if (account.sepay) {
      const ok = await confirm({
        title: "Make a new key?",
        body: "Your current key stops working straight away. Until you paste the new one into SePay, payments won't be marked paid automatically.",
        action: "Make new key",
      })
      if (!ok) return
    }
    void action.run(async () => setNewKey(await createSepayKey()), callErrorMessage)
  }

  return (
    <Panel
      title="Confirm payments automatically"
      action={
        account.sepay && (
          <span className="rounded-full bg-owed/10 px-2.5 py-0.5 text-xs font-semibold text-owed">
            On
          </span>
        )
      }
    >
      {dialog}
      <p className="-mt-2 mb-4 text-sm text-muted">
        With a free SePay account watching your {bank.name} account, payments to you are marked as
        paid the moment the money arrives. Without it, you confirm each payment yourself.{" "}
        <Link to="/help/sepay" className="font-semibold text-brand">
          How to connect SePay
        </Link>
      </p>

      {newKey ? (
        <div className="flex flex-col gap-4 rounded-xl bg-marigold-soft/60 p-4">
          <p className="text-sm font-semibold">
            Finish in SePay: go to Webhooks and add one for your {bank.name} account with these
            settings.
          </p>
          <CopyField label="Webhook URL" value={sepayWebhookUrl()} />
          <CopyField
            label="API key"
            value={newKey}
            hint="Choose “API Key” as the authentication type. This is the only time you'll see the key: if you lose it, make a new one."
          />
          <p className="text-sm">
            <span className="font-medium">Event:</span> money in (“Có tiền vào”). Turn on “Chỉ gửi
            khi có mã thanh toán” and filter by <span className="font-mono">TWG</span> instead of{" "}
            <span className="font-mono">DH</span>, so SePay only sends TogetherWeGo transfers.{" "}
            <Link to="/help/sepay" target="_blank" className="font-semibold text-brand">
              Full steps
            </Link>
          </p>
          <Button className="self-start" onClick={() => setNewKey(null)}>
            Done
          </Button>
        </div>
      ) : account.sepay ? (
        <div className="flex flex-col gap-3 text-sm">
          <p className="text-muted">
            {account.sepay.lastEventAt
              ? `Last heard from SePay ${account.sepay.lastEventAt.toLocaleString()}.`
              : "Waiting for the first transfer from SePay."}{" "}
            Key ends in <span className="font-mono">{account.sepay.keyHint}</span>.
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={action.busy}
              onClick={() => void makeKey()}
              title="The old key stops working straight away"
            >
              Make a new key
            </Button>
            <Button
              variant="danger"
              disabled={action.busy}
              onClick={async () => {
                const ok = await confirm({
                  title: "Turn off SePay?",
                  body: "Transfers to you stop being marked paid automatically; you'll confirm them yourself. Your key stops working, so turning it back on means a new key.",
                  action: "Turn off",
                })
                if (ok) void action.run(disableSepay, callErrorMessage)
              }}
            >
              Turn off
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={action.busy} onClick={() => void makeKey()}>
          Set up SePay
        </Button>
      )}
      <div className="mt-3">
        <ErrorText>{action.error}</ErrorText>
      </div>
    </Panel>
  )
}

function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className="font-mono text-xs"
          onFocus={(e) => e.target.select()}
        />
        <Button
          variant="secondary"
          aria-label={`Copy ${label}`}
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  )
}

function RecentTransfers() {
  const user = useUser()
  const transfers = useSepayTransfers(user.uid)
  return (
    <Panel title="Recent transfers from SePay">
      {transfers.error ? (
        <ErrorText>{callErrorMessage(transfers.error)}</ErrorText>
      ) : !transfers.data ? (
        <Loading />
      ) : transfers.data.length === 0 ? (
        <Empty>Nothing yet. Transfers into your account show up here.</Empty>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {transfers.data.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{t.content}</p>
                <p className="text-xs text-muted">{t.receivedAt?.toLocaleString()}</p>
              </div>
              <span className="font-bold tabular-nums">{formatVnd(t.amount)}</span>
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  t.status === "matched" ? "bg-owed/10 text-owed" : "bg-marigold-soft text-ink",
                )}
                title={
                  t.status === "matched"
                    ? "Confirmed a payment"
                    : "No payment code we recognise: record it by hand if it was for a group"
                }
              >
                {t.status === "matched" ? "Matched" : "No code"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
