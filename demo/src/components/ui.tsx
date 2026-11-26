import * as React from "react"

import { StoolMark } from "@/components/stool"

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger"

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "bg-surface text-ink ring-1 ring-line hover:bg-brand-soft",
  ghost: "text-muted hover:bg-brand-soft hover:text-ink",
  danger: "text-owe hover:bg-owe/10",
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-10 px-4 text-sm" : "h-8 px-2.5 text-xs",
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cx("flex flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  )
}

const control =
  "h-10 w-full rounded-lg bg-surface px-3 text-sm ring-1 ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-brand focus:outline-none"

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input className={cx(control, className)} {...props} />
}

export function Select({ className, ...props }: React.ComponentProps<"select">) {
  return <select className={cx(control, className)} {...props} />
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg bg-owe/10 px-3 py-2 text-sm text-owe">
      {children}
    </p>
  )
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cx("rounded-2xl bg-surface p-5 ring-1 ring-line", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** An empty list: one stool waiting for company. */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <StoolMark className="h-8 w-auto text-stool/35" />
      <p className="text-sm text-muted">{children}</p>
    </div>
  )
}

export function Loading() {
  return <p className="py-6 text-center text-sm text-muted">Loading…</p>
}

/** Initials in a colored circle; the color is stable per person. */
export function Avatar({
  name,
  uid,
  photo,
  size = "md",
}: {
  name: string
  uid: string
  /** A profile photo link; initials show when there's none or it fails to load. */
  photo?: string | null
  size?: "sm" | "md" | "lg"
}) {
  const [broken, setBroken] = React.useState<string | null>(null)
  const sizes = { sm: "size-7 text-[0.65rem]", md: "size-9 text-xs", lg: "size-16 text-lg" }
  if (photo && broken !== photo) {
    return (
      <img
        src={photo}
        alt=""
        aria-hidden
        onError={() => setBroken(photo)}
        className={cx("shrink-0 rounded-full object-cover ring-1 ring-line", sizes[size])}
      />
    )
  }
  const hues = [8, 42, 24, 345, 150, 28]
  const hue = hues[[...uid].reduce((sum, c) => sum + c.charCodeAt(0), 0) % hues.length]
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-bold text-ink",
        sizes[size],
      )}
      style={{ background: `hsl(${hue} 55% 82%)` }}
    >
      {initials || "?"}
    </span>
  )
}

/** Runs an async action, tracking busy state and a readable error. */
export function useAction() {
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const run = React.useCallback(
    async (action: () => Promise<unknown>, toMessage: (e: unknown) => string) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        return true
      } catch (e) {
        setError(toMessage(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [],
  )
  return { busy, error, run, setError }
}

export { cx }
