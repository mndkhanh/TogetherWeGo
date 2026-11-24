import type { UnmatchedTransferResponse } from "@twg/shared"
import * as React from "react"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { money } from "@/lib/expenses"
import { formatRelative } from "@/lib/format"
import { formErrorMessage } from "@/lib/form-errors"
import { useGroup, useGroups } from "@/lib/groups"
import {
  useAssignTransfer,
  useIgnoreTransfer,
  useSettlements,
  useUnmatchedTransfers,
} from "@/lib/payments"

function AssignDialog({
  transfer,
  myUserId,
  onClose,
}: {
  transfer: UnmatchedTransferResponse | null
  myUserId: string
  onClose: () => void
}) {
  const groups = useGroups()
  const [groupId, setGroupId] = React.useState<string | null>(null)
  const [fromUserId, setFromUserId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const group = useGroup(groupId ?? "", groupId !== null)
  const settlements = useSettlements(groupId ?? "", groupId !== null)
  const assign = useAssignTransfer()

  React.useEffect(() => {
    if (transfer) {
      setGroupId(null)
      setFromUserId(null)
      setError(null)
    }
  }, [transfer])

  // Bank transfers are in đồng, so only VND groups can be settled with them.
  const groupItems = (groups.data ?? [])
    .filter((g) => g.currency === "VND")
    .map((g) => ({ value: g.id, label: g.name }))
  const people = (groupId && group.data?.members ? group.data.members : [])
    .filter((m) => m.userId !== myUserId)
    .map((m) => ({ value: m.userId, label: m.name }))

  async function submit() {
    if (!transfer) return
    if (!groupId || !fromUserId) {
      setError("Choose the group and who sent it")
      return
    }
    // If they already started a payment to you, this transfer is that payment.
    const waiting = settlements.data?.find(
      (s) => s.status === "pending" && s.from.userId === fromUserId && s.to.userId === myUserId
    )
    try {
      await assign.mutateAsync(
        waiting
          ? { id: transfer.id, settlementId: waiting.id }
          : { id: transfer.id, groupId, fromUserId }
      )
      toast.success(`Recorded ${money(transfer.amount, "VND")} as paid`)
      onClose()
    } catch (err) {
      setError(formErrorMessage(err) ?? "Couldn't record it. Try again.")
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Who sent {transfer ? money(transfer.amount, "VND") : "this"}?</DialogTitle>
          <DialogDescription>
            It’s recorded as their payment to you, and their balance in the group goes down.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="assign-group">Group</FieldLabel>
            <Select
              items={groupItems}
              value={groupId}
              onValueChange={(value) => {
                setGroupId(value as string | null)
                setFromUserId(null)
                setError(null)
              }}
            >
              <SelectTrigger id="assign-group" className="w-full">
                <SelectValue placeholder="Choose a group" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {groupItems.map((g) => (
                    <SelectItem key={g.value} value={g.value}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {groups.isSuccess && groupItems.length === 0 && (
              <FieldError>None of your groups use VND.</FieldError>
            )}
          </Field>
          <Field data-disabled={!groupId || undefined}>
            <FieldLabel htmlFor="assign-person">Sent by</FieldLabel>
            <Select
              items={people}
              value={fromUserId}
              disabled={!groupId}
              onValueChange={(value) => {
                setFromUserId(value as string | null)
                setError(null)
              }}
            >
              <SelectTrigger id="assign-person" className="w-full">
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {people.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              If they started a payment to you, this transfer completes it.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={assign.isPending}>
            {assign.isPending && <Spinner data-icon="inline-start" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Money SePay saw arrive that didn't carry a payment code we know. */
export function UnmatchedTransfersCard({ myUserId }: { myUserId: string }) {
  const transfers = useUnmatchedTransfers()
  const ignore = useIgnoreTransfer()
  const [assigning, setAssigning] = React.useState<UnmatchedTransferResponse | null>(null)

  if (!transfers.data || transfers.data.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfers to sort out</CardTitle>
        <CardDescription>
          Money arrived without a payment code we recognise. Say who sent it, or ignore it if it
          wasn’t for a group.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {transfers.data.map((t) => (
            <li key={t.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold tabular-nums">{money(t.amount, "VND")}</span>
                <time className="text-sm text-muted-foreground" dateTime={t.receivedAt}>
                  {formatRelative(t.receivedAt)}
                </time>
              </div>
              <p className="text-sm break-words text-muted-foreground">
                {t.content || "No message"}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setAssigning(t)}>
                  Say who sent it
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={ignore.isPending}
                  onClick={() =>
                    ignore.mutate(t.id, {
                      onSuccess: () => toast.success("Transfer ignored"),
                      onError: (err) => toast.error(formErrorMessage(err) ?? "Couldn't ignore it"),
                    })
                  }
                >
                  Ignore
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
      <AssignDialog transfer={assigning} myUserId={myUserId} onClose={() => setAssigning(null)} />
    </Card>
  )
}
