import { useQueryClient } from "@tanstack/react-query"
import type { Locale, MeResponse, UpdateMeInput } from "@twg/shared"
import * as React from "react"

import { setLocale } from "@/i18n"
import { api } from "@/lib/api"
import { meQueryKey, useAuth } from "@/lib/auth"
import { setTimeZone } from "@/lib/time"

/** Saves profile settings (language, time zone, …) and keeps the cached profile in step. */
export function useUpdateMe() {
  const queryClient = useQueryClient()
  return React.useCallback(
    async (input: UpdateMeInput) => {
      const me = await api<MeResponse>("/me", { method: "PATCH", body: JSON.stringify(input) })
      setTimeZone(me.timeZone)
      queryClient.setQueryData(meQueryKey, me)
      // Event times on screen follow the account's time zone: redraw them.
      if (input.timeZone) void queryClient.invalidateQueries()
      return me
    },
    [queryClient]
  )
}

/**
 * Switches the language right away; signed in, also saves it to the account so emails and
 * notifications follow. If saving fails the screen still switches, and the next sign-in
 * brings back the saved language.
 */
export function useSetLocale() {
  const { state } = useAuth()
  const updateMe = useUpdateMe()
  const signedIn = state.status === "signed-in"
  return React.useCallback(
    async (locale: Locale) => {
      setLocale(locale)
      if (signedIn) await updateMe({ locale })
    },
    [signedIn, updateMe]
  )
}
