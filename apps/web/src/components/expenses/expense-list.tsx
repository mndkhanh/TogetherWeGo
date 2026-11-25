import type { ExpenseResponse } from "@twg/shared"
import { PaperclipIcon, ReceiptTextIcon } from "lucide-react"
import * as React from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { currentLocale } from "@/i18n"
import { money, useExpenses } from "@/lib/expenses"
import { cn } from "@/lib/utils"

function dayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${isoDate}T00:00:00`))
}

/** What this expense means for the current user, in one short phrase. */
function myPart(
  expense: ExpenseResponse,
  myUserId: string,
  t: TFunction
): { text: string; tone: string } {
  const involved =
    expense.payer.userId === myUserId || expense.splits.some((s) => s.userId === myUserId)
  if (!involved) return { text: t("expenses.notInvolved"), tone: "text-muted-foreground" }
  if (expense.myNet > 0) {
    return {
      text: t("expenses.youLent", { amount: money(expense.myNet, expense.currency) }),
      tone: "text-primary",
    }
  }
  if (expense.myNet < 0) {
    return {
      text: t("expenses.youOwe", { amount: money(-expense.myNet, expense.currency) }),
      tone: "text-destructive",
    }
  }
  return { text: t("expenses.sharePaid"), tone: "text-muted-foreground" }
}

function ExpenseRow({
  expense,
  myUserId,
  onOpen,
}: {
  expense: ExpenseResponse
  myUserId: string
  onOpen: (id: string) => void
}) {
  const { t } = useTranslation()
  const part = myPart(expense, myUserId, t)
  const payer = expense.payer.userId === myUserId ? t("common.you") : expense.payer.name
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(expense.id)}
        className="flex w-full items-center gap-4 rounded-lg px-3 py-3 text-left outline-offset-2 transition-colors hover:bg-muted"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            <span className="truncate">{expense.title}</span>
            {expense.hasReceipt && (
              <PaperclipIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label={t("expenses.hasReceipt")}
              />
            )}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {t("expenses.paid", { payer, amount: money(expense.amount, expense.currency) })}
            {expense.event && ` · ${expense.event.title}`}
          </span>
        </div>
        <span className={cn("shrink-0 text-right text-sm font-medium tabular-nums", part.tone)}>
          {part.text}
        </span>
      </button>
    </li>
  )
}

export function ExpenseList({
  groupId,
  myUserId,
  onOpen,
  addButton,
}: {
  groupId: string
  myUserId: string
  onOpen: (id: string) => void
  /** Shown in the empty state; omitted when the group is archived. */
  addButton?: React.ReactNode
}) {
  const { t } = useTranslation()
  const expenses = useExpenses(groupId)

  if (expenses.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label={t("expenses.loading")}>
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    )
  }

  if (expenses.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          {t("expenses.loadFailed")}
          <Button variant="outline" size="sm" onClick={() => void expenses.refetch()}>
            {t("common.tryAgain")}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const items = expenses.data.pages.flatMap((page) => page.items)
  if (items.length === 0) {
    return (
      <Empty className="border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptTextIcon />
          </EmptyMedia>
          <EmptyTitle>{t("expenses.none")}</EmptyTitle>
          <EmptyDescription>{t("expenses.noneHint")}</EmptyDescription>
        </EmptyHeader>
        {addButton && <EmptyContent>{addButton}</EmptyContent>}
      </Empty>
    )
  }

  const days: { day: string; items: ExpenseResponse[] }[] = []
  for (const expense of items) {
    const last = days.at(-1)
    if (last?.day === expense.spentOn) last.items.push(expense)
    else days.push({ day: expense.spentOn, items: [expense] })
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map(({ day, items: dayItems }) => (
        <section key={day} aria-label={dayLabel(day)} className="flex flex-col gap-1">
          <h3 className="px-3 text-sm font-medium text-muted-foreground">{dayLabel(day)}</h3>
          <ul className="flex flex-col rounded-xl border bg-card">
            {dayItems.map((expense) => (
              <ExpenseRow key={expense.id} expense={expense} myUserId={myUserId} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ))}
      {expenses.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={expenses.isFetchingNextPage}
          onClick={() => void expenses.fetchNextPage()}
        >
          {expenses.isFetchingNextPage && <Spinner data-icon="inline-start" />}
          {t("expenses.showOlder")}
        </Button>
      )}
    </div>
  )
}
