import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  CreateGroupInput,
  CreateInviteInput,
  GroupDetailResponse,
  GroupRole,
  GroupSummaryResponse,
  InvitePreviewResponse,
  InviteResponse,
  UpdateGroupInput,
} from "@twg/shared"

import { api } from "@/lib/api"

export const groupKeys = {
  all: ["groups"] as const,
  detail: (id: string) => ["groups", id] as const,
  invites: (id: string) => ["groups", id, "invites"] as const,
  invitePreview: (code: string) => ["invites", code] as const,
}

const json = (body: unknown) => JSON.stringify(body)

export function useGroups() {
  return useQuery({
    queryKey: groupKeys.all,
    queryFn: () => api<GroupSummaryResponse[]>("/groups"),
  })
}

export function useGroup(groupId: string) {
  return useQuery({
    queryKey: groupKeys.detail(groupId),
    queryFn: () => api<GroupDetailResponse>(`/groups/${groupId}`),
    retry: false,
  })
}

/** Mutations that return the updated group refresh both the detail and the list. */
function useGroupMutation<TVariables>(
  groupId: string,
  mutationFn: (variables: TVariables) => Promise<GroupDetailResponse>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (group) => {
      queryClient.setQueryData(groupKeys.detail(groupId), group)
      void queryClient.invalidateQueries({ queryKey: groupKeys.all, exact: true })
    },
  })
}

export function useCreateGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateGroupInput) =>
      api<GroupDetailResponse>("/groups", { method: "POST", body: json(input) }),
    onSuccess: (group) => {
      queryClient.setQueryData(groupKeys.detail(group.id), group)
      void queryClient.invalidateQueries({ queryKey: groupKeys.all, exact: true })
    },
  })
}

export function useUpdateGroup(groupId: string) {
  return useGroupMutation(groupId, (input: UpdateGroupInput) =>
    api<GroupDetailResponse>(`/groups/${groupId}`, { method: "PATCH", body: json(input) })
  )
}

export function useSetArchived(groupId: string) {
  return useGroupMutation(groupId, (archived: boolean) =>
    api<GroupDetailResponse>(`/groups/${groupId}/${archived ? "archive" : "unarchive"}`, {
      method: "POST",
    })
  )
}

export function useChangeRole(groupId: string) {
  return useGroupMutation(groupId, ({ userId, role }: { userId: string; role: GroupRole }) =>
    api<GroupDetailResponse>(`/groups/${groupId}/members/${userId}`, {
      method: "PATCH",
      body: json({ role }),
    })
  )
}

/** Removes a member, or leaves the group when userId is the current user. */
export function useRemoveMember(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/groups/${groupId}/members/${userId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  })
}

export function useInvites(groupId: string, enabled: boolean) {
  return useQuery({
    queryKey: groupKeys.invites(groupId),
    queryFn: () => api<InviteResponse[]>(`/groups/${groupId}/invites`),
    enabled,
  })
}

export function useCreateInvite(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      api<InviteResponse>(`/groups/${groupId}/invites`, { method: "POST", body: json(input) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.invites(groupId) }),
  })
}

export function useRevokeInvite(groupId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (code: string) =>
      api<void>(`/groups/${groupId}/invites/${code}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.invites(groupId) }),
  })
}

export function useInvitePreview(code: string) {
  return useQuery({
    queryKey: groupKeys.invitePreview(code),
    queryFn: () => api<InvitePreviewResponse>(`/invites/${code}`),
    retry: false,
  })
}

export function useAcceptInvite(code: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<{ groupId: string }>(`/invites/${code}/accept`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  })
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/invite/${code}`
}
