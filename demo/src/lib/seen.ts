import * as React from "react"

/**
 * When you last looked at a group, on this device, so what others added since can be marked
 * new. Kept in the browser only: it's a hint, not something to sync.
 */
const key = (uid: string, groupId: string) => `twg:seen:${uid}:${groupId}`

export function lastSeen(uid: string, groupId: string): Date | null {
  const value = localStorage.getItem(key(uid, groupId))
  const at = value ? new Date(value) : null
  return at && !Number.isNaN(at.getTime()) ? at : null
}

/**
 * Your previous visit to the group (null on the first), for as long as you're on it. Leaving
 * the page, or switching away from the tab, counts as having seen everything up to then.
 */
export function useLastVisit(uid: string, groupId: string): Date | null {
  // Read before this visit's effect saves a new time (and again for another group).
  const previous = React.useMemo(() => lastSeen(uid, groupId), [uid, groupId])
  React.useEffect(() => {
    const save = () => localStorage.setItem(key(uid, groupId), new Date().toISOString())
    const onHide = () => document.visibilityState === "hidden" && save()
    document.addEventListener("visibilitychange", onHide)
    // Closing or reloading the page doesn't unmount anything.
    window.addEventListener("pagehide", save)
    return () => {
      document.removeEventListener("visibilitychange", onHide)
      window.removeEventListener("pagehide", save)
      save()
    }
  }, [uid, groupId])
  return previous
}
