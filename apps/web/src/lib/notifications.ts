import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import type {
  NotificationPageResponse,
  NotificationPreferenceResponse,
  NotificationPreferencesInput,
  NotificationType,
  RealtimeNotification,
} from "@twg/shared"
import * as React from "react"
import { useNavigate } from "react-router"
import { io, type Socket } from "socket.io-client"
import { toast } from "sonner"

import { api, getAccessToken, refreshSession } from "@/lib/api"

export const notificationKeys = {
  feed: ["notifications"] as const,
  preferences: ["me", "notification-preferences"] as const,
}

const json = (body: unknown) => JSON.stringify(body)

export function useNotifications() {
  return useInfiniteQuery({
    queryKey: notificationKeys.feed,
    queryFn: ({ pageParam }) =>
      api<NotificationPageResponse>(
        `/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // Without a live connection, still catch up now and then.
    refetchInterval: 60_000,
  })
}

/** The latest unread count: from the newest page fetched. */
export function unreadCountOf(data: InfiniteData<NotificationPageResponse> | undefined): number {
  return data?.pages[0]?.unreadCount ?? 0
}

function useFeedMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<{ unreadCount: number }>,
  markLocally: (id: string, variables: TVariables) => boolean
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: ({ unreadCount }, variables) => {
      queryClient.setQueryData<InfiniteData<NotificationPageResponse>>(
        notificationKeys.feed,
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              unreadCount,
              items: page.items.map((n) =>
                markLocally(n.id, variables) ? { ...n, read: true } : n
              ),
            })),
          }
      )
    },
  })
}

export function useMarkRead() {
  return useFeedMutation(
    (id: string) => api<{ unreadCount: number }>(`/notifications/${id}/read`, { method: "POST" }),
    (id, target) => id === target
  )
}

export function useMarkAllRead() {
  return useFeedMutation(
    () => api<{ unreadCount: number }>("/notifications/read-all", { method: "POST" }),
    () => true
  )
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: () => api<NotificationPreferenceResponse[]>("/me/notification-preferences"),
  })
}

export function useSaveNotificationPreferences() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: NotificationPreferencesInput) =>
      api<NotificationPreferenceResponse[]>("/me/notification-preferences", {
        method: "PUT",
        body: json(input),
      }),
    // Flip the switch straight away; put it back if saving fails.
    onMutate: ({ preferences }) => {
      const before = queryClient.getQueryData<NotificationPreferenceResponse[]>(
        notificationKeys.preferences
      )
      const changed = new Map(preferences.map((p) => [p.type, p]))
      queryClient.setQueryData<NotificationPreferenceResponse[]>(
        notificationKeys.preferences,
        (prefs) => prefs?.map((p) => ({ ...p, ...changed.get(p.type) }))
      )
      return { before }
    },
    onError: (_error, _input, context) =>
      queryClient.setQueryData(notificationKeys.preferences, context?.before),
    onSuccess: (prefs) => queryClient.setQueryData(notificationKeys.preferences, prefs),
  })
}

// ---------- Live updates ----------

/** Which cached data a notification makes stale, so open screens update by themselves. */
function staleKeys(type: NotificationType, groupId: string | undefined): unknown[][] {
  if (!groupId) return [["me", "unmatched-transfers"]]
  if (type.startsWith("expense.")) return [["groups", groupId]] // expenses, balances, events
  if (type.startsWith("event.")) return [["groups", groupId, "events"], ["events"]]
  if (type.startsWith("settlement.")) {
    return [["groups", groupId, "settlements"], ["groups", groupId, "balances"], ["settlements"]]
  }
  if (type === "group.member_joined") return [["groups", groupId], ["groups"]]
  return []
}

/**
 * One WebSocket for the signed-in user. New notifications land in the feed cache, show a
 * toast, and refresh whatever data they're about. The access token goes in the handshake;
 * when it expires the server hangs up, and this refreshes the session and reconnects.
 */
export function useRealtime(enabled: boolean): void {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!enabled) return
    let stopped = false
    const socket: Socket = io({
      path: "/v1/realtime",
      transports: ["websocket"],
      auth: (cb) => cb({ token: getAccessToken() ?? "" }),
      reconnectionDelayMax: 30_000,
    })

    async function reconnectWithFreshToken() {
      const session = await refreshSession()
      if (session && !stopped) socket.connect()
    }

    socket.on("connect_error", (err) => {
      // A bad or expired token: the client won't retry by itself, so refresh and try again.
      if (err.message === "unauthorized") void reconnectWithFreshToken()
    })
    socket.on("session_expired", () => void reconnectWithFreshToken())
    // Missed messages while offline: catch up from the feed.
    socket.on("connect", () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.feed })
    })

    socket.on("notification", ({ notification, unreadCount }: RealtimeNotification) => {
      queryClient.setQueryData<InfiniteData<NotificationPageResponse>>(
        notificationKeys.feed,
        (data) => {
          if (!data) return data
          const [first, ...rest] = data.pages
          if (!first || first.items.some((n) => n.id === notification.id)) return data
          return {
            ...data,
            pages: [
              { ...first, unreadCount, items: [notification, ...first.items] },
              ...rest.map((p) => ({ ...p, unreadCount })),
            ],
          }
        }
      )
      for (const queryKey of staleKeys(notification.type, notification.data.groupId)) {
        void queryClient.invalidateQueries({ queryKey })
      }
      toast(notification.text, {
        action: { label: "Open", onClick: () => void navigate(notification.link) },
      })
    })

    return () => {
      stopped = true
      socket.disconnect()
    }
  }, [enabled, queryClient, navigate])
}
