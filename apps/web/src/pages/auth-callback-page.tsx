import * as React from "react"
import { useNavigate } from "react-router"

import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"
import { peekReturnTo } from "@/lib/return-to"

/** Landing page after Google sign-in: the server has set the refresh cookie, so restore the session. */
export function AuthCallbackPage() {
  const { restore } = useAuth()
  const navigate = useNavigate()

  React.useEffect(() => {
    void restore().then((ok) =>
      navigate(ok ? peekReturnTo() : "/login?error=google_failed", { replace: true })
    )
  }, [restore, navigate])

  return (
    <div className="flex min-h-svh items-center justify-center gap-3 text-muted-foreground">
      <Spinner />
      Signing you in
    </div>
  )
}
