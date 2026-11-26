import { ArrowLeft } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"

import paymentCodeShot from "@/assets/sepay-payment-code.png"
import webhookBasic from "@/assets/sepay-webhook-1.png"
import webhookAccount from "@/assets/sepay-webhook-2.png"
import webhookSecurity from "@/assets/sepay-webhook-3.png"
import webhookAlerts from "@/assets/sepay-webhook-4.png"
import { Panel, cx } from "@/components/ui"
import { sepayWebhookUrl } from "@/lib/payments"

/** The four tabs of SePay's “Thêm Webhook” form, cropped and marked (account number hidden). */
const webhookShots = [
  { src: webhookBasic, width: 703, height: 580 },
  { src: webhookAccount, width: 697, height: 715 },
  { src: webhookSecurity, width: 699, height: 530 },
  { src: webhookAlerts, width: 701, height: 180 },
] as const

/** How to connect SePay. Its dashboard is in Vietnamese, so its labels are quoted as shown. */
export function SepayGuidePage() {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link
          to="/settings/payments"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Getting paid
        </Link>
        <h1 className="mt-3 text-2xl font-extrabold tracking-tight">Connect SePay</h1>
        <p className="mt-1 text-sm text-muted">
          Transfers to you get marked as paid automatically. About 10 minutes, once. You need a{" "}
          <a
            href="https://my.sepay.vn"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-brand"
          >
            SePay account
          </a>{" "}
          with your bank linked.
        </p>
      </div>

      <Step n={1} title="Set the payment code in SePay">
        <p className="text-muted">
          “Cấu hình” → “Cấu hình chung” → “Thêm mẫu mã mới”, then “Lưu lại”. Delete any empty
          template you added by mistake.
        </p>
        <figure className="max-w-[891px]">
          <a href={paymentCodeShot} target="_blank" rel="noreferrer">
            <img
              src={paymentCodeShot}
              width={891}
              height={849}
              loading="lazy"
              alt="SePay's general settings, with the four fields to set marked 1 to 4."
              className="h-auto w-full rounded-xl ring-1 ring-line"
            />
          </a>
        </figure>
        <ol className="grid gap-3 sm:grid-cols-2">
          <Marker n={1} name="Nhận diện mã thanh toán">
            Bật
          </Marker>
          <Marker n={2} name="Tiền tố">
            <Code>TWG</Code> exactly (not TGW)
          </Marker>
          <Marker n={3} name="Hậu tố">
            Từ 8 đến 8 ký tự
          </Marker>
          <Marker n={4} name="Là">
            Số và chữ (not “Số nguyên”)
          </Marker>
        </ol>
      </Step>

      <Step n={2} title="Make your key">
        <p className="text-muted">
          On{" "}
          <Link to="/settings/payments" className="font-semibold text-brand">
            Getting paid
          </Link>
          , tap <strong>Set up SePay</strong>. Keep that page open: the key is shown only once.
        </p>
      </Step>

      <Step n={3} title="Add the webhook in SePay">
        <p className="text-muted">
          “Tích hợp WebHooks” → “Tạo webhook”. The form has four tabs; set these and press “Tiếp
          theo” after each.
        </p>

        <Tab name="Cơ bản" shot={webhookShots[0]} alt="The Cơ bản tab, with five fields marked.">
          <Marker n={1} name="Tên webhook">
            Any name, e.g. Xác thực chuyển khoản
          </Marker>
          <Marker n={2} name="URL nhận webhook">
            <Code long>{sepayWebhookUrl()}</Code>
          </Marker>
          <Marker n={3} name="Loại giao dịch">
            Tiền vào
          </Marker>
          <Marker n={4} name="Định dạng dữ liệu">
            JSON
          </Marker>
          <Marker n={5} name="Tự động gửi lại khi server trả lỗi">
            Turn on (safe: a transfer is never counted twice)
          </Marker>
        </Tab>

        <Tab
          name="Tài khoản"
          shot={webhookShots[1]}
          alt="The Tài khoản tab, with four settings marked. The account number is hidden."
        >
          <Marker n={1} name="Tài khoản ngân hàng">
            Tuỳ chọn → the account you get paid into
          </Marker>
          <Marker n={2} name="Dùng để xác thực thanh toán">
            On
          </Marker>
          <Marker n={3} name="Chỉ gửi khi có mã thanh toán">
            On
          </Marker>
          <Marker n={4} name="Lọc theo mã thanh toán">
            Only <Code>TWG</Code>, spelled exactly (not TGW); remove any others like <Code>DH</Code>
          </Marker>
        </Tab>

        <Tab name="Bảo mật" shot={webhookShots[2]} alt="The Bảo mật tab, with API Key chosen.">
          <Marker n={1} name="Phương thức xác thực">
            API Key
          </Marker>
          <Marker n={2} name="API Key">
            Paste your key from step 2
          </Marker>
        </Tab>

        <Tab name="Cảnh báo" shot={webhookShots[3]} alt="The Cảnh báo tab, with its one switch.">
          <Marker n={1} name="Bật cảnh báo khi webhook gặp lỗi liên tiếp">
            Turn on, so SePay tells you if it stops working
          </Marker>
        </Tab>

        <p className="text-muted">Then press “Thêm”.</p>
      </Step>

      <Step n={4} title="Test it">
        <p className="text-muted">
          Have a friend pay you a few thousand dong by QR. Marked paid within a minute? Done. Still
          pending? Recheck step 1.
        </p>
      </Step>

      <Panel title="Who does what">
        <div className="grid gap-4 sm:grid-cols-2">
          <Duties
            title="TogetherWeGo"
            items={[
              "A payment code in every QR",
              "Your webhook URL and key",
              "Matching transfers, never twice",
              "Never holds your money",
            ]}
          />
          <Duties
            title="You"
            items={[
              "Your SePay account and plan",
              "The settings in steps 1 and 3",
              "Keeping the key private",
              "Confirming transfers with no code",
            ]}
          />
        </div>
      </Panel>

      <Panel title="Good to know">
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          <li>
            We only get transfers with a <Code>TWG</Code> code. Never your balance or other
            transactions.
          </li>
          <li>We store a fingerprint of your key, not the key.</li>
          <li>
            SePay's free plan: 50 incoming transfers a month, counting all of them.{" "}
            <a
              href="https://sepay.vn"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-brand"
            >
              Prices
            </a>
          </li>
          <li>
            To stop: <strong>Turn off</strong> on Getting paid, or delete the webhook in SePay.
          </li>
        </ul>
      </Panel>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`step-${n}`}
      className="flex gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line"
    >
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
        <h2 id={`step-${n}`} className="pt-1 text-base font-bold">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {children}
      </div>
    </section>
  )
}

/** One tab of SePay's webhook form: its screenshot beside the values to set. */
function Tab({
  name,
  shot,
  alt,
  children,
}: {
  name: string
  shot: { src: string; width: number; height: number }
  alt: string
  children: ReactNode
}) {
  return (
    <div className="grid items-start gap-4 rounded-xl bg-canvas p-4 ring-1 ring-line lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <a href={shot.src} target="_blank" rel="noreferrer">
        <img
          src={shot.src}
          width={shot.width}
          height={shot.height}
          loading="lazy"
          alt={alt}
          className="h-auto w-full rounded-lg ring-1 ring-line"
        />
      </a>
      <div className="flex flex-col gap-3">
        <h3 className="font-bold">“{name}”</h3>
        <ol className="flex flex-col gap-3">{children}</ol>
      </div>
    </div>
  )
}

function Duties({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl bg-canvas p-4 ring-1 ring-line">
      <h3 className="text-sm font-bold">{title}</h3>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** One field in the screenshot, numbered like the red marker drawn on it. */
function Marker({ n, name, children }: { n: number; name: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white"
      >
        {n}
      </span>
      <p className="min-w-0 pt-0.5">
        <span className="sr-only">{n}. </span>
        <span className="text-muted">{name}:</span> <span className="font-medium">{children}</span>
      </p>
    </li>
  )
}

/** Short codes stay on one line; a long one (the webhook URL) may break anywhere. */
function Code({ children, long = false }: { children: ReactNode; long?: boolean }) {
  return (
    <code
      className={cx(
        "rounded bg-marigold-soft/70 px-1.5 py-0.5 font-mono text-[0.8125rem]",
        long ? "break-all" : "whitespace-nowrap",
      )}
    >
      {children}
    </code>
  )
}
