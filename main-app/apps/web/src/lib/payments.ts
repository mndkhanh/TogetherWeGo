import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AssignTransferInput,
  ConfirmSettlementInput,
  CreateSettlementInput,
  PaymentAccountInput,
  PaymentAccountResponse,
  SepayKeyResponse,
  SettlementDetailResponse,
  SettlementResponse,
  UnmatchedTransferResponse,
} from "@twg/shared"
import * as React from "react"

import { api } from "@/lib/api"
import { expenseKeys } from "@/lib/expenses"

export const paymentKeys = {
  account: ["me", "payment-account"] as const,
  unmatched: ["me", "unmatched-transfers"] as const,
  list: (groupId: string) => ["groups", groupId, "settlements"] as const,
  detail: (id: string) => ["settlements", id] as const,
}

const json = (body: unknown) => JSON.stringify(body)

// ---------- My bank details ----------

export function usePaymentAccount() {
  return useQuery({
    queryKey: paymentKeys.account,
    queryFn: async () =>
      (await api<{ account: PaymentAccountResponse | null }>("/me/payment-account")).account,
  })
}

function useAccountMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  pick: (result: TResult) => PaymentAccountResponse | null
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (result) => queryClient.setQueryData(paymentKeys.account, pick(result)),
  })
}

export function useSavePaymentAccount() {
  return useAccountMutation(
    (input: PaymentAccountInput) =>
      api<PaymentAccountResponse>("/me/payment-account", { method: "PUT", body: json(input) }),
    (account) => account
  )
}

export function useRemovePaymentAccount() {
  return useAccountMutation(
    () => api<void>("/me/payment-account", { method: "DELETE" }),
    () => null
  )
}

export function useCreateSepayKey() {
  return useAccountMutation(
    () => api<SepayKeyResponse>("/me/payment-account/sepay-key", { method: "POST" }),
    (result) => result.account
  )
}

export function useRemoveSepayKey() {
  return useAccountMutation(
    () => api<PaymentAccountResponse>("/me/payment-account/sepay-key", { method: "DELETE" }),
    (account) => account
  )
}

// ---------- Payments in a group ----------

export function useSettlements(groupId: string, enabled = true) {
  return useQuery({
    queryKey: paymentKeys.list(groupId),
    queryFn: () => api<SettlementResponse[]>(`/groups/${groupId}/settlements`),
    enabled,
  })
}

/**
 * While a payment is pending, check every few seconds so "Paid" shows up on its own. When it
 * changes underneath us (SePay confirmed it, or the other person did), balances move too.
 */
export function useSettlement(settlementId: string | null) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: paymentKeys.detail(settlementId ?? ""),
    queryFn: () => api<SettlementDetailResponse>(`/settlements/${settlementId}`),
    enabled: settlementId !== null,
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 4000 : false),
  })
  const status = query.data?.status
  const groupId = query.data?.groupId
  const seen = React.useRef(status)
  React.useEffect(() => {
    if (seen.current && status && seen.current !== status && groupId) {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.list(groupId) })
      void queryClient.invalidateQueries({ queryKey: expenseKeys.balances(groupId) })
    }
    seen.current = status
  }, [status, groupId, queryClient])
  return query
}

/** A payment changes balances, so all three views refresh together. */
function useSettlementMutation<TVariables>(
  groupId: string,
  mutationFn: (variables: TVariables) => Promise<SettlementDetailResponse>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (settlement) => {
      queryClient.setQueryData(paymentKeys.detail(settlement.id), settlement)
      void queryClient.invalidateQueries({ queryKey: paymentKeys.list(groupId) })
      void queryClient.invalidateQueries({ queryKey: expenseKeys.balances(groupId) })
    },
  })
}

export function useCreateSettlement(groupId: string) {
  return useSettlementMutation(groupId, (input: CreateSettlementInput) =>
    api<SettlementDetailResponse>(`/groups/${groupId}/settlements`, {
      method: "POST",
      body: json(input),
    })
  )
}

export function useConfirmSettlement(groupId: string) {
  return useSettlementMutation(
    groupId,
    ({ id, ...input }: ConfirmSettlementInput & { id: string }) =>
      api<SettlementDetailResponse>(`/settlements/${id}/confirm`, {
        method: "POST",
        body: json(input),
      })
  )
}

export function useCancelSettlement(groupId: string) {
  return useSettlementMutation(groupId, (id: string) =>
    api<SettlementDetailResponse>(`/settlements/${id}/cancel`, { method: "POST" })
  )
}

// ---------- Transfers that matched no payment ----------

export function useUnmatchedTransfers(enabled = true) {
  return useQuery({
    queryKey: paymentKeys.unmatched,
    queryFn: () => api<UnmatchedTransferResponse[]>("/me/unmatched-transfers"),
    enabled,
  })
}

export function useAssignTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: AssignTransferInput & { id: string }) =>
      api<SettlementDetailResponse>(`/me/unmatched-transfers/${id}/assign`, {
        method: "POST",
        body: json(input),
      }),
    onSuccess: (settlement) => {
      void queryClient.invalidateQueries({ queryKey: paymentKeys.unmatched })
      void queryClient.invalidateQueries({ queryKey: paymentKeys.list(settlement.groupId) })
      void queryClient.invalidateQueries({ queryKey: expenseKeys.balances(settlement.groupId) })
    },
  })
}

export function useIgnoreTransfer() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`/me/unmatched-transfers/${id}/ignore`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: paymentKeys.unmatched }),
  })
}
