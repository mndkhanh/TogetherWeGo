// Shared by the web app and the Cloud Functions (functions/src/index.ts): keep it dependency-free.
/** Money in the demo is whole Vietnamese dong (no fractions), stored as integers. */

const vnd = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" })

export function formatVnd(amount: number): string {
  return vnd.format(amount)
}

/** Shorthand people type for amounts: thousands, and millions ("m", or "tr" for triệu). */
const UNITS: [suffix: string, scale: number, number: RegExp][] = [
  ["k", 1_000, /^\d+(\.\d{1,3})?$/],
  ["m", 1_000_000, /^\d+(\.\d{1,6})?$/],
  ["tr", 1_000_000, /^\d+(\.\d{1,6})?$/],
]

/**
 * Millions, then thousands, then dong, each written once: "1m250k", "2tr500k", "1m250k500".
 * Digits after the last unit carry on from it, the way people write it in Vietnam: "1tr2" is
 * 1.200.000, "1tr250" 1.250.000, "3k5" 3.500 (like 1.2m and 3.5k). Each part must fit under the
 * unit above it, so "1m2500k" is a typo, not 3.5m.
 */
const COMPOUND = /^(?:(\d+)(?:m|tr))?(?:(\d+)k)?(\d+)?$/

/** "5" after a unit worth 1000 is 500; after a million, 500.000. At most as many digits as the unit has zeros. */
function tail(digits: string, zeros: number): number | null {
  return digits.length > zeros ? null : Number(digits.padEnd(zeros, "0"))
}

function parseCompound(s: string): number | null {
  const match = COMPOUND.exec(s)
  if (!match) return null
  const [, m, k, rest] = match
  // At least two parts; one part alone ("5m", "250k") is handled with its decimals elsewhere.
  if ([m, k, rest].filter((part) => part !== undefined).length < 2) return null
  if (m !== undefined && k !== undefined && Number(k) >= 1000) return null
  // Digits at the end continue the unit just before them: thousands, or millions.
  const last = rest === undefined ? 0 : tail(rest, k !== undefined ? 3 : 6)
  if (last === null) return null
  return Number(m ?? 0) * 1_000_000 + Number(k ?? 0) * 1000 + last
}

/**
 * "150.000", "150000" or "150k" => 150000, "1.5k" => 1500, "1m" or "1tr" => 1000000,
 * "2.5m" => 2500000, "1m250k" => 1250000, "1tr2" => 1200000, "3k5" => 3500. Dots and commas group thousands,
 * except before a unit where one of them is a decimal point. Null unless it's a positive whole
 * number of dong.
 */
export function parseVnd(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/\s/g, "")
  const unit = UNITS.find(([suffix]) => s.endsWith(suffix))
  const compound = parseCompound(s)
  let value: number
  if (compound !== null) {
    value = compound
  } else if (unit) {
    const [suffix, scale, number] = unit
    const n = s.slice(0, -suffix.length).replace(",", ".")
    if (!number.test(n)) return null
    value = Math.round(Number(n) * scale)
  } else {
    if (!/^\d{1,3}([.,]?\d{3})*$/.test(s)) return null
    value = Number(s.replace(/[.,]/g, ""))
  }
  return Number.isSafeInteger(value) && value > 0 && value <= 10_000_000_000 ? value : null
}

/**
 * Splits an amount equally, to the dong: everyone gets the same, and the last people in the
 * list get 1 dong more each to cover what doesn't divide (1.000.000 ÷ 3 = 333.333, 333.333,
 * 333.334). The list order is the one saved with the expense, so every client agrees.
 */
export function splitEqually(amount: number, participants: string[]): Map<string, number> {
  const people = [...new Set(participants)]
  const shares = new Map<string, number>()
  if (people.length === 0) return shares
  const base = Math.floor(amount / people.length)
  const extra = amount - base * people.length
  people.forEach((p, i) => shares.set(p, base + (i >= people.length - extra ? 1 : 0)))
  return shares
}

/**
 * How an expense is shared. "equal" has no weights. "shares" stores each person's share in
 * halves (1.5 shares = 3). "amounts" stores each person's exact dong, adding up to the bill.
 */
export type SplitKind = "equal" | "shares" | "amounts"

export interface ExpenseLike {
  amount: number
  paidBy: string
  participants: string[]
  /** One positive whole number per participant, same order; none means split equally. */
  weights?: number[] | null
}

/**
 * Splits an amount in proportion to weights (amount × weight ÷ total weight). The dong left
 * over from rounding go to the biggest remainders (ties to the later person in the list, as with
 * equal splits), so the shares always add up to the amount and every client gets the same answer.
 */
export function splitByWeights(
  amount: number,
  participants: string[],
  weights: number[],
): Map<string, number> {
  const valid =
    weights.length === participants.length &&
    new Set(participants).size === participants.length &&
    weights.every((w) => Number.isSafeInteger(w) && w > 0)
  if (!valid) return splitEqually(amount, participants)

  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n)
  const rows = participants.map((p, i) => {
    const scaled = BigInt(amount) * BigInt(weights[i] ?? 0)
    return { p, i, base: Number(scaled / total), rem: scaled % total }
  })
  let left = amount - rows.reduce((sum, r) => sum + r.base, 0)
  const extra = new Set<number>()
  for (const r of [...rows].sort((a, b) =>
    a.rem === b.rem ? b.i - a.i : a.rem > b.rem ? -1 : 1,
  )) {
    if (left-- <= 0) break
    extra.add(r.i)
  }
  // Same order as the participants.
  return new Map(rows.map((r) => [r.p, r.base + (extra.has(r.i) ? 1 : 0)]))
}

/** What each participant owes for an expense. */
export function expenseShares(e: ExpenseLike): Map<string, number> {
  return e.weights
    ? splitByWeights(e.amount, e.participants, e.weights)
    : splitEqually(e.amount, e.participants)
}

export type ExactSplit =
  | { ok: true; shares: Map<string, number> }
  /** `left` is what's still to assign; negative when the amounts add up to more than the bill. */
  | { ok: false; left: number }

/**
 * "By amounts": people with an amount pay exactly that; people left blank (null) share what's
 * left equally. With nobody blank, the amounts must add up to the bill. Shares can be 0 when
 * nothing is left for the blank ones.
 */
export function splitByAmounts(total: number, entries: [string, number | null][]): ExactSplit {
  const fixed = entries.reduce((sum, [, a]) => sum + (a ?? 0), 0)
  const blank = entries.filter(([, a]) => a === null).map(([p]) => p)
  const left = total - fixed
  if (left < 0 || (blank.length === 0 && left !== 0)) return { ok: false, left }
  const rest = splitEqually(left, blank)
  return {
    ok: true,
    shares: new Map(entries.map(([p, a]) => [p, a ?? rest.get(p) ?? 0])),
  }
}

export interface PaymentLike {
  from: string
  to: string
  amount: number
}

/** Net balance per person: positive = the group owes them, negative = they owe. */
export function netBalances(expenses: ExpenseLike[], payments: PaymentLike[]): Map<string, number> {
  const net = new Map<string, number>()
  const add = (who: string, amount: number) => net.set(who, (net.get(who) ?? 0) + amount)
  for (const e of expenses) {
    add(e.paidBy, e.amount)
    for (const [who, share] of expenseShares(e)) add(who, -share)
  }
  for (const p of payments) {
    add(p.from, p.amount)
    add(p.to, -p.amount)
  }
  return net
}

export interface Transfer {
  from: string
  to: string
  amount: number
}

/** The fewest-ish transfers that settle everyone: biggest debtor pays biggest creditor. */
export function simplifyDebts(net: Map<string, number>): Transfer[] {
  const debtors = [...net].filter(([, v]) => v < 0).map(([who, v]) => ({ who, left: -v }))
  const creditors = [...net].filter(([, v]) => v > 0).map(([who, v]) => ({ who, left: v }))
  const byLeft = (a: { who: string; left: number }, b: { who: string; left: number }) =>
    b.left - a.left || a.who.localeCompare(b.who)
  const transfers: Transfer[] = []
  for (;;) {
    debtors.sort(byLeft)
    creditors.sort(byLeft)
    const d = debtors[0]
    const c = creditors[0]
    if (!d || !c || d.left === 0 || c.left === 0) break
    const amount = Math.min(d.left, c.left)
    transfers.push({ from: d.who, to: c.who, amount })
    d.left -= amount
    c.left -= amount
  }
  return transfers
}
