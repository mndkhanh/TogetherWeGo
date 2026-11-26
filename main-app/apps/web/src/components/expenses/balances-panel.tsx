import type { BalancesResponse } from "@twg/shared"
import { ArrowRightIcon } from "lucide-react"
import type * as React from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import { PersonAvatar } from "@/components/member-avatars"
import type { PaymentDraft } from "@/components/payments/payment-dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { money, useBalances } from "@/lib/expenses"
import { cn } from "@/lib/utils"

function headline(
  balances: BalancesResponse,
  myUserId: string,
  t: TFunction
): { title: string; tone: string } {
  const mine = balances.members.find((m) => m.userId === myUserId)?.net ?? 0
  if (mine > 0) {
    return {
      title: t("balances.owed", { amount: money(mine, balances.currency) }),
      tone: "text-primary",
    }
  }
  if (mine < 0) {
    return {
      title: t("balances.owe", { amount: money(-mine, balances.currency) }),
      tone: "text-destructive",
    }
  }
  return { title: t("balances.settled"), tone: "" }
}

export function BalancesPanel({
  groupId,
  myUserId,
  onPay,
  payments,
}: {
  groupId: string
  myUserId: string
  /** Start paying (or recording a payment for) one of the suggested transfers. */
  onPay: (draft: PaymentDraft) => void
  /** The group's payments, shown under the suggestions. */
  payments: React.ReactNode
}) {
  const { t } = useTranslation()
  const balances = useBalances(groupId)

  if (balances.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label={t("balances.loading")}>
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (balances.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          {t("balances.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void balances.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const data = balances.data
  const names = new Map(data.members.map((m) => [m.userId, m]))
  const nameOf = (userId: string) =>
    userId === myUserId ? t("common.you") : (names.get(userId)?.name ?? t("balances.someone"))
  const { title, tone } = headline(data, myUserId, t)
  const mine = data.transfers.filter((x) => x.fromUserId === myUserId || x.toUserId === myUserId)
  const others = data.transfers.filter((x) => !mine.includes(x))

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className={cn("text-2xl font-extrabold tracking-tight tabular-nums", tone)}>
            {title}
          </CardTitle>
          <CardDescription>
            {data.totalSpent > 0
              ? t("balances.spent", { amount: money(data.totalSpent, data.currency) })
              : t("balances.nothingSpent")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">{t("balances.suggested")}</h3>
          {data.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("balances.nobodyOwes")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {[...mine, ...others].map((transfer) => {
                const involvesMe = mine.includes(transfer)
                const from = names.get(transfer.fromUserId)
                const to = names.get(transfer.toUserId)
                const draft = from && to ? { from, to, amount: transfer.amount } : null
                return (
                  <li
                    key={`${transfer.fromUserId}-${transfer.toUserId}`}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 text-sm",
                      !involvesMe && "text-muted-foreground"
                    )}
                  >
                    <span className={cn("truncate", involvesMe && "font-medium")}>
                      {nameOf(transfer.fromUserId)}
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0" aria-label={t("balances.pays")} />
                    <span className={cn("min-w-0 flex-1 truncate", involvesMe && "font-medium")}>
                      {nameOf(transfer.toUserId)}
                    </span>
                    <span
                      className={cn("tabular-nums", involvesMe && "font-semibold text-foreground")}
                    >
                      {money(transfer.amount, data.currency)}
                    </span>
                    {involvesMe && draft && (
                      <Button
                        size="sm"
                        variant={transfer.fromUserId === myUserId ? "default" : "outline"}
                        onClick={() => onPay(draft)}
                      >
                        {transfer.fromUserId === myUserId
                          ? t("balances.pay")
                          : t("balances.record")}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">{t("balances.explainer")}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("balances.everyone")}</CardTitle>
            <CardDescription>{t("balances.everyoneHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {data.members.map((member) => (
                <li key={member.userId} className="flex items-center gap-3 text-sm">
                  <PersonAvatar person={member} size="sm" />
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">
                      {member.userId === myUserId
                        ? t("balances.nameYou", { name: member.name })
                        : member.name}
                    </span>
                    {!member.active && <Badge variant="outline">{t("balances.leftBadge")}</Badge>}
                  </span>
                  <span
                    className={cn(
                      "tabular-nums",
                      member.net > 0 && "text-primary",
                      member.net < 0 && "text-destructive",
                      member.net === 0 && "text-muted-foreground"
                    )}
                  >
                    {member.net > 0 ? "+" : member.net < 0 ? "−" : ""}
                    {money(Math.abs(member.net), data.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        {payments}
      </div>
    </div>
  )
}
