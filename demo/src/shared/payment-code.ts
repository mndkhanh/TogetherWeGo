// Copied from main-app/packages/shared/src/payments (keep the two in step).
/**
 * Payment codes go in the bank transfer description so a transfer can be matched to the
 * settlement it pays, e.g. "TWG8K3F2QHN". No 0/O, 1/I/L, so they survive being read aloud
 * or retyped.
 */
export const PAYMENT_CODE_PREFIX = "TWG"
export const PAYMENT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
export const PAYMENT_CODE_LENGTH = 8

export const PAYMENT_CODE_PATTERN = new RegExp(
  `^${PAYMENT_CODE_PREFIX}[${PAYMENT_CODE_ALPHABET}]{${PAYMENT_CODE_LENGTH}}$`,
)

const searchPattern = new RegExp(
  `${PAYMENT_CODE_PREFIX}[${PAYMENT_CODE_ALPHABET}]{${PAYMENT_CODE_LENGTH}}`,
  "g",
)

/**
 * Finds the payment codes in a bank transfer description. Banks add their own text,
 * change case and sometimes drop spaces, so this searches rather than exact-matches.
 */
export function findPaymentCodes(description: string): string[] {
  const text = description.toUpperCase()
  return [...new Set(text.match(searchPattern) ?? [])]
}
