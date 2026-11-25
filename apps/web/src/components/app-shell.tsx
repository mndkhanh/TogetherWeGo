import { useQuery } from "@tanstack/react-query"
import type { MeResponse } from "@twg/shared"
import { BanknoteIcon, BellIcon, LanguagesIcon, LogOutIcon } from "lucide-react"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { Wordmark } from "@/components/wordmark"
import { api } from "@/lib/api"
import { meQueryKey, useAuth } from "@/lib/auth"
import { initials } from "@/lib/format"
import { useSetLocale } from "@/lib/locale"

/** The signed-in user. Only used under RequireAuth, so it's always available. */
export function useMe(): MeResponse {
  const { state } = useAuth()
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: () => api<MeResponse>("/me"),
    initialData: state.user ?? undefined,
  })
  if (!me.data) throw new Error("useMe() used outside a signed-in page")
  return me.data
}

function AccountMenu({ user }: { user: MeResponse }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const setLocale = useSetLocale()
  const other = user.locale === "vi" ? "en" : "vi"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-lg" className="rounded-full" />}
        aria-label={t("shell.accountMenu")}
      >
        <Avatar>
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <div className="truncate font-medium text-foreground">{user.name}</div>
            <div className="truncate font-normal">{user.email}</div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void navigate("/settings/payments")}>
            <BanknoteIcon />
            {t("shell.gettingPaid")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigate("/settings/notifications")}>
            <BellIcon />
            {t("shell.notificationSettings")}
          </DropdownMenuItem>
          {/* Each language named in itself, so it's findable whichever one is on screen. */}
          <DropdownMenuItem onClick={() => void setLocale(other)} lang={other}>
            <LanguagesIcon />
            {t(`language.${other}`)}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void logout()}>
            <LogOutIcon />
            {t("shell.signOut")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const user = useMe()
  return (
    <div className="min-h-svh">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AccountMenu user={user} />
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">{children}</main>
    </div>
  )
}
