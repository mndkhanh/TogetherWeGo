import type { ExpenseDetailResponse, SplitType } from "@twg/shared"
import { PencilIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

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
import { formatDate, formatRelative } from "@/lib/format"

const SPLIT_DESCRIPTION: Record<SplitType, string> = {
  equal: "Split equally",
  exact: "Split by amount",
  percent: "Split by percentage",
  shares: "Split by shares",
}

function splitDetail(type: SplitType, value: number): string | null {
  if (type === "percent") return `${value / 100}%`
  if (type === "shares") return value === 1 ? "1 share" : `${value} shares`
  return null
}

function Body({ expense, myUserId }: { expense: ExpenseDetailResponse; myUserId: string }) {
  const you = (userId: string, name: string) => (userId === myUserId ? "You" : name)
  return (
    <div className="flex flex-col gap-5">
      <p className="text-3xl font-extrabold tracking-tight tabular-nums">
        {money(expense.amount, expense.currency)}
      </p>

      <section className="flex flex-col gap-2" aria-label="Who owes what">
        <h3 className="text-sm font-medium">{SPLIT_DESCRIPTION[expense.splitType]}</h3>
        <ul className="flex flex-col divide-y rounded-lg border">
          {expense.splits.map((split) => (
            <li key={split.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
              <PersonAvatar person={split} size="sm" />
              <span className="min-w-0 flex-1 truncate">{you(split.userId, split.name)}</span>
              {splitDetail(expense.splitType, split.value) && (
                <span className="text-muted-foreground">
                  {splitDetail(expense.splitType, split.value)}
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
          For{" "}
          <Link
            to={`/groups/${expense.groupId}/events/${expense.event.id}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {expense.event.title}
          </Link>
        </p>
      )}

      {expense.note && (
        <section className="flex flex-col gap-1" aria-label="Note">
          <h3 className="text-sm font-medium">Note</h3>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">{expense.note}</p>
        </section>
      )}

      {expense.receiptUrl && (
        <section className="flex flex-col gap-2" aria-label="Receipt">
          <h3 className="text-sm font-medium">Receipt</h3>
          <a href={expense.receiptUrl} target="_blank" rel="noreferrer" className="w-fit">
            <img
              src={expense.receiptUrl}
              alt={`Receipt for ${expense.title}`}
              className="max-h-64 rounded-lg border object-contain"
            />
          </a>
        </section>
      )}

      <Separator />

      <section className="flex flex-col gap-2" aria-label="History">
        <h3 className="text-sm font-medium">History</h3>
        <ol className="flex flex-col gap-3">
          {expense.history.map((entry, index) => (
            <li key={index} className="flex flex-col gap-1 text-sm">
              <span>
                <span className="font-medium">{you(entry.actor.userId, entry.actor.name)}</span>{" "}
                {entry.action === "created" ? "added this" : `${entry.action} this`}{" "}
                <time dateTime={entry.at} className="text-muted-foreground" title={entry.at}>
                  {formatRelative(entry.at)}
                </time>
              </span>
              {entry.changes.length > 0 && (
                <ul className="flex flex-col gap-0.5 pl-3 text-muted-foreground">
                  {entry.changes.map((change) => (
                    <li key={change}>{change}</li>
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
  const expense = useExpense(expenseId)
  const remove = useDeleteExpense(groupId)
  const data = expense.data

  function confirmDelete(target: ExpenseDetailResponse) {
    onConfirm({
      title: `Delete ${target.title}?`,
      description:
        "Everyone's balance goes back to how it was before this expense. The history keeps a record that it was deleted.",
      confirmLabel: "Delete expense",
      destructive: true,
      onConfirm: async () => {
        try {
          await remove.mutateAsync(target.id)
          toast.success(`Deleted ${target.title}`)
          onClose()
        } catch (error) {
          toast.error(formErrorMessage(error) ?? "Couldn't delete the expense. Try again.")
          throw error
        }
      },
    })
  }

  return (
    <Dialog open={expenseId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{data?.title ?? "Expense"}</DialogTitle>
          <DialogDescription>
            {data
              ? `${data.payer.userId === myUserId ? "You" : data.payer.name} paid on ${formatDate(
                  `${data.spentOn}T00:00:00`
                )}`
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
              {formErrorMessage(expense.error) ?? "Couldn't load this expense."}
            </AlertDescription>
          </Alert>
        )}
        {data && <Body expense={data} myUserId={myUserId} />}

        {data?.canEdit && !archived && (
          <DialogFooter>
            <Button variant="outline" onClick={() => confirmDelete(data)}>
              <Trash2Icon data-icon="inline-start" />
              Delete
            </Button>
            <Button onClick={() => onEdit(data)}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
