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
