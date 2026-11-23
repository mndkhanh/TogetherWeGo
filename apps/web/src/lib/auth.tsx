import { useQueryClient } from "@tanstack/react-query"
import type { AuthResponse, LoginInput, MeResponse, RegisterInput } from "@twg/shared"
import * as React from "react"

import { api, refreshSession, setAccessToken } from "@/lib/api"

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
        setState({ status: "signed-in", user: session.user })
      } else {
        setAccessToken(null)
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
          await api<AuthResponse>("/auth/register", { method: "POST", body: JSON.stringify(input) })
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
