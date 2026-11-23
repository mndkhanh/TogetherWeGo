import * as React from "react"

import { StoolScene } from "@/components/stools"
import { Wordmark } from "@/components/wordmark"

/** Split layout for sign-in and sign-up: the sidewalk scene on one side, the form on the other. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <aside className="flex flex-col justify-between gap-8 bg-primary px-6 pt-6 text-primary-foreground sm:px-10 sm:pt-8 lg:px-14 lg:pt-12">
        <Wordmark className="text-primary-foreground" />
        <div className="flex flex-col gap-4">
          <h1 className="max-w-[12ch] text-4xl leading-[1.02] font-extrabold tracking-tight text-balance sm:text-5xl xl:text-7xl">
            Pull up a stool. We'll keep the tab.
          </h1>
          <p className="max-w-[44ch] text-base text-primary-foreground/80 sm:text-lg">
            Plan hangouts with your friends, split what everyone spent, and settle up by bank
            transfer.
          </p>
        </div>
        <StoolScene className="max-w-md lg:max-w-lg" />
      </aside>
      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
