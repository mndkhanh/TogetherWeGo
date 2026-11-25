import { CheckIcon, CopyIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

/** A read-only value with a copy button, for account numbers, codes and keys. */
export function CopyValue({
  id,
  value,
  label,
  mono = false,
}: {
  id: string
  value: string
  /** Used in the toast and the button's accessible name, e.g. "Account number". */
  label: string
  mono?: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(t("copy.copied", { label }))
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t("copy.failed"))
    }
  }

  return (
    <InputGroup>
      <InputGroupInput
        id={id}
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        className={mono ? "font-mono tracking-wide" : undefined}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          onClick={() => void copy()}
          aria-label={t("copy.aria", { label: label.toLowerCase() })}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
