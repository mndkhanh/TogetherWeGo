import { LOCALES } from "@twg/shared"
import { useTranslation } from "react-i18next"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { currentLocale } from "@/i18n"
import { useSetLocale } from "@/lib/locale"

/** English / Tiếng Việt, each named in its own language. Saved to the account when signed in. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { t } = useTranslation()
  const setLocale = useSetLocale()
  const value = currentLocale()

  return (
    <ToggleGroup
      className={className}
      value={[value]}
      variant="outline"
      onValueChange={(next: string[]) => {
        const picked = next[0]
        if (picked === "en" || picked === "vi") void setLocale(picked)
      }}
      aria-label={t("shell.language")}
      size="sm"
    >
      {LOCALES.map((locale) => (
        <ToggleGroupItem key={locale} value={locale} lang={locale}>
          {t(`language.${locale}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
