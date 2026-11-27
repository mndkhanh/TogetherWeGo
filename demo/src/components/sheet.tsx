import { X } from "lucide-react"
import * as React from "react"

/**
 * A panel over the page for a form: a sheet from the bottom on phones, a centred card on larger
 * screens. A real modal (native <dialog>): the page behind can't be used, Escape closes it.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  const ref = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      // A click on the dimmed backdrop (outside the panel) closes it.
      onClick={(e) => e.target === ref.current && onClose()}
      className="mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl bg-surface p-0 text-ink shadow-xl ring-1 ring-line backdrop:bg-ink/40 backdrop:backdrop-blur-[2px] sm:m-auto sm:max-h-[90dvh] sm:w-[min(40rem,calc(100vw-2rem))] sm:rounded-2xl"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <h2 id={titleId} className="text-base font-bold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-full p-1.5 text-muted hover:bg-brand-soft hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
    </dialog>
  )
}
