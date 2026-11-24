import type { BalancesResponse } from "@twg/shared"
import { ArrowRightIcon } from "lucide-react"

import { PersonAvatar } from "@/components/member-avatars"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { money, useBalances } from "@/lib/expenses"
import { cn } from "@/lib/utils"

function headline(balances: BalancesResponse, myUserId: string): { title: string; tone: string } {
  const mine = balances.members.find((m) => m.userId === myUserId)?.net ?? 0
  if (mine > 0) {
    return { title: `You're owed ${money(mine, balances.currency)}`, tone: "text-primary" }
  }
  if (mine < 0) {
    return { title: `You owe ${money(-mine, balances.currency)}`, tone: "text-destructive" }
  }
  return { title: "You're settled up", tone: "" }
}

export function BalancesPanel({ groupId, myUserId }: { groupId: string; myUserId: string }) {
  const balances = useBalances(groupId)

  if (balances.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading balances">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (balances.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex items-center justify-between gap-4">
          Couldn't load the balances.
          <Button variant="outline" size="sm" onClick={() => void balances.refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const data = balances.data
  const names = new Map(data.members.map((m) => [m.userId, m]))
  const nameOf = (userId: string) =>
    userId === myUserId ? "You" : (names.get(userId)?.name ?? "Someone")
  const { title, tone } = headline(data, myUserId)
  const mine = data.transfers.filter((t) => t.fromUserId === myUserId || t.toUserId === myUserId)
  const others = data.transfers.filter((t) => !mine.includes(t))

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader>
          <CardTitle className={cn("text-2xl font-extrabold tracking-tight tabular-nums", tone)}>
            {title}
          </CardTitle>
          <CardDescription>
            {data.totalSpent > 0
              ? `${money(data.totalSpent, data.currency)} spent in this group so far.`
              : "Nothing spent in this group yet."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Suggested payments</h3>
          {data.transfers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody owes anybody. Nice.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {[...mine, ...others].map((t) => {
                const involvesMe = mine.includes(t)
                return (
                  <li
                    key={`${t.fromUserId}-${t.toUserId}`}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 text-sm",
                      !involvesMe && "text-muted-foreground"
                    )}
                  >
                    <span className={cn("truncate", involvesMe && "font-medium")}>
                      {nameOf(t.fromUserId)}
                    </span>
                    <ArrowRightIcon className="size-4 shrink-0" aria-label="pays" />
                    <span className={cn("min-w-0 flex-1 truncate", involvesMe && "font-medium")}>
                      {nameOf(t.toUserId)}
                    </span>
                    <span
                      className={cn("tabular-nums", involvesMe && "font-semibold text-foreground")}
                    >
                      {money(t.amount, data.currency)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-sm text-muted-foreground">
            The fewest transfers that settle everyone up. Pay each other however you usually do,
            then delete or adjust expenses if something was wrong.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Everyone's balance</CardTitle>
          <CardDescription>What each person paid, minus their share.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {data.members.map((member) => (
              <li key={member.userId} className="flex items-center gap-3 text-sm">
                <PersonAvatar person={member} size="sm" />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">
                    {member.userId === myUserId ? `${member.name} (you)` : member.name}
                  </span>
                  {!member.active && <Badge variant="outline">Left</Badge>}
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    member.net > 0 && "text-primary",
                    member.net < 0 && "text-destructive",
                    member.net === 0 && "text-muted-foreground"
                  )}
                >
                  {member.net > 0 ? "+" : member.net < 0 ? "−" : ""}
                  {money(Math.abs(member.net), data.currency)}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
