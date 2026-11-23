import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { GroupSummaryResponse, MeResponse, UpdateMeInput } from "@twg/shared"
import { ChevronRightIcon, UsersIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { CreateGroupDialog } from "@/components/create-group-dialog"
import { CurrencyToggle } from "@/components/currency-toggle"
import { MemberAvatars } from "@/components/member-avatars"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { api } from "@/lib/api"
import { meQueryKey } from "@/lib/auth"
import { ROLE_LABEL } from "@/lib/format"
import { useGroups } from "@/lib/groups"

function CurrencySetting({ user }: { user: MeResponse }) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (input: UpdateMeInput) =>
      api<MeResponse>("/me", { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (me) => {
      queryClient.setQueryData(meQueryKey, me)
      toast.success(`New groups will default to ${me.defaultCurrency}`)
    },
    onError: () => toast.error("Couldn't save your currency. Try again."),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default currency</CardTitle>
        <CardDescription>Pre-selected when you create a group.</CardDescription>
      </CardHeader>
      <CardContent>
        <CurrencyToggle
          value={user.defaultCurrency}
          disabled={update.isPending}
          onChange={(currency) => update.mutate({ defaultCurrency: currency })}
        />
      </CardContent>
    </Card>
  )
}

function GroupRow({ group }: { group: GroupSummaryResponse }) {
  return (
    <Link
      to={`/groups/${group.id}`}
      className="group/row flex items-center gap-4 rounded-lg px-3 py-3 outline-offset-2 transition-colors hover:bg-muted"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold">{group.name}</span>
          {group.myRole !== "member" && (
            <Badge variant="secondary">{ROLE_LABEL[group.myRole]}</Badge>
          )}
          {group.archivedAt && <Badge variant="outline">Archived</Badge>}
        </div>
        <span className="text-sm text-muted-foreground">
          {group.memberCount === 1 ? "Just you so far" : `${group.memberCount} members`}, in{" "}
          {group.currency}
        </span>
      </div>
      <MemberAvatars people={group.memberPreview} total={group.memberCount} />
      <ChevronRightIcon className="text-muted-foreground" aria-hidden />
    </Link>
  )
}

function GroupList({ defaultCurrency }: { defaultCurrency: MeResponse["defaultCurrency"] }) {
  const groups = useGroups()

  if (groups.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading groups">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }

  if (groups.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          Couldn't load your groups.
          <Button variant="outline" size="sm" onClick={() => void groups.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (groups.data.length === 0) {
    return (
      <Empty className="border border-dashed bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>No groups yet</EmptyTitle>
          <EmptyDescription>
            Make a group for the friends you hang out with, then share the invite link with them.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <CreateGroupDialog defaultCurrency={defaultCurrency} />
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <Card>
      <CardContent className="flex flex-col">
        {groups.data.map((group, index) => (
          <React.Fragment key={group.id}>
            {index > 0 && <Separator />}
            <GroupRow group={group} />
          </React.Fragment>
        ))}
      </CardContent>
    </Card>
  )
}

export function HomePage() {
  const user = useMe()
  const groups = useGroups()
  const firstName = user.name.split(/\s+/)[0] ?? user.name
  const hasGroups = (groups.data?.length ?? 0) > 0

  return (
    <AppShell>
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Hi, {firstName}</h1>
          <p className="max-w-[60ch] text-muted-foreground">
            {hasGroups ? "Your groups" : "Start by making a group for your friends."}
          </p>
        </div>
        {hasGroups && <CreateGroupDialog defaultCurrency={user.defaultCurrency} />}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <GroupList defaultCurrency={user.defaultCurrency} />
        <CurrencySetting user={user} />
      </div>
    </AppShell>
  )
}
