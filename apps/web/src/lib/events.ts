import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CommentPageResponse,
  CommentResponse,
  CreateEventInput,
  EventDetailResponse,
  EventPageResponse,
  RsvpStatus,
  UpdateEventInput,
} from "@twg/shared"

import { api } from "@/lib/api"

export const eventKeys = {
  all: (groupId: string) => ["groups", groupId, "events"] as const,
  list: (groupId: string, when: "upcoming" | "past") =>
    ["groups", groupId, "events", when] as const,
  detail: (eventId: string) => ["events", eventId] as const,
  comments: (eventId: string) => ["events", eventId, "comments"] as const,
}

const json = (body: unknown) => JSON.stringify(body)

export function useEvents(groupId: string, when: "upcoming" | "past", enabled = true) {
  return useInfiniteQuery({
    queryKey: eventKeys.list(groupId, when),
    queryFn: ({ pageParam }) =>
      api<EventPageResponse>(
        `/groups/${groupId}/events?when=${when}&limit=20${pageParam ? `&cursor=${pageParam}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  })
}

export function useEvent(eventId: string) {
  return useQuery({
    queryKey: eventKeys.detail(eventId),
    queryFn: () => api<EventDetailResponse>(`/events/${eventId}`),
    retry: false,
  })
}

/** Changes to one event refresh it and the group's lists. */
function useEventMutation<TVariables>(
  groupId: string,
  mutationFn: (variables: TVariables) => Promise<EventDetailResponse>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (event) => {
      queryClient.setQueryData(eventKeys.detail(event.id), event)
      void queryClient.invalidateQueries({ queryKey: eventKeys.all(groupId) })
    },
  })
}

export function useCreateEvent(groupId: string) {
  return useEventMutation(groupId, (input: CreateEventInput) =>
    api<EventDetailResponse>(`/groups/${groupId}/events`, { method: "POST", body: json(input) })
  )
}

export function useUpdateEvent(groupId: string, eventId: string) {
  return useEventMutation(groupId, (input: UpdateEventInput) =>
    api<EventDetailResponse>(`/events/${eventId}`, { method: "PATCH", body: json(input) })
  )
}

export function useCancelEvent(groupId: string, eventId: string) {
  return useEventMutation(groupId, () =>
    api<EventDetailResponse>(`/events/${eventId}/cancel`, { method: "POST" })
  )
}

export function useRsvp(groupId: string, eventId: string) {
  return useEventMutation(groupId, (status: RsvpStatus) =>
    api<EventDetailResponse>(`/events/${eventId}/rsvp`, { method: "PUT", body: json({ status }) })
  )
}

// ---------- Comments ----------

export function useComments(eventId: string) {
  return useInfiniteQuery({
    queryKey: eventKeys.comments(eventId),
    queryFn: ({ pageParam }) =>
      api<CommentPageResponse>(
        `/events/${eventId}/comments?limit=50${pageParam ? `&cursor=${pageParam}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // A light poll keeps a conversation going until real-time updates arrive (Phase 5).
    refetchInterval: 15_000,
  })
}

function useCommentMutation<TVariables, TResult>(
  eventId: string,
  mutationFn: (variables: TVariables) => Promise<TResult>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.comments(eventId) })
      void queryClient.invalidateQueries({ queryKey: eventKeys.detail(eventId), exact: true })
    },
  })
}

export function useAddComment(eventId: string) {
  return useCommentMutation(eventId, (body: string) =>
    api<CommentResponse>(`/events/${eventId}/comments`, { method: "POST", body: json({ body }) })
  )
}

export function useDeleteComment(eventId: string) {
  return useCommentMutation(eventId, (commentId: string) =>
    api<void>(`/comments/${commentId}`, { method: "DELETE" })
  )
}

// ---------- Dates ----------

const dayFormat = new Intl.DateTimeFormat("en", {
  weekday: "short",
  day: "numeric",
  month: "short",
})
const timeFormat = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })

/** "Sat 24 Dec · 7:00 PM – 10:00 PM", or with both dates when it runs over several days. */
export function formatEventTime(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt)
  const head = `${dayFormat.format(start)} · ${timeFormat.format(start)}`
  if (!endsAt) return head
  const end = new Date(endsAt)
  const sameDay = start.toDateString() === end.toDateString()
  return sameDay
    ? `${head} – ${timeFormat.format(end)}`
    : `${head} – ${dayFormat.format(end)} · ${timeFormat.format(end)}`
}

/** Local "YYYY-MM-DD" and "HH:mm" for date and time inputs. */
export function toLocalInputs(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** The user's local date and time, as an instant the API understands; null if incomplete. */
export function fromLocalInputs(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const value = new Date(`${date}T${time}:00`)
  return Number.isNaN(value.getTime()) ? null : value.toISOString()
}
