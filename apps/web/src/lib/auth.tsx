import { useQueryClient } from "@tanstack/react-query"
import type { AuthResponse, LoginInput, MeResponse, RegisterInput } from "@twg/shared"
import * as React from "react"

import { currentLocale, deviceTimeZone, setLocale } from "@/i18n"
import { api, refreshSession, setAccessToken } from "@/lib/api"
import { setTimeZone } from "@/lib/time"

type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed-in"; user: MeResponse }
  | { status: "signed-out"; user: null }

interface AuthContextValue {
  state: AuthState
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  /** Re-reads the session from the refresh cookie (used after Google sign-in). */
  restore: () => Promise<boolean>
}

const AuthContext = React.createContext<AuthContextValue | undefined>(undefined)

export const meQueryKey = ["me"] as const

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = React.useState<AuthState>({ status: "loading", user: null })

  const applySession = React.useCallback(
    (session: AuthResponse | null) => {
      if (session) {
        setAccessToken(session.accessToken)
        queryClient.setQueryData(meQueryKey, session.user)
        // The account's language wins over this device's, so the screen matches the emails.
        setLocale(session.user.locale)
        setTimeZone(session.user.timeZone)
        setState({ status: "signed-in", user: session.user })
      } else {
        setAccessToken(null)
        setTimeZone(deviceTimeZone())
        queryClient.clear()
        setState({ status: "signed-out", user: null })
      }
    },
    [queryClient]
  )

  const restore = React.useCallback(async () => {
    const session = await refreshSession()
    applySession(session)
    return session !== null
  }, [applySession])

  React.useEffect(() => {
    void restore()
  }, [restore])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      state,
      restore,
      login: async (input) => {
        applySession(
          await api<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(input) })
        )
      },
      register: async (input) => {
        applySession(
          await api<AuthResponse>("/auth/register", {
            method: "POST",
            // A new account starts in the language on screen and this device's time zone.
            body: JSON.stringify({ locale: currentLocale(), timeZone: deviceTimeZone(), ...input }),
          })
        )
      },
      logout: async () => {
        await api<void>("/auth/logout", { method: "POST" }).catch(() => undefined)
        applySession(null)
      },
    }),
    [state, restore, applySession]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
