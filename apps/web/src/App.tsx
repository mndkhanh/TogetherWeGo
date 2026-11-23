import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router"

import { Spinner } from "@/components/ui/spinner"
import { useAuth } from "@/lib/auth"
import { AuthCallbackPage } from "@/pages/auth-callback-page"
import { HomePage } from "@/pages/home-page"
import { LoginPage } from "@/pages/login-page"
import { RegisterPage } from "@/pages/register-page"

function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-label="Loading">
      <Spinner />
    </div>
  )
}

/** Only for signed-in users; everyone else goes to /login. */
function RequireAuth() {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === "loading") return <FullPageSpinner />
  if (state.status === "signed-out")
    return <Navigate to="/login" replace state={{ from: location }} />
  return <Outlet />
}

/** Sign-in pages bounce signed-in users to the app. */
function GuestOnly() {
  const { state } = useAuth()
  if (state.status === "loading") return <FullPageSpinner />
  if (state.status === "signed-in") return <Navigate to="/" replace />
  return <Outlet />
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route index element={<HomePage />} />
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
