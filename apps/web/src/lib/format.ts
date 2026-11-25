import type { GroupRole } from "@twg/shared"

import i18n, { currentLocale } from "@/i18n"

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
]

/** "in 7 days", "2 hours ago", "now" (or the Vietnamese), in the current language. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000
  const relative = new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" })
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit)
    }
  }
  return i18n.t("common.now")
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso))
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function roleLabel(role: GroupRole): string {
  return i18n.t(`roles.${role}`)
}
