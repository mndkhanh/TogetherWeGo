import * as React from "react"

import { Button } from "@/components/ui"

export interface ConfirmOptions {
  title: string
  body: React.ReactNode
  /** The button that goes ahead, named for what it does: "Delete expense", "Remove". */
  action: string
  /** The button that backs out. */
  cancel?: string
}

/**
 * A "are you sure?" popup for things that are hard to undo. A real modal (the page behind can't
 * be clicked, Escape backs out, focus starts on the safe button), not the browser's confirm().
 *
 *   const { confirm, dialog } = useConfirm()
 *   if (await confirm({ title, body, action: "Delete" })) …
 *   return <>{…}{dialog}</>
 */
export function useConfirm() {
  const [pending, setPending] = React.useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null)

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  const dialog = pending ? <ConfirmDialog {...pending} onClose={close} /> : null
  return { confirm, dialog }
}

function ConfirmDialog({
  title,
  body,
  action,
  cancel = "Keep it",
  onClose,
}: ConfirmOptions & { onClose: (ok: boolean) => void }) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()
  const bodyId = React.useId()

  React.useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      // Escape, or a click on the backdrop, backs out.
      onCancel={(e) => {
        e.preventDefault()
        onClose(false)
      }}
      onClick={(e) => e.target === ref.current && onClose(false)}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl bg-surface p-0 text-ink shadow-xl ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <div id={bodyId} className="text-sm text-muted">
          {body}
        </div>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" autoFocus onClick={() => onClose(false)}>
            {cancel}
          </Button>
          <Button onClick={() => onClose(true)}>
            {action}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
