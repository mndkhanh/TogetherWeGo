import type { AuthResponse } from "@twg/shared"

/**
 * Minimal API client.
 * - The access token lives only in memory (never localStorage), so XSS can't read it from storage.
 * - The refresh token is an httpOnly cookie scoped to /v1/auth that JavaScript can't see at all.
 * - Concurrent 401s share one refresh request.
 */

export class ApiError extends Error {
  readonly status: number
  readonly issues: { path: string; message: string }[]

  constructor(status: number, message: string, issues: { path: string; message: string }[] = []) {
    super(message)
    this.status = status
    this.issues = issues
  }
}

let accessToken: string | null = null
let refreshInFlight: Promise<AuthResponse | null> | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

/** For the realtime socket, which sends the token in its handshake rather than a header. */
export function getAccessToken(): string | null {
  return accessToken
}

async function parseError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    message?: unknown
    issues?: { path: string; message: string }[]
  }
  const message = typeof body.message === "string" ? body.message : `Request failed (${res.status})`
  return new ApiError(res.status, message, body.issues ?? [])
}

/** Exchanges the refresh cookie for a new access token. Resolves to null when signed out. */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch("/v1/auth/refresh", { method: "POST", credentials: "same-origin" })
      if (!res.ok) {
        accessToken = null
        return null
      }
      const session = (await res.json()) as AuthResponse
      accessToken = session.accessToken
      return session
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json")
  }
  if (accessToken) {
    headers.set("authorization", `Bearer ${accessToken}`)
  }

  const res = await fetch(`/v1${path}`, { ...init, headers, credentials: "same-origin" })

  if (res.status === 401 && retry && accessToken) {
    const session = await refreshSession()
    if (session) {
      return api<T>(path, init, false)
    }
  }
  if (!res.ok) {
    throw await parseError(res)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}
