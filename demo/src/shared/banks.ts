// Copied from main-app/packages/shared/src/payments (keep the two in step).
/**
 * Vietnamese banks that can receive a VietQR transfer, from SePay's list
 * (https://qr.sepay.vn/banks.json). `bin` is the stable NAPAS bank id we store.
 * `sepay` is true when SePay can watch the account and confirm payments automatically.
 */
export interface Bank {
  bin: string
  /** The short name SePay's QR service expects. */
  shortName: string
  /** What people call it. */
  name: string
  sepay: boolean
}

export const BANKS: readonly Bank[] = [
  { bin: "970436", shortName: "Vietcombank", name: "Vietcombank", sepay: true },
  { bin: "970415", shortName: "VietinBank", name: "VietinBank", sepay: true },
  { bin: "970418", shortName: "BIDV", name: "BIDV", sepay: true },
  { bin: "970405", shortName: "Agribank", name: "Agribank", sepay: true },
  { bin: "970407", shortName: "Techcombank", name: "Techcombank", sepay: true },
  { bin: "970422", shortName: "MBBank", name: "MB Bank", sepay: true },
  { bin: "970416", shortName: "ACB", name: "ACB", sepay: true },
  { bin: "970432", shortName: "VPBank", name: "VPBank", sepay: true },
  { bin: "970423", shortName: "TPBank", name: "TPBank", sepay: true },
  { bin: "970403", shortName: "Sacombank", name: "Sacombank", sepay: true },
  { bin: "970437", shortName: "HDBank", name: "HDBank", sepay: true },
  { bin: "970441", shortName: "VIB", name: "VIB", sepay: true },
  { bin: "970426", shortName: "MSB", name: "MSB", sepay: true },
  { bin: "970440", shortName: "SeABank", name: "SeABank", sepay: true },
  { bin: "970448", shortName: "OCB", name: "OCB", sepay: true },
  { bin: "970449", shortName: "LienVietPostBank", name: "LPBank", sepay: true },
  { bin: "970454", shortName: "VietCapitalBank", name: "BVBank", sepay: true },
  { bin: "970431", shortName: "Eximbank", name: "Eximbank", sepay: true },
  { bin: "970425", shortName: "ABBANK", name: "ABBANK", sepay: true },
  { bin: "970409", shortName: "BacABank", name: "Bac A Bank", sepay: true },
  { bin: "970452", shortName: "KienLongBank", name: "KienLongBank", sepay: true },
  { bin: "970424", shortName: "ShinhanBank", name: "Shinhan Bank", sepay: true },
  { bin: "970439", shortName: "PublicBank", name: "Public Bank", sepay: true },
  { bin: "970443", shortName: "SHB", name: "SHB", sepay: false },
  { bin: "970428", shortName: "NamABank", name: "Nam A Bank", sepay: false },
  { bin: "970412", shortName: "PVcomBank", name: "PVcomBank", sepay: false },
  { bin: "970419", shortName: "NCB", name: "NCB", sepay: false },
  { bin: "970408", shortName: "GPBank", name: "GPBank", sepay: false },
  { bin: "970430", shortName: "PGBank", name: "PGBank", sepay: false },
  { bin: "970438", shortName: "BaoVietBank", name: "BaoViet Bank", sepay: false },
  { bin: "970433", shortName: "VietBank", name: "VietBank", sepay: false },
  { bin: "970427", shortName: "VietABank", name: "VietABank", sepay: false },
  { bin: "970400", shortName: "SaigonBank", name: "Saigonbank", sepay: false },
  { bin: "970406", shortName: "DongABank", name: "Vikki", sepay: false },
  { bin: "970414", shortName: "Oceanbank", name: "MBV", sepay: false },
  { bin: "458761", shortName: "HSBC", name: "HSBC", sepay: false },
  { bin: "970410", shortName: "StandardChartered", name: "Standard Chartered", sepay: false },
  { bin: "970457", shortName: "Woori", name: "Woori Bank", sepay: false },
  { bin: "422589", shortName: "CIMB", name: "CIMB", sepay: false },
  { bin: "970458", shortName: "UnitedOverseas", name: "UOB", sepay: false },
] as const

const byBin = new Map(BANKS.map((bank) => [bank.bin, bank]))

export function bankByBin(bin: string): Bank | undefined {
  return byBin.get(bin)
}

/**
 * The SePay QR image for a transfer: any Vietnamese banking app can scan it and
 * fills in the account, the exact amount and the payment code.
 */
export function sepayQrUrl(input: {
  bin: string
  accountNumber: string
  amount: number
  description: string
}): string | null {
  const bank = bankByBin(input.bin)
  if (!bank) return null
  const params = new URLSearchParams({
    acc: input.accountNumber,
    bank: bank.shortName,
    amount: String(input.amount),
    des: input.description,
  })
  return `https://qr.sepay.vn/img?${params.toString()}`
}
