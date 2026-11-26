import { BadgeCheck, QrCode, Wallet } from "lucide-react"
import * as React from "react"
import { Link, useLocation, useNavigate } from "react-router"

import { Button, Panel } from "@/components/ui"
import { useUser } from "@/lib/auth"
import { usePaymentAccount } from "@/lib/payments"

const askedKey = (uid: string) => `twg:sepay-asked:${uid}`

/**
 * Whether to show the "get paid by bank" step: once, after profile setup, for people who haven't
 * connected SePay yet. Not while they're following an invite (they join first, and see it the
 * next time), and not on the payment pages themselves.
 */
export function useSepayPrompt(): { show: boolean; done: () => void } {
  const user = useUser()
  const { pathname } = useLocation()
  const account = usePaymentAccount(user.uid)
  const [asked, setAsked] = React.useState(() => localStorage.getItem(askedKey(user.uid)) !== null)

  const done = React.useCallback(() => {
    localStorage.setItem(askedKey(user.uid), new Date().toISOString())
    setAsked(true)
  }, [user.uid])

  const inFlow = ["/j/", "/join/", "/settings/payments", "/help/"].some((p) => pathname.startsWith(p))
  const connected = account.data?.sepay != null
  return { show: !asked && !inFlow && account.data !== undefined && !connected, done }
}

/** The second setup step: encouraged, never required. */
export function SepayPrompt({ onDone }: { onDone: () => void }) {
  const navigate = useNavigate()
  const user = useUser()
  const account = usePaymentAccount(user.uid)
  const hasBank = Boolean(account.data)

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <p className="text-sm font-semibold text-brand">Step 2 of 2 · optional</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">Get paid back by bank</h1>
        <p className="mt-1 text-sm text-muted">
          Takes about 5 minutes, and saves chasing friends for money later.
        </p>
      </div>

      <Panel>
        <ul className="flex flex-col gap-4">
          <Benefit icon={QrCode} title="Friends pay you with a QR code">
            They scan it in their banking app. The amount and note are filled in for them.
          </Benefit>
          <Benefit icon={BadgeCheck} title="Payments tick themselves off">
            With SePay connected, a transfer that reaches your account marks the debt as paid. No
            screenshots, no checking.
          </Benefit>
          <Benefit icon={Wallet} title="Your money goes straight to you">
            TogetherWeGo never holds it. Only people who owe you see your account details.
          </Benefit>
        </ul>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            onClick={() => {
              onDone()
              navigate("/settings/payments")
            }}
          >
            {hasBank ? "Connect SePay" : "Set up now"}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">
          You can do it any time from{" "}
          <Link to="/settings/payments" onClick={onDone} className="font-medium text-brand">
            Getting paid
          </Link>
          . Need help? Read{" "}
          <Link to="/help/sepay" onClick={onDone} className="font-medium text-brand">
            how to connect SePay
          </Link>
          .
        </p>
      </Panel>
    </div>
  )
}

function Benefit({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof QrCode
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted">{children}</p>
      </div>
    </li>
  )
}
