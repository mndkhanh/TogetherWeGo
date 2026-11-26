/**
 * Money is always an integer number of minor units (VND: whole đồng, USD: cents).
 * Never use floating point for amounts.
 */

export const SUPPORTED_CURRENCIES = ['VND', 'USD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** Number of decimal digits for each currency's minor unit. */
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  VND: 0,
  USD: 2,
};

export function assertMinorUnits(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`Amount must be a safe integer in minor units, got ${amount}`);
  }
}

/**
 * Formats minor units for display, e.g. 150000 VND -> "150.000 ₫", 1050 USD -> "$10.50".
 */
export function formatMoney(amount: number, currency: Currency, locale = 'vi-VN'): string {
  assertMinorUnits(amount);
  const decimals = CURRENCY_DECIMALS[currency];
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 10 ** decimals);
}

/**
 * Splits `total` into `parts` integer shares that sum exactly to `total`.
 * The remainder is distributed one unit at a time to the first shares,
 * e.g. splitEvenly(100, 3) -> [34, 33, 33].
 */
export function splitEvenly(total: number, parts: number): number[] {
  assertMinorUnits(total);
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`);
  }
  if (total < 0) {
    return splitEvenly(-total, parts).map((share) => -share);
  }
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Largest amount accepted for a single expense or payment, in minor units. */
export const MAX_AMOUNT: Record<Currency, number> = {
  VND: 10_000_000_000, // 10 billion đồng
  USD: 100_000_000, // $1,000,000.00
};

/**
 * Parses what someone typed into minor units, or returns null if it isn't a valid amount.
 * VND has no decimals, so "150.000", "150,000" and "150000" all mean 150000.
 * USD accepts "1,234.5" or "1234.50" (at most 2 decimals).
 */
export function parseAmount(input: string, currency: Currency): number | null {
  const text = input.trim().replace(/[\s₫$đ]/giu, '');
  if (text === '') return null;

  if (CURRENCY_DECIMALS[currency] === 0) {
    if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(text)) return null;
    const value = Number(text.replace(/[.,]/g, ''));
    return Number.isSafeInteger(value) ? value : null;
  }

  const match = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]!.replace(/,/g, ''));
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const value = whole * 100 + cents;
  return Number.isSafeInteger(value) ? value : null;
}

/** Minor units as plain text for an input field, e.g. 150000 VND -> "150.000", 1050 USD -> "10.50". */
export function formatAmountInput(amount: number, currency: Currency): string {
  assertMinorUnits(amount);
  if (CURRENCY_DECIMALS[currency] === 0) {
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount);
  }
  return (amount / 100).toFixed(2);
}
