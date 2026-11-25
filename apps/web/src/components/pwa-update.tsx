import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useRegisterSW } from "virtual:pwa-register/react"

const CHECK_EVERY_MS = 60 * 60 * 1000

/**
 * Registers the service worker and, when a new version of the app has downloaded, offers a
 * reload instead of swapping it in underneath someone mid-task.
 */
export function PwaUpdate() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Long-lived tabs (an installed app can stay open for days) still pick up new versions.
      if (registration) setInterval(() => void registration.update(), CHECK_EVERY_MS)
    },
  })

  useEffect(() => {
    if (!needRefresh) return
    toast(t("pwa.updateReady"), {
      id: "pwa-update",
      duration: Infinity,
      action: { label: t("pwa.reload"), onClick: () => void updateServiceWorker(true) },
    })
  }, [needRefresh, updateServiceWorker, t])

  return null
}
