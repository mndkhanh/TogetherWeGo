import { History, House, Landmark, LogOut, UserRound, type LucideIcon } from "lucide-react"
import * as React from "react"
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from "react-router"

import { StoolMark } from "@/components/stool"
import { Avatar, cx, Loading } from "@/components/ui"
import { AuthProvider, signOut, useAuth, useUser } from "@/lib/auth"
import { useMe } from "@/lib/me"
import { ActivityPage } from "@/pages/activity"
import { GroupPage } from "@/pages/group"
import { GroupsPage } from "@/pages/groups"
import { JoinPage, ShortJoinPage } from "@/pages/join"
import { PaymentSettingsPage } from "@/pages/payment-settings"
import { ProfilePage, ProfileSetup } from "@/pages/profile"
import { SepayGuidePage } from "@/pages/sepay-guide"
import { SepayPrompt, useSepayPrompt } from "@/pages/sepay-prompt"
import { SignInPage } from "@/pages/sign-in"

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<GroupsPage />} />
            <Route path="/g/:groupId" element={<GroupPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/j/:code" element={<ShortJoinPage />} />
            <Route path="/join/:groupId/:code" element={<JoinPage />} />
            <Route path="/settings/payments" element={<PaymentSettingsPage />} />
            <Route path="/settings/profile" element={<ProfilePage />} />
            <Route path="/help/sepay" element={<SepayGuidePage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

/** Signed-out visitors go to sign-in, and come back here afterwards. */
function RequireAuth() {
  const state = useAuth()
  const location = useLocation()
  if (state.status === "loading") return <Loading />
  if (state.status === "signed-out") {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/sign-in?next=${next}`} replace />
  }
  return <Shell />
}

function Shell() {
  const me = useMe()
  // Everyone sets a photo and display name before anything else; the page they were heading
  // to (an invite link, say) opens straight after.
  const settingUp = me.ready && !me.complete
  // Then, once: an encouraged (skippable) step to get paid back by bank.
  const sepay = useSepayPrompt()
  const askingSepay = me.ready && me.complete && sepay.show
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl lg:max-w-5xl xl:max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <StoolMark className="h-5 w-auto text-stool" />
            TogetherWeGo
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
            {!settingUp && !askingSepay && (
              <>
            <NavItem to="/" icon={House} label="Home" match={["/", "/g/", "/j/", "/join/"]} />
            <NavItem to="/activity" icon={History} label="Activity" match={["/activity"]} />
            <NavItem
              to="/settings/payments"
              icon={Landmark}
              label="Getting paid"
              match={["/settings/payments", "/help/"]}
            />
              </>
            )}
            <AccountMenu settingUp={settingUp} />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
        {!me.ready ? (
          <Loading />
        ) : settingUp ? (
          <ProfileSetup />
        ) : askingSepay ? (
          <SepayPrompt onDone={sepay.done} />
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  )
}

/**
 * Your avatar in the header opens a small menu: your profile and signing out. While you're
 * setting up your profile, only signing out.
 */
function AccountMenu({ settingUp }: { settingUp: boolean }) {
  const me = useMe()
  const user = useUser()
  const { pathname } = useLocation()
  const [open, setOpen] = React.useState(false)
  const box = React.useRef<HTMLDivElement>(null)
  const button = React.useRef<HTMLButtonElement>(null)

  // Closes on navigation, a click outside, or Escape (focus goes back to the avatar).
  React.useEffect(() => setOpen(false), [pathname])
  React.useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      setOpen(false)
      button.current?.focus()
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  const item =
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-brand-soft focus-visible:bg-brand-soft focus-visible:outline-none"

  return (
    <div ref={box} className="relative ml-1">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${me.name}`}
        title={me.name}
        onClick={() => setOpen(!open)}
        className={cx(
          "flex rounded-full ring-2 transition-shadow",
          open || pathname.startsWith("/settings/profile") ? "ring-brand" : "ring-transparent hover:ring-brand/40",
        )}
      >
        <Avatar name={me.name} uid={user.uid} photo={me.photo} />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className="absolute top-12 right-0 z-30 w-60 rounded-2xl bg-surface p-1.5 shadow-lg ring-1 ring-line"
        >
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={me.name} uid={user.uid} photo={me.photo} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.name}</p>
              <p className="truncate text-xs text-muted">{me.altName ?? user.email}</p>
            </div>
          </div>
          <div className="my-1 border-t border-line" />
          {!settingUp && (
            <Link
              role="menuitem"
              to="/settings/profile"
              onClick={() => setOpen(false)}
              className={item}
            >
              <UserRound className="size-4 text-muted" aria-hidden />
              Your profile
            </Link>
          )}
          <button role="menuitem" type="button" onClick={() => void signOut()} className={item}>
            <LogOut className="size-4 text-muted" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * A header link, marked as the current page while you're anywhere under it (Home covers your
 * groups and joining one). On phones only the icon shows, to keep the header on one line.
 */
function NavItem({
  to,
  icon: Icon,
  label,
  match,
}: {
  to: string
  icon: LucideIcon
  label: string
  match: string[]
}) {
  const { pathname } = useLocation()
  const current = match.some((m) => (m === "/" ? pathname === "/" : pathname.startsWith(m)))
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      title={label}
      className={cx(
        "inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition-colors",
        current ? "bg-brand-soft text-ink" : "text-muted hover:bg-brand-soft hover:text-ink",
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}
