import type { MeResponse, NotificationPreferenceResponse } from "@twg/shared"
import { ArrowLeftIcon } from "lucide-react"
import * as React from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router"
import { toast } from "sonner"

import { AppShell, useMe } from "@/components/app-shell"
import { LanguageSwitch } from "@/components/language-switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { deviceTimeZone } from "@/i18n"
import { formErrorMessage } from "@/lib/form-errors"
import { useUpdateMe } from "@/lib/locale"
import { useNotificationPreferences, useSaveNotificationPreferences } from "@/lib/notifications"

/** "Asia/Ho_Chi_Minh" → "Asia/Ho Chi Minh". */
function zoneName(zone: string): string {
  return zone.replaceAll("_", " ")
}

function RegionCard({ me }: { me: MeResponse }) {
  const { t } = useTranslation()
  const updateMe = useUpdateMe()
  const [saving, setSaving] = React.useState(false)
  const device = deviceTimeZone()

  async function adoptDeviceZone() {
    setSaving(true)
    try {
      await updateMe({ timeZone: device })
      toast.success(t("notificationSettings.timeZoneSaved", { zone: zoneName(device) }))
    } catch (error) {
      toast.error(formErrorMessage(error) ?? t("errors.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t("notificationSettings.regionTitle")}</CardTitle>
        <CardDescription>{t("notificationSettings.regionHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("notificationSettings.language")}</FieldLabel>
            <LanguageSwitch className="w-fit" />
          </Field>
          <Field>
            <FieldLabel>{t("notificationSettings.timeZone")}</FieldLabel>
            <FieldDescription>
              {t("notificationSettings.timeZoneHint", { zone: zoneName(me.timeZone) })}
            </FieldDescription>
            {device !== me.timeZone && (
              <Button
                variant="outline"
                className="w-fit"
                disabled={saving}
                onClick={() => void adoptDeviceZone()}
              >
                {saving && <Spinner data-icon="inline-start" />}
                {t("notificationSettings.useDevice", { zone: zoneName(device) })}
              </Button>
            )}
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function PreferenceRow({ pref }: { pref: NotificationPreferenceResponse }) {
  const { t } = useTranslation()
  const save = useSaveNotificationPreferences()
  // e.g. "notificationTypes.expense.added.label": the type's own dot nests the key.
  const label = t(`notificationTypes.${pref.type}.label`)

  function change(patch: Partial<Pick<NotificationPreferenceResponse, "inApp" | "email">>) {
    const next = { type: pref.type, inApp: pref.inApp, email: pref.email, ...patch }
    save.mutate(
      { preferences: [next] },
      { onError: (err) => toast.error(formErrorMessage(err) ?? t("errors.saveFailed")) }
    )
  }

  const id = pref.type.replace(".", "-")
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">
          {t(`notificationTypes.${pref.type}.audience`)}
        </span>
      </th>
      <td className="px-2 py-3 text-center">
        <Switch
          id={`${id}-app`}
          checked={pref.inApp}
          disabled={save.isPending}
          onCheckedChange={(inApp) => change({ inApp })}
          aria-label={t("notificationSettings.inAppAria", { label })}
        />
      </td>
      <td className="py-3 pl-2 text-center">
        <Switch
          id={`${id}-email`}
          checked={pref.email}
          disabled={save.isPending}
          onCheckedChange={(email) => change({ email })}
          aria-label={t("notificationSettings.emailAria", { label })}
        />
      </td>
    </tr>
  )
}

export function NotificationSettingsPage() {
  const { t } = useTranslation()
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
          {t("notifications.title")}
        </Button>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          {t("notificationSettings.heading")}
        </h1>
        <p className="max-w-prose text-muted-foreground">
          {t("notificationSettings.intro", { email: me.email })}
        </p>
      </section>

      <RegionCard me={me} />

      {prefs.isPending ? (
        <Skeleton className="h-96" />
      ) : prefs.isError ? (
        <Alert variant="destructive">
          <AlertDescription>
            {formErrorMessage(prefs.error) ?? t("notificationSettings.loadFailed")}
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>{t("notificationSettings.card")}</CardTitle>
            <CardDescription>{t("notificationSettings.cardHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="pb-2 text-left font-medium">
                    <span className="sr-only">{t("notificationSettings.type")}</span>
                  </th>
                  <th scope="col" className="w-20 px-2 pb-2 font-medium">
                    {t("notificationSettings.inApp")}
                  </th>
                  <th scope="col" className="w-20 pb-2 pl-2 font-medium">
                    {t("notificationSettings.email")}
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
