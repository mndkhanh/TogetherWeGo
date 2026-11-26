/**
 * Where to send someone after they sign in, e.g. back to the invite link they opened.
 * Kept in sessionStorage so it survives the full-page Google sign-in redirect.
 * Only same-site paths are accepted, so this can't be abused as an open redirect.
 *
 * Reading doesn't clear it (render-safe under StrictMode); it's cleared once a
 * signed-in page has rendered.
 */
const KEY = "twg_return_to"

function isSafePath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//")
}

export function rememberReturnTo(path: string): void {
  if (isSafePath(path) && path !== "/login" && path !== "/register") {
    sessionStorage.setItem(KEY, path)
  }
}

export function peekReturnTo(): string {
  const path = sessionStorage.getItem(KEY)
  return isSafePath(path) ? path : "/"
}

export function clearReturnTo(): void {
  sessionStorage.removeItem(KEY)
}
