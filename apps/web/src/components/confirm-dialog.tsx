import * as React from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Spinner } from "@/components/ui/spinner"

export interface ConfirmRequest {
  title: string
  description: React.ReactNode
  /** Names the action exactly, e.g. "Remove Linh". */
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<unknown>
}

/** One confirmation dialog per page, opened with a ConfirmRequest. Stays open on failure. */
export function ConfirmDialog({
  request,
  onClose,
}: {
  request: ConfirmRequest | null
  onClose: () => void
}) {
  const [pending, setPending] = React.useState(false)

  async function confirm() {
    if (!request) return
    setPending(true)
    try {
      await request.onConfirm()
      onClose()
    } catch {
      // The caller shows the error (toast); keep the dialog so the user can retry or cancel.
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={request?.destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
