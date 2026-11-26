import { type Locale, toLocale } from "@twg/shared"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import en from "./en.json"
import viJson from "./vi.json"

/**
 * The app in English and Vietnamese.
 *
 * - en.json is the source; vi.json must have exactly the same keys (checked at compile time
 *   just below, so a missing translation fails the build). Plurals use i18next's _one/_other;
 *   Vietnamese has no plural forms, so its _one simply repeats _other.
 * - Signed in, the language is the account's (MeResponse.locale), so emails and notifications
 *   match the screen. Signed out, it's the last one picked on this device, else the browser's.
 */
export const vi: typeof en = viJson

const STORAGE_KEY = "twg-locale"

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return toLocale(saved)
  } catch {
    // Storage blocked (private mode): fall back to the browser's language.
  }
  return toLocale(navigator.language)
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, vi: { translation: vi } },
  lng: initialLocale(),
  fallbackLng: "en",
  // React escapes everything it renders; i18next must not escape a second time.
  interpolation: { escapeValue: false },
})

document.documentElement.lang = i18n.language

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Not remembered on this device; the account still has it.
  }
})

export function currentLocale(): Locale {
  return toLocale(i18n.language)
}

/** Switches the whole app. Signed-in callers also save it to the account (see useSetLocale). */
export function setLocale(locale: Locale): void {
  if (currentLocale() !== locale) void i18n.changeLanguage(locale)
}

/** The device's time zone, e.g. "Asia/Ho_Chi_Minh". */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export default i18n
