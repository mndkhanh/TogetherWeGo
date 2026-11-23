import { registerSchema } from "@twg/shared"
import * as React from "react"
import { Link } from "react-router"

import { AuthLayout } from "@/components/auth-layout"
import { GoogleSignIn } from "@/components/google-button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { type FieldErrors, formErrorMessage, toFieldErrors, validate } from "@/lib/form-errors"

export function RegisterPage() {
  const { register } = useAuth()
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const { data, errors } = validate(registerSchema, Object.fromEntries(form))
    setFieldErrors(errors ?? {})
    setFormError(null)
    if (!data) return

    setPending(true)
    try {
      await register(data)
      // GuestOnly redirects to the page the user was heading to.
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
          <h2 className="text-2xl font-bold tracking-tight">Create an account</h2>
          <p className="text-muted-foreground">
            Already have one?{" "}
            <Link
              to="/login"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Sign in
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
            <Field data-invalid={!!fieldErrors.name || undefined}>
              <FieldLabel htmlFor="name">Your name</FieldLabel>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                aria-invalid={!!fieldErrors.name || undefined}
                autoFocus
              />
              <FieldDescription>This is what your friends see in groups.</FieldDescription>
              <FieldError>{fieldErrors.name}</FieldError>
            </Field>
            <Field data-invalid={!!fieldErrors.email || undefined}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={!!fieldErrors.email || undefined}
              />
              <FieldError>{fieldErrors.email}</FieldError>
            </Field>
            <Field data-invalid={!!fieldErrors.password || undefined}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!fieldErrors.password || undefined}
              />
              <FieldDescription>At least 10 characters.</FieldDescription>
              <FieldError>{fieldErrors.password}</FieldError>
            </Field>
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Create account
            </Button>
            <GoogleSignIn label="Sign up with Google" />
          </FieldGroup>
        </form>
      </div>
    </AuthLayout>
  )
}
