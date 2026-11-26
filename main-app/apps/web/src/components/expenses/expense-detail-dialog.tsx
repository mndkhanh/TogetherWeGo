import type { ExpenseDetailResponse, SplitType } from "@twg/shared"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import type { ConfirmRequest } from "@/components/confirm-dialog"
import { PersonAvatar } from "@/components/member-avatars"
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { money, useDeleteExpense, useExpense } from "@/lib/expenses"
import { formErrorMessage } from "@/lib/form-errors"
import { translateMessage } from "@/i18n/messages"
import { formatDate, formatRelative } from "@/lib/format"

function splitDetail(type: SplitType, value: number, t: TFunction): string | null {
  if (type === "percent") return `${value / 100}%`
  if (type === "shares") return t("split.shareCount", { count: value })
  return null
}

function Body({ expense, myUserId }: { expense: ExpenseDetailResponse; myUserId: string }) {
  const { t } = useTranslation()
  const you = (userId: string, name: string) => (userId === myUserId ? t("common.you") : name)
  return (
    <div className="flex flex-col gap-5">
      <p className="text-3xl font-extrabold tracking-tight tabular-nums">
        {money(expense.amount, expense.currency)}
      </p>

      <section className="flex flex-col gap-2" aria-label={t("expenseDetail.whoOwes")}>
        <h3 className="text-sm font-medium">{t(`split.${expense.splitType}`)}</h3>
        <ul className="flex flex-col divide-y rounded-lg border">
          {expense.splits.map((split) => (
            <li key={split.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <PersonAvatar person={split} size="sm" />
              <span className="min-w-0 flex-1 truncate">{you(split.userId, split.name)}</span>
              {splitDetail(expense.splitType, split.value, t) && (
                <span className="text-muted-foreground">
                  {splitDetail(expense.splitType, split.value, t)}
                </span>
              )}
              <span className="w-28 text-right tabular-nums">
                {money(split.amount, expense.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {expense.event && (
        <p className="text-sm text-muted-foreground">
          {t("expenseDetail.for")}{" "}
          <Link
            to={`/groups/${expense.groupId}/events/${expense.event.id}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {expense.event.title}
          </Link>
        </p>
      )}

      {expense.note && (
        <section className="flex flex-col gap-1" aria-label={t("expenseDetail.note")}>
          <h3 className="text-sm font-medium">{t("expenseDetail.note")}</h3>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{expense.note}</p>
        </section>
      )}

      {expense.receiptUrl && (
        <section className="flex flex-col gap-2" aria-label={t("expenseDetail.receipt")}>
          <h3 className="text-sm font-medium">{t("expenseDetail.receipt")}</h3>
          <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="w-fit">
            <img
              src={expense.receiptUrl}
              alt={t("expenseDetail.receiptFor", { title: expense.title })}
              className="max-h-64 rounded-lg border object-contain"
            />
          </a>
        </section>
      )}

      <Separator />

      <section className="flex flex-col gap-2" aria-label={t("expenseDetail.history")}>
        <h3 className="text-sm font-medium">{t("expenseDetail.history")}</h3>
        <ol className="flex flex-col gap-3">
          {expense.history.map((entry, index) => (
            <li key={index} className="flex flex-col gap-1 text-sm">
              <span>
                <span className="font-medium">{you(entry.actor.userId, entry.actor.name)}</span>{" "}
                {t(`expenseDetail.action.${entry.action}`)}{" "}
                <time dateTime={entry.at} className="text-muted-foreground" title={entry.at}>
                  {formatRelative(entry.at)}
                </time>
              </span>
              {entry.changes.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-3 text-muted-foreground">
                  {entry.changes.map((change) => (
                    <li key={change}>{translateMessage(change)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

export function ExpenseDetailDialog({
  groupId,
  expenseId,
  myUserId,
  archived,
  onClose,
  onEdit,
  onConfirm,
}: {
  groupId: string
  expenseId: string | null
  myUserId: string
  archived: boolean
  onClose: () => void
  onEdit: (expense: ExpenseDetailResponse) => void
  onConfirm: (request: ConfirmRequest) => void
}) {
  const { t } = useTranslation()
  const expense = useExpense(expenseId)
  const remove = useDeleteExpense(groupId)
  const data = expense.data

  function confirmDelete(target: ExpenseDetailResponse) {
    onConfirm({
      title: t("expenseDetail.deleteTitle", { title: target.title }),
      description: t("expenseDetail.deleteHint"),
      confirmLabel: t("expenseDetail.deleteConfirm"),
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(target.id)
          toast.success(t("expenseDetail.deleted", { title: target.title }))
          onClose()
        } catch (error) {
          toast.error(formErrorMessage(error) ?? t("expenseDetail.deleteFailed"))
          throw error
        }
      },
    })
  }

  return (
    <Dialog open={expenseId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{data?.title ?? t("expenseDetail.expense")}</DialogTitle>
          <DialogDescription>
            {data
              ? t("expenseDetail.paidOn", {
                  payer: data.payer.userId === myUserId ? t("common.you") : data.payer.name,
                  date: formatDate(`${data.spentOn}T00:00:00`),
                })
              : " "}
          </DialogDescription>
        </DialogHeader>

        {expense.isPending && expenseId !== null && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-32" />
          </div>
        )}
        {expense.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {formErrorMessage(expense.error) ?? t("expenseDetail.loadFailed")}
            </AlertDescription>
          </Alert>
        )}
        {data && <Body expense={data} myUserId={myUserId} />}

        {data?.canEdit && !archived && (
          <DialogFooter>
            <Button variant="outline" onClick={() => confirmDelete(data)}>
              <Trash2Icon data-icon="inline-start" />
              {t("common.delete")}
            </Button>
            <Button onClick={() => onEdit(data)}>
              <PencilIcon data-icon="inline-start" />
              {t("common.edit")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
