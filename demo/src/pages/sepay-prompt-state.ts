import * as React from "react"
import { useLocation } from "react-router"

import { useUser } from "@/lib/auth"
import { usePaymentAccount } from "@/lib/payments"

const askedKey = (uid: string) => `twg:sepay-asked:${uid}`

/**
 * Whether to show the "get paid by bank" step: once, after profile setup, for people who haven't
 * connected SePay yet. Not while they're following an invite (they join first, and see it the
 * next time), and not on the payment pages themselves.
 */
export function useSepayPrompt(): { show: boolean; done: () => void } {
  const user = useUser()
  const { pathname } = useLocation()
  const account = usePaymentAccount(user.uid)
  const [asked, setAsked] = React.useState(() => localStorage.getItem(askedKey(user.uid)) !== null)

  const done = React.useCallback(() => {
    localStorage.setItem(askedKey(user.uid), new Date().toISOString())
    setAsked(true)
  }, [user.uid])

  const inFlow = ["/j/", "/join/", "/settings/payments", "/help/"].some((p) => pathname.startsWith(p))
  const connected = account.data?.sepay != null
  return { show: !asked && !inFlow && account.data !== undefined && !connected, done }
}
