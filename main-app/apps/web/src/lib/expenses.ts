import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type BalancesResponse,
  type CreateExpenseInput,
  type Currency,
  type ExpenseDetailResponse,
  type ExpensePageResponse,
  formatMoney,
  MAX_RECEIPT_BYTES,
  RECEIPT_CONTENT_TYPES,
  type ReceiptContentType,
  type ReceiptUploadResponse,
  type UpdateExpenseInput,
} from "@twg/shared"

import i18n from "@/i18n"
import { isoDateIn } from "@/lib/time"
import { api } from "@/lib/api"

export const expenseKeys = {
  list: (groupId: string) => ["groups", groupId, "expenses"] as const,
  balances: (groupId: string) => ["groups", groupId, "balances"] as const,
  detail: (expenseId: string) => ["expenses", expenseId] as const,
}

const json = (body: unknown) => JSON.stringify(body)

/** VND reads naturally as "150.000 ₫", USD as "$10.50". */
export function money(amount: number, currency: Currency): string {
  return formatMoney(amount, currency, currency === "VND" ? "vi-VN" : "en-US")
}

/** Today in the account's time zone, as YYYY-MM-DD. */
export function today(): string {
  return isoDateIn(new Date())
}

export function useExpenses(groupId: string) {
  return useInfiniteQuery({
    queryKey: expenseKeys.list(groupId),
    queryFn: ({ pageParam }) =>
      api<ExpensePageResponse>(
        `/groups/${groupId}/expenses?limit=30${pageParam ? `&cursor=${pageParam}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

/** The expenses linked to one event, newest first, a page at a time. */
export function useEventExpenses(groupId: string, eventId: string) {
  return useInfiniteQuery({
    // Under the group's expense key, so any expense change refreshes it too.
    queryKey: [...expenseKeys.list(groupId), "event", eventId] as const,
    queryFn: ({ pageParam }) =>
      api<ExpensePageResponse>(
        `/groups/${groupId}/expenses?eventId=${eventId}&limit=30${pageParam ? `&cursor=${pageParam}` : ""}`
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
}

export function useExpense(expenseId: string | null) {
  return useQuery({
    queryKey: expenseKeys.detail(expenseId ?? ""),
    queryFn: () => api<ExpenseDetailResponse>(`/expenses/${expenseId}`),
    enabled: expenseId !== null,
    retry: false,
    // Receipt links expire after 5 minutes; refetch rather than show a dead image.
    staleTime: 60_000,
  })
}

export function useBalances(groupId: string) {
  return useQuery({
    queryKey: expenseKeys.balances(groupId),
    queryFn: () => api<BalancesResponse>(`/groups/${groupId}/balances`),
  })
}

/** Any change to an expense moves balances, so both are refreshed together. */
function useExpenseMutation<TVariables, TResult>(
  groupId: string,
  mutationFn: (variables: TVariables) => Promise<TResult>
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (result) => {
      if (result && typeof result === "object" && "id" in result) {
        queryClient.setQueryData(expenseKeys.detail(String(result.id)), result)
      }
      void queryClient.invalidateQueries({ queryKey: expenseKeys.list(groupId) })
      void queryClient.invalidateQueries({ queryKey: expenseKeys.balances(groupId) })
      // An event's page shows what was spent for it.
      void queryClient.invalidateQueries({ queryKey: ["events"] })
    },
  })
}

export function useCreateExpense(groupId: string) {
  return useExpenseMutation(groupId, (input: CreateExpenseInput) =>
    api<ExpenseDetailResponse>(`/groups/${groupId}/expenses`, {
      method: "POST",
      body: json(input),
    })
  )
}

export function useUpdateExpense(groupId: string, expenseId: string) {
  return useExpenseMutation(groupId, (input: UpdateExpenseInput) =>
    api<ExpenseDetailResponse>(`/expenses/${expenseId}`, { method: "PATCH", body: json(input) })
  )
}

export function useDeleteExpense(groupId: string) {
  return useExpenseMutation(groupId, (expenseId: string) =>
    api<void>(`/expenses/${expenseId}`, { method: "DELETE" })
  )
}

export class ReceiptError extends Error {}

/** Checks the file, asks the API for a signed upload, then sends the photo straight to storage. */
export async function uploadReceipt(groupId: string, file: File): Promise<string> {
  if (!(RECEIPT_CONTENT_TYPES as readonly string[]).includes(file.type)) {
    throw new ReceiptError(i18n.t("receipt.type"))
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new ReceiptError(i18n.t("receipt.size", { mb: MAX_RECEIPT_BYTES / 1024 / 1024 }))
  }
  const upload = await api<ReceiptUploadResponse>(`/groups/${groupId}/receipts`, {
    method: "POST",
    body: json({ contentType: file.type as ReceiptContentType, size: file.size }),
  })
  const form = new FormData()
  for (const [key, value] of Object.entries(upload.fields)) form.append(key, value)
  form.append("file", file)
  const res = await fetch(upload.url, { method: "POST", body: form })
  if (!res.ok) throw new ReceiptError(i18n.t("receipt.uploadFailed"))
  return upload.key
}
