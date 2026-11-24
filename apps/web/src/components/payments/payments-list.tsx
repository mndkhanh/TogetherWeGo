import type { SettlementResponse } from "@twg/shared"
import { ArrowRightIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { money } from "@/lib/expenses"
import { formatRelative } from "@/lib/format"
import { useSettlements } from "@/lib/payments"
import { cn } from "@/lib/utils"

function statusOf(s: SettlementResponse): { label: string; urgent: boolean } {
  if (s.status === "confirmed") {
    return { label: s.confirmedVia === "sepay" ? "Paid · bank" : "Paid", urgent: false }
  }
  if (s.canConfirm) return { label: "Did it arrive?", urgent: true }
  return { label: "Waiting", urgent: false }
}

/** The group's payments: anything waiting first, then the most recent. */
export function PaymentsList({
  groupId,
  myUserId,
  onOpen,
}: {
  groupId: string
  myUserId: string
  onOpen: (id: string) => void
}) {
  const payments = useSettlements(groupId)
  if (payments.isPending) return <Skeleton className="h-32" />
  if (!payments.data || payments.data.length === 0) return null

  const items = [...payments.data].sort(
    (a, b) =>
      Number(b.status === "pending") - Number(a.status === "pending") ||
      b.createdAt.localeCompare(a.createdAt)
  )
  const nameOf = (person: { userId: string; name: string }) =>
    person.userId === myUserId ? "You" : person.name

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="-mx-3 flex flex-col">
          {items.slice(0, 20).map((s) => {
            const status = statusOf(s)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm outline-offset-2 transition-colors hover:bg-muted"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{nameOf(s.from)}</span>
                      <ArrowRightIcon
                        className="size-3.5 shrink-0 text-muted-foreground"
                        aria-label="paid"
                      />
                      <span className="truncate">{nameOf(s.to)}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatRelative(s.confirmedAt ?? s.createdAt)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span
                      className={cn(
                        "font-medium tabular-nums",
                        s.status === "pending" && "text-muted-foreground"
                      )}
                    >
                      {money(s.paidAmount ?? s.amount, s.currency)}
                    </span>
                    <Badge
                      variant={
                        status.urgent ? "default" : s.status === "pending" ? "outline" : "secondary"
                      }
                    >
                      {status.label}
                    </Badge>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
