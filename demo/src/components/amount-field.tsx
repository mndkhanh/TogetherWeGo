import { Field, Input, cx } from "@/components/ui"
import { formatVnd, parseVnd } from "@/lib/money"

/**
 * An amount in dong that also takes shorthand: 250k, 1m, 1.5tr. Below the box it shows what the
 * amount comes to, so "1m" is seen to mean 1.000.000 ₫ before anyone saves it. The keyboard is
 * the normal one, not the number pad, so the k and m can be typed on a phone.
 */
export function AmountField({
  label = "Amount (₫)",
  value,
  onChange,
  className,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const amount = parseVnd(value)
  const typed = value.trim() !== ""

  return (
    <Field
      label={label}
      className={className}
      hint={
        amount
          ? `= ${formatVnd(amount)}`
          : typed
            ? "Not an amount yet. Try 250000, 250k or 1m."
            : "250000, 250k or 1m (1.000.000 ₫)"
      }
    >
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        aria-invalid={typed && !amount}
        className={cx("tabular-nums", typed && !amount && "ring-owe/60")}
      />
    </Field>
  )
}
