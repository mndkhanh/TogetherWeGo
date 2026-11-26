import { ArrowRight, Check, Landmark, Trash2 } from "lucide-react"
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
  addPayment,
  dataErrorMessage,
  deletePayment,
  useExpenses,
  usePayments,
  type Member,
  type Payment,
} from "@/lib/data"
import { formatVnd, netBalances, parseVnd, simplifyDebts, type Transfer } from "@/lib/money"
import {
  callErrorMessage,
  cancelSettlement,
  confirmSettlement,
  startSettlement,
  useSettlementBank,
  useSettlements,
  type Settlement,
} from "@/lib/payments"
import { bankByBin, sepayQrUrl } from "@/shared/banks"

export function BalancesTab({ groupId, members }: { groupId: string; members: Member[] }) {
  const user = useUser()
  const expenses = useExpenses(groupId)
  const payments = usePayments(groupId)
  const settlements = useSettlements(groupId)
  const [recording, setRecording] = React.useState<Transfer | null>(null)
  const [showing, setShowing] = React.useState<string | null>(null)
  const start = useAction()
  const names = new Map(members.map((m) => [m.uid, m.name]))
  const photos = new Map(members.map((m) => [m.uid, m.photo]))
  const nameOf = (uid: string) => (uid === user.uid ? "You" : (names.get(uid) ?? "A former member"))

  const error = expenses.error ?? payments.error ?? settlements.error
  if (error) return <ErrorText>{dataErrorMessage(error)}</ErrorText>
  if (!expenses.data || !payments.data || !settlements.data) return <Loading />

  // Confirmed bank transfers count exactly like recorded payments, for what was actually paid.
  const confirmed = settlements.data.filter((s) => s.status === "confirmed")
  const net = netBalances(expenses.data, [
    ...payments.data,
    ...confirmed.map((s) => ({ from: s.from, to: s.to, amount: s.paidAmount ?? s.amount })),
  ])
  const transfers = simplifyDebts(net)
  const mine = net.get(user.uid) ?? 0
  const pending = settlements.data.filter((s) => s.status === "pending")
  const open = settlements.data.find((s) => s.id === showing) ?? null

  const payByBank = async (t: Transfer) => {
    let id = ""
    const ok = await start.run(async () => {
      id = await startSettlement(groupId, t.to, t.amount)
    }, callErrorMessage)
    if (ok) setShowing(id)
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        <div
          className={cx(
            "rounded-2xl p-5",
            mine > 0 ? "bg-owed/10" : mine < 0 ? "bg-owe/10" : "bg-surface ring-1 ring-line",
          )}
        >
          <p className="text-sm font-medium text-muted">
            {mine > 0 ? "The group owes you" : mine < 0 ? "You owe the group" : "You're all square"}
          </p>
          {mine !== 0 && (
            <p
              className={cx(
                "mt-1 text-4xl font-extrabold tracking-tight tabular-nums",
                mine > 0 ? "text-owed" : "text-owe",
              )}
            >
              {formatVnd(Math.abs(mine))}
            </p>
          )}
        </div>

        {open && (
          <BankTransferCard
            groupId={groupId}
            settlement={open}
            nameOf={nameOf}
            onClose={() => setShowing(null)}
          />
        )}

        <Panel title="Settle up">
          <ErrorText>{start.error}</ErrorText>
          {transfers.length === 0 ? (
            <Empty>Nobody owes anybody. Nice.</Empty>
          ) : (
            <ul className="-my-2 divide-y divide-line">
              {transfers.map((t) => {
                const iPay = t.from === user.uid
                const iGet = t.to === user.uid
                const inProgress = pending.find((s) => s.from === t.from && s.to === t.to)
                return (
                  <li key={`${t.from}-${t.to}`} className="flex flex-wrap items-center gap-3 py-3">
                    <Avatar name={names.get(t.from) ?? "?"} uid={t.from} photo={photos.get(t.from)} size="sm" />
                    <span className="text-sm font-semibold">{nameOf(t.from)}</span>
                    <ArrowRight className="size-4 text-muted" aria-label="pays" />
                    <Avatar name={names.get(t.to) ?? "?"} uid={t.to} photo={photos.get(t.to)} size="sm" />
                    <span className="text-sm font-semibold">{nameOf(t.to)}</span>
                    <span className="ml-auto font-bold tabular-nums">{formatVnd(t.amount)}</span>
                    {iPay && !inProgress && (
                      <Button size="sm" disabled={start.busy} onClick={() => void payByBank(t)}>
                        <Landmark className="size-3.5" aria-hidden />
                        Pay by bank transfer
                      </Button>
                    )}
                    {iPay && inProgress && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowing(inProgress.id)}
                      >
                        Show payment details
                      </Button>
                    )}
                    {iGet && (
                      <Button size="sm" variant="secondary" onClick={() => setRecording(t)}>
                        Got paid in cash
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {transfers.some((t) => t.from === user.uid) && (
            <p className="mt-3 text-xs text-muted">
              Paid in cash? Ask them to record it: only the person who gets the money can.
            </p>
          )}
          {recording && (
            <RecordPayment
              key={`${recording.from}-${recording.to}`}
              groupId={groupId}
              transfer={recording}
              fromName={nameOf(recording.from)}
              toName={recording.to === user.uid ? "you" : nameOf(recording.to)}
              onDone={() => setRecording(null)}
            />
          )}
        </Panel>
      </div>

      <div className="flex flex-col gap-6">
        {pending.length > 0 && (
          <Panel title="Bank transfers in progress">
            <ul className="-my-2 divide-y divide-line">
              {pending.map((s) => (
                <PendingRow
                  key={s.id}
                  groupId={groupId}
                  settlement={s}
                  nameOf={nameOf}
                  onShow={() => setShowing(s.id)}
                />
              ))}
            </ul>
          </Panel>
        )}

        <History groupId={groupId} nameOf={nameOf} payments={payments.data} confirmed={confirmed} />
      </div>
    </div>
  )
}

/** The QR code and bank details for one transfer. Only payer and payee can read the details. */
function BankTransferCard({
  groupId,
  settlement,
  nameOf,
  onClose,
}: {
  groupId: string
  settlement: Settlement
  nameOf: (uid: string) => string
  onClose: () => void
}) {
  const user = useUser()
  const bank = useSettlementBank(groupId, settlement.id)
  const details = bank.data
  const qr = details
    ? sepayQrUrl({
        bin: details.bankBin,
        accountNumber: details.accountNumber,
        amount: settlement.amount,
        description: settlement.code,
      })
    : null
  const payee = nameOf(settlement.to)

  return (
    <section className="rounded-2xl bg-surface p-5 ring-2 ring-brand/30" aria-label="Bank transfer">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">
            {settlement.status === "confirmed"
              ? "Paid"
              : settlement.from === user.uid
                ? `Pay ${payee} ${formatVnd(settlement.amount)}`
                : `${nameOf(settlement.from)} is paying you ${formatVnd(settlement.amount)}`}
          </h2>
          <p className="text-sm text-muted">
            {settlement.status === "confirmed"
              ? settlement.via === "sepay"
                ? "SePay saw the money arrive and confirmed it."
                : `${payee} confirmed the money arrived.`
              : settlement.status === "cancelled"
                ? "This payment was called off."
                : "Scan the code in your banking app. Keep the payment code in the transfer note: that's how it's matched."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {settlement.status === "confirmed" ? (
        <p className="flex items-center gap-2 text-sm font-semibold text-owed">
          <Check className="size-4" aria-hidden />
          {formatVnd(settlement.paidAmount ?? settlement.amount)} received
        </p>
      ) : settlement.status === "cancelled" ? null : bank.error ? (
        <ErrorText>{dataErrorMessage(bank.error)}</ErrorText>
      ) : !details ? (
        <Loading />
      ) : (
        <div className="grid gap-5 sm:grid-cols-[13rem_1fr]">
          {qr && (
            <img
              src={qr}
              alt={`VietQR code for ${formatVnd(settlement.amount)} to ${details.holderName}`}
              className="aspect-square w-52 rounded-xl bg-white p-2 ring-1 ring-line"
            />
          )}
          <dl className="grid content-start gap-3 text-sm">
            <Detail label="Bank" value={bankByBin(details.bankBin)?.name ?? details.bankBin} />
            <Detail label="Account number" value={details.accountNumber} mono />
            <Detail label="Name" value={details.holderName} />
            <Detail label="Amount" value={formatVnd(settlement.amount)} />
            <Detail label="Transfer note" value={settlement.code} mono strong />
          </dl>
        </div>
      )}
    </section>
  )
}

function Detail({
  label,
  value,
  mono,
  strong,
}: {
  label: string
  value: string
  mono?: boolean
  strong?: boolean
}) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd
        className={cx(
          mono && "font-mono",
          strong ? "text-base font-bold text-brand" : "font-semibold",
        )}
      >
        {value}
      </dd>
    </div>
  )
}

function PendingRow({
  groupId,
  settlement: s,
  nameOf,
  onShow,
}: {
  groupId: string
  settlement: Settlement
  nameOf: (uid: string) => string
  onShow: () => void
}) {
  const user = useUser()
  const act = useAction()
  const { confirm, dialog } = useConfirm()
  const involved = s.from === user.uid || s.to === user.uid
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 text-sm">
      {dialog}
      <div className="min-w-0 flex-1">
        <p>
          <span className="font-semibold">{nameOf(s.from)}</span> →{" "}
          <span className="font-semibold">{nameOf(s.to)}</span>{" "}
          <span className="font-mono text-xs text-muted">{s.code}</span>
        </p>
        <p className="text-xs text-muted">Waiting for the money to arrive</p>
      </div>
      <span className="font-bold tabular-nums">{formatVnd(s.amount)}</span>
      {involved && (
        <Button size="sm" variant="secondary" onClick={onShow}>
          Details
        </Button>
      )}
      {s.to === user.uid && (
        <Button
          size="sm"
          disabled={act.busy}
          onClick={() => void act.run(() => confirmSettlement(groupId, s), dataErrorMessage)}
        >
          Mark as received
        </Button>
      )}
      {involved && (
        <Button
          size="sm"
          variant="ghost"
          disabled={act.busy}
          onClick={async () => {
            const ok = await confirm({
              title: "Cancel this payment?",
              body:
                s.from === user.uid
                  ? "Only if you haven't sent the money. If you already have, keep it: it's marked paid when the transfer arrives."
                  : `Only if ${nameOf(s.from)} isn't paying this way. If the money arrives anyway, it still counts.`,
              action: "Cancel payment",
              cancel: "Keep waiting",
            })
            if (ok) void act.run(() => cancelSettlement(groupId, s.id), dataErrorMessage)
          }}
        >
          Cancel
        </Button>
      )}
      {act.error && (
        <div className="w-full">
          <ErrorText>{act.error}</ErrorText>
        </div>
      )}
    </li>
  )
}

/** Cash payments people recorded and bank transfers that arrived, newest first. */
function History({
  groupId,
  nameOf,
  payments,
  confirmed,
}: {
  groupId: string
  nameOf: (uid: string) => string
  payments: Payment[]
  confirmed: Settlement[]
}) {
  const user = useUser()
  const remove = useAction()
  const { confirm, dialog } = useConfirm()
  const object = (uid: string) => (uid === user.uid ? "you" : nameOf(uid))
  const rows = [
    ...payments.map((p) => ({
      key: `p-${p.id}`,
      at: p.createdAt,
      from: p.from,
      to: p.to,
      amount: p.amount,
      note: p.note || "Recorded by hand",
      deletable: p.createdBy === user.uid ? p.id : null,
    })),
    ...confirmed.map((s) => ({
      key: `s-${s.id}`,
      at: s.confirmedAt,
      from: s.from,
      to: s.to,
      amount: s.paidAmount ?? s.amount,
      note:
        s.via === "sepay"
          ? `Bank transfer ${s.code}, confirmed by SePay`
          : `Bank transfer ${s.code}`,
      deletable: null,
    })),
  ].sort((a, b) => (b.at?.getTime() ?? Date.now()) - (a.at?.getTime() ?? Date.now()))

  return (
    <Panel title="Payments">
      {dialog}
      <ErrorText>{remove.error}</ErrorText>
      {rows.length === 0 ? (
        <Empty>No payments yet.</Empty>
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-semibold">{nameOf(r.from)}</span> paid{" "}
                  <span className="font-semibold">{object(r.to)}</span>
                </p>
                <p className="truncate text-xs text-muted">{r.note}</p>
              </div>
              <span className="font-bold tabular-nums">{formatVnd(r.amount)}</span>
              {r.deletable && (
                <Button
                  variant="danger"
                  size="sm"
                  aria-label="Delete payment"
                  disabled={remove.busy}
                  onClick={async () => {
                    const id = r.deletable
                    if (!id) return
                    const ok = await confirm({
                      title: "Delete this payment?",
                      body: `${nameOf(r.from)} paying you ${formatVnd(r.amount)} comes off the balances, so they owe it again. Only delete it if the money didn't really arrive.`,
                      action: "Delete payment",
                    })
                    if (ok) void remove.run(() => deletePayment(groupId, id), dataErrorMessage)
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecordPayment({
  groupId,
  transfer,
  fromName,
  toName,
  onDone,
}: {
  groupId: string
  transfer: Transfer
  fromName: string
  toName: string
  onDone: () => void
}) {
  const user = useUser()
  const [amountText, setAmountText] = React.useState(String(transfer.amount))
  const [note, setNote] = React.useState("")
  const { busy, error, run, setError } = useAction()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseVnd(amountText)
    if (!amount) return setError("Enter an amount in dong, like 250000, 250k or 1m.")
    const ok = await run(
      () => addPayment(groupId, { from: transfer.from, to: transfer.to, amount, note }, user.uid),
      dataErrorMessage,
    )
    if (ok) onDone()
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 flex flex-col gap-3 rounded-xl bg-canvas p-4"
      aria-label="Record a payment"
      noValidate
    >
      <p className="text-sm font-semibold">
        {fromName} paid {toName}
      </p>
      <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
        <AmountField value={amountText} onChange={setAmountText} />
        <Field label="Note (optional)">
          <Input
            placeholder="Cash, MoMo…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
          />
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Record payment
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
