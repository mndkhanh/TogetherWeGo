import * as React from "react"
import { useTranslation } from "react-i18next"

import { LanguageSwitch } from "@/components/language-switch"
import { StoolScene } from "@/components/stools"
import { Wordmark } from "@/components/wordmark"

/** Split layout for sign-in and sign-up: the sidewalk scene on one side, the form on the other. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="flex flex-col justify-between gap-8 bg-stool-yellow px-6 pt-6 text-stool-deep sm:px-10 sm:pt-8 lg:px-14 lg:pt-12">
        <Wordmark className="text-stool-deep" />
        <div className="flex flex-col gap-4">
          <h1 className="max-w-[12ch] text-4xl leading-[1.02] font-extrabold tracking-tight text-balance sm:text-5xl xl:text-7xl">
            {t("auth.headline")}
          </h1>
          <p className="max-w-[44ch] text-base text-stool-deep/85 sm:text-lg">{t("auth.pitch")}</p>
        </div>
        <StoolScene className="max-w-md lg:max-w-lg" />
      </aside>
      <main className="relative flex items-center justify-center px-6 py-12 sm:px-10">
        <LanguageSwitch className="absolute top-4 right-4 sm:top-6 sm:right-6" />
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
