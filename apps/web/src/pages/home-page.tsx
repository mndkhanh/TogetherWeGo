import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { MeResponse, UpdateMeInput } from "@twg/shared"
import { LogOutIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Wordmark } from "@/components/wordmark"
import { api } from "@/lib/api"
import { meQueryKey, useAuth } from "@/lib/auth"

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function AccountMenu({ user }: { user: MeResponse }) {
  const { logout } = useAuth()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-lg" className="rounded-full" />}
        aria-label="Account menu"
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
          <DropdownMenuItem onClick={() => void logout()}>
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CurrencySetting({ user }: { user: MeResponse }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (input: UpdateMeInput) =>
      api<MeResponse>("/me", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (me) => {
      queryClient.setQueryData(meQueryKey, me)
      toast.success(`New expenses will default to ${me.defaultCurrency}`)
    },
    onError: () => toast.error("Couldn't save your currency. Try again."),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default currency</CardTitle>
        <CardDescription>Used when you add an expense. Each group can override it.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          variant="outline"
          value={[user.defaultCurrency]}
          disabled={update.isPending}
          onValueChange={(value: string[]) => {
            const next = value[0]
            if ((next === "VND" || next === "USD") && next !== user.defaultCurrency) {
              update.mutate({ defaultCurrency: next })
            }
          }}
        >
          <ToggleGroupItem value="VND">VND ₫</ToggleGroupItem>
          <ToggleGroupItem value="USD">USD $</ToggleGroupItem>
        </ToggleGroup>
      </CardContent>
    </Card>
  )
}

export function HomePage() {
  const { state } = useAuth()
  const me = useQuery({
    queryKey: meQueryKey,
    queryFn: () => api<MeResponse>("/me"),
    initialData: state.user ?? undefined,
  })
  const user = me.data
  if (!user) return null

  const firstName = user.name.split(/\s+/)[0] ?? user.name

  return (
    <div className="min-h-svh">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Wordmark />
          <AccountMenu user={user} />
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-10">
        <section className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Hi, {firstName}</h1>
          <p className="max-w-[60ch] text-muted-foreground">
            Your groups, hangouts and balances will show up here.
          </p>
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Empty className="border border-dashed bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No groups yet</EmptyTitle>
              <EmptyDescription>
                A group is where you plan hangouts and split costs with the same friends. Creating
                groups is the next thing we're building.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
          <CurrencySetting user={user} />
        </div>
      </main>
    </div>
  )
}
