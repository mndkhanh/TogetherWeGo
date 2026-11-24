import type { NotificationPreferenceResponse } from "@twg/shared"
import { ArrowLeftIcon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { formErrorMessage } from "@/lib/form-errors"
import { useNotificationPreferences, useSaveNotificationPreferences } from "@/lib/notifications"

function PreferenceRow({ pref }: { pref: NotificationPreferenceResponse }) {
  const save = useSaveNotificationPreferences()

  function change(patch: Partial<Pick<NotificationPreferenceResponse, "inApp" | "email">>) {
    const next = { type: pref.type, inApp: pref.inApp, email: pref.email, ...patch }
    save.mutate(
      { preferences: [next] },
      { onError: (err) => toast.error(formErrorMessage(err) ?? "Couldn't save that. Try again.") }
    )
  }

  const id = pref.type.replace(".", "-")
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className="block font-medium">{pref.label}</span>
        <span className="block text-sm text-muted-foreground">{pref.audience}</span>
      </th>
      <td className="px-2 py-3 text-center">
        <Switch
          id={`${id}-app`}
          checked={pref.inApp}
          disabled={save.isPending}
          onCheckedChange={(inApp) => change({ inApp })}
          aria-label={`${pref.label} in the app`}
        />
      </td>
      <td className="py-3 pl-2 text-center">
        <Switch
          id={`${id}-email`}
          checked={pref.email}
          disabled={save.isPending}
          onCheckedChange={(email) => change({ email })}
          aria-label={`${pref.label} by email`}
        />
      </td>
    </tr>
  )
}

export function NotificationSettingsPage() {
  const me = useMe()
  const prefs = useNotificationPreferences()

  return (
    <AppShell>
      <section className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          nativeButton={false}
          render={<Link to="/notifications" />}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Notifications
        </Button>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">What you hear about</h1>
        <p className="max-w-prose text-muted-foreground">
          Choose what shows up in the app and what’s also emailed to {me.email}. Changes save as you
          go.
        </p>
      </section>

      {prefs.isPending ? (
        <Skeleton className="h-96" />
      ) : prefs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {formErrorMessage(prefs.error) ?? "Couldn't load your settings."}
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Notifications</CardTitle>
            <CardDescription>You never hear about things you did yourself.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="pb-2 text-left font-medium">
                    <span className="sr-only">Type</span>
                  </th>
                  <th scope="col" className="w-20 px-2 pb-2 font-medium">
                    In app
                  </th>
                  <th scope="col" className="w-20 pb-2 pl-2 font-medium">
                    Email
                  </th>
                </tr>
              </thead>
              <tbody>
                {prefs.data.map((pref) => (
                  <PreferenceRow key={pref.type} pref={pref} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </AppShell>
  )
}
