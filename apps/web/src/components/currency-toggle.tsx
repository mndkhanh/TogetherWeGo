import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type Currency = "VND" | "USD"

export function CurrencyToggle({
  value,
  onChange,
  disabled,
  id,
}: {
  value: Currency
  onChange: (currency: Currency) => void
  disabled?: boolean
  id?: string
}) {
  return (
    <ToggleGroup
      id={id}
      variant="outline"
      value={[value]}
      disabled={disabled}
      onValueChange={(next: string[]) => {
        const currency = next[0]
        if ((currency === "VND" || currency === "USD") && currency !== value) onChange(currency)
      }}
    >
      <ToggleGroupItem value="VND">VND ₫</ToggleGroupItem>
      <ToggleGroupItem value="USD">USD $</ToggleGroupItem>
    </ToggleGroup>
  )
}
