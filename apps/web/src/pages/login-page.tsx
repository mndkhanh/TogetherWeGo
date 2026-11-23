import { loginSchema } from "@twg/shared"
import * as React from "react"
import { Link, useNavigate, useSearchParams } from "react-router"

import { AuthLayout } from "@/components/auth-layout"
import { GoogleSignIn } from "@/components/google-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"
import { ApiError } from "@/lib/api"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"

const REDIRECT_ERRORS: Record<string, string> = {
  account_exists: "This email already has a password account. Sign in with your password instead.",
  google_state: "Google sign-in didn't finish. Try again.",
  google_failed: "Google sign-in didn't finish. Try again.",
}

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(
    REDIRECT_ERRORS[params.get("error") ?? ""] ?? null
  )
  const [pending, setPending] = React.useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { data, errors } = validate(loginSchema, Object.fromEntries(form))
    setFieldErrors(errors ?? {})
    setFormError(null)
    if (!data) return

    setPending(true)
    try {
      await login(data)
      navigate("/", { replace: true })
    } catch (error) {
      if (error instanceof ApiError) setFieldErrors(toFieldErrors(error.issues))
      setFormError(formErrorMessage(error))
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Sign in</h2>
          <p className="text-muted-foreground">
            New here?{" "}
            <Link
              to="/register"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!fieldErrors.email || undefined}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={!!fieldErrors.email || undefined}
                autoFocus
              />
              <FieldError>{fieldErrors.email}</FieldError>
            </Field>
            <Field data-invalid={!!fieldErrors.password || undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!fieldErrors.password || undefined}
              />
              <FieldError>{fieldErrors.password}</FieldError>
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Sign in
            </Button>
            <GoogleSignIn label="Sign in with Google" />
          </FieldGroup>
        </form>
      </div>
    </AuthLayout>
  )
}
