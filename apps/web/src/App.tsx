import * as React from "react"
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router"

import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"
import { useRealtime } from "@/lib/notifications"
import { clearReturnTo, peekReturnTo, rememberReturnTo } from "@/lib/return-to"
import { AuthCallbackPage } from "@/pages/auth-callback-page"
import { EventPage } from "@/pages/event-page"
import { GroupPage } from "@/pages/group-page"
import { HomePage } from "@/pages/home-page"
import { InvitePage } from "@/pages/invite-page"
import { LoginPage } from "@/pages/login-page"
import { NotificationSettingsPage } from "@/pages/notification-settings-page"
import { NotificationsPage } from "@/pages/notifications-page"
import { PaymentSettingsPage } from "@/pages/payment-settings-page"
import { RegisterPage } from "@/pages/register-page"

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-label="Loading">
      <Spinner />
    </div>
  )
}

/** Only for signed-in users; everyone else goes to /login and comes back here afterwards. */
function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  const signedIn = state.status === "signed-in"
  // One live connection for the whole signed-in session (this layout stays mounted).
  useRealtime(signedIn)

  React.useEffect(() => {
    if (signedIn) clearReturnTo()
  }, [signedIn])

  if (state.status === "loading") return <FullPageSpinner />
  if (state.status === "signed-out") {
    rememberReturnTo(location.pathname + location.search)
    return <Navigate to="/login" replace />
  }
  return <Outlet />
}

/** Sign-in pages send signed-in users on to where they were going. */
function GuestOnly() {
  const { state } = useAuth()
  if (state.status === "loading") return <FullPageSpinner />
  if (state.status === "signed-in") return <Navigate to={peekReturnTo()} replace />
  return <Outlet />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route index element={<HomePage />} />
          <Route path="groups/:groupId" element={<GroupPage />} />
          <Route path="groups/:groupId/events/:eventId" element={<EventPage />} />
          <Route path="invite/:code" element={<InvitePage />} />
          <Route path="settings/payments" element={<PaymentSettingsPage />} />
          <Route path="settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
        </Route>
        <Route element={<GuestOnly />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="register" element={<RegisterPage />} />
        </Route>
        <Route path="auth/callback" element={<AuthCallbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
