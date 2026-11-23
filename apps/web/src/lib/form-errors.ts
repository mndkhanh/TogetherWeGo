import type { z } from "zod"

import { ApiError } from "@/lib/api"

export type FieldErrors = Record<string, string | undefined>

/** First message per field, from either client-side zod validation or a 400 from the API. */
export function toFieldErrors(
  issues: { path: PropertyKey[] | string; message: string }[]
): FieldErrors {
  const errors: FieldErrors = {}
  for (const issue of issues) {
    const key = Array.isArray(issue.path) ? issue.path.join(".") : String(issue.path)
    errors[key] ??= issue.message
  }
  return errors
}

export function validate<T extends z.ZodType>(
  schema: T,
  values: unknown
): { data: z.output<T>; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(values)
  return result.success
    ? { data: result.data, errors: null }
    : { data: null, errors: toFieldErrors(result.error.issues) }
}

/** A sentence to show above the form, or null when the error belongs to specific fields. */
export function formErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.issues.length > 0) return null
    if (error.status === 429) return "Too many attempts. Wait a minute, then try again."
    if (error.status >= 500) return "The server ran into a problem. Try again in a moment."
    return error.message
  }
  return "Can't reach the server. Check your connection and try again."
}
