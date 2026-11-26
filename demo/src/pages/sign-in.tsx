import * as React from "react"
import { Navigate, useSearchParams } from "react-router"

import { StoolCircle, StoolMark } from "@/components/stool"
import { Button, ErrorText, Field, Input, useAction } from "@/components/ui"
import { authErrorMessage, signIn, signInWithGoogle, signUp, useAuth } from "@/lib/auth"

/** Only paths inside this app, so a crafted link can't send people elsewhere after sign-in. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")
    ? value
    : "/"
}

export function SignInPage() {
  const state = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get("next"))
  const invited = next.startsWith("/j/") || next.startsWith("/join/")
  const [mode, setMode] = React.useState<"sign-in" | "sign-up">(invited ? "sign-up" : "sign-in")
  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const { busy, error, run, setError } = useAction()

  if (state.status === "signed-in") return <Navigate to={next} replace />

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === "sign-up" && !name.trim())
      return setError("Enter the name your friends know you by.")
    void run(async () => {
      if (mode === "sign-in") return signIn(email, password)
      await signUp(name, email, password)
    }, authErrorMessage)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="flex flex-col justify-between gap-8 bg-marigold px-6 pt-6 text-ink sm:px-10 sm:pt-8 lg:px-14 lg:pt-12">
        <p className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <StoolMark className="h-5 w-auto text-stool" />
          TogetherWeGo
        </p>
        <div>
          <h1 className="max-w-[14ch] text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl">
            {invited ? "Your friends saved you a stool." : "Pull up a stool."}
          </h1>
          <p className="mt-4 max-w-[42ch] text-base text-ink/75">
            {invited
              ? "Sign in to join the group and see what's planned."
              : "Make a group, add what everyone paid, and see who owes whom. Plan the next hangout in the same place."}
          </p>
        </div>
        <StoolCircle className="h-auto w-full max-w-md" />
      </aside>

      <main className="flex items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-extrabold tracking-tight">
            {mode === "sign-up" ? "Create your account" : "Sign in"}
          </h2>

          <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
            {mode === "sign-up" && (
              <>
                <Field label="Display name" hint="What your groups see.">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="nickname"
                    maxLength={60}
                    required
                  />
                </Field>
              </>
            )}
            <Field label="Email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Field
              label="Password"
              hint={mode === "sign-up" ? "At least 6 characters." : undefined}
            >
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
                required
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <Button type="submit" disabled={busy}>
              {mode === "sign-up" ? "Create account" : "Sign in"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(signInWithGoogle, authErrorMessage)}
            >
              Continue with Google
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">
            {mode === "sign-in" ? "New here? " : "Already have an account? "}
            <button
              type="button"
              className="font-semibold text-brand underline-offset-4 hover:underline"
              onClick={() => {
                setMode(mode === "sign-in" ? "sign-up" : "sign-in")
                setError(null)
              }}
            >
              {mode === "sign-in" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
