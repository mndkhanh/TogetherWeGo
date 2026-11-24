import { assertMinorUnits } from './money.js';

/**
 * How an expense is divided between the people who shared it.
 * - equal:   everyone listed pays the same (value is ignored)
 * - exact:   value is each person's amount in minor units; must add up to the total
 * - percent: value is basis points (1% = 100); must add up to 10000
 * - shares:  value is a whole number of shares, e.g. 2 for someone who had twice as much
 */
export const SPLIT_TYPES = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export const PERCENT_TOTAL_BP = 10_000;
export const MAX_SHARES_PER_PERSON = 1_000;

export interface SplitEntry {
  userId: string;
  value: number;
}

export interface SplitAmount {
  userId: string;
  amount: number;
}

export type SplitResult = { ok: true; splits: SplitAmount[] } | { ok: false; error: string };

/**
 * Turns split input into exact amounts that always add up to `total`.
 * People with a zero value are left out. Rounding leftovers go to the largest
 * fractional parts (ties: earlier in the list), so the result is deterministic.
 */
export function computeSplits(total: number, type: SplitType, entries: SplitEntry[]): SplitResult {
  assertMinorUnits(total);
  if (total <= 0) return { ok: false, error: 'Enter an amount greater than 0' };
  if (entries.length === 0) return { ok: false, error: 'Choose who shared this expense' };

  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.userId)) return { ok: false, error: 'Each person can appear only once' };
    seen.add(entry.userId);
    if (!Number.isSafeInteger(entry.value) || entry.value < 0) {
      return { ok: false, error: 'Use whole, non-negative numbers' };
    }
  }

  switch (type) {
    case 'equal':
      return byWeight(
        total,
        entries.map((e) => ({ userId: e.userId, value: 1 })),
      );

    case 'exact': {
      const sum = entries.reduce((acc, e) => acc + e.value, 0);
      if (sum !== total) {
        return { ok: false, error: `The amounts add up to ${sum}, not ${total}` };
      }
      const splits = entries
        .filter((e) => e.value > 0)
        .map((e) => ({ userId: e.userId, amount: e.value }));
      return splits.length > 0
        ? { ok: true, splits }
        : { ok: false, error: 'Nobody pays anything' };
    }

    case 'percent': {
      if (entries.some((e) => e.value > PERCENT_TOTAL_BP)) {
        return { ok: false, error: 'A percentage can’t be over 100%' };
      }
      const sum = entries.reduce((acc, e) => acc + e.value, 0);
      if (sum !== PERCENT_TOTAL_BP) {
        return { ok: false, error: `The percentages add up to ${sum / 100}%, not 100%` };
      }
      return byWeight(total, entries);
    }

    case 'shares': {
      if (entries.some((e) => e.value > MAX_SHARES_PER_PERSON)) {
        return { ok: false, error: `Use at most ${MAX_SHARES_PER_PERSON} shares per person` };
      }
      if (entries.every((e) => e.value === 0)) {
        return { ok: false, error: 'Give at least one person a share' };
      }
      return byWeight(total, entries);
    }
  }
}

/** Largest-remainder apportionment, in BigInt so total × weight can't lose precision. */
function byWeight(total: number, entries: SplitEntry[]): SplitResult {
  const weighted = entries.filter((e) => e.value > 0);
  const weightSum = weighted.reduce((acc, e) => acc + BigInt(e.value), 0n);
  const bigTotal = BigInt(total);

  const parts = weighted.map((e, index) => {
    const numerator = bigTotal * BigInt(e.value);
    return {
      userId: e.userId,
      index,
      amount: numerator / weightSum,
      remainder: numerator % weightSum,
    };
  });

  let leftover = bigTotal - parts.reduce((acc, p) => acc + p.amount, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (leftover === 0n) break;
    part.amount += 1n;
    leftover -= 1n;
  }

  return {
    ok: true,
    splits: parts.map((p) => ({ userId: p.userId, amount: Number(p.amount) })),
  };
}

// ---------- Balances ----------

export interface NetBalance {
  userId: string;
  /** Positive: the group owes them. Negative: they owe the group. */
  net: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

/**
 * The fewest practical payments that clear everyone's balance: repeatedly match
 * the person owed the most with the person who owes the most.
 * Ties are broken by userId so everyone sees the same suggestion.
 */
export function simplifyDebts(balances: NetBalance[]): Transfer[] {
  const total = balances.reduce((acc, b) => acc + b.net, 0);
  if (total !== 0) {
    throw new RangeError(`Balances must sum to 0, got ${total}`);
  }

  const byAmountThenId = (a: NetBalance, b: NetBalance) =>
    b.net - a.net || a.userId.localeCompare(b.userId);
  const creditors = balances.filter((b) => b.net > 0).map((b) => ({ ...b }));
  const debtors = balances.filter((b) => b.net < 0).map((b) => ({ ...b, net: -b.net }));

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    const creditor = creditors[0]!;
    const debtor = debtors[0]!;
    const amount = Math.min(creditor.net, debtor.net);
    transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amount });
    creditor.net -= amount;
    debtor.net -= amount;
    if (creditor.net === 0) creditors.shift();
    if (debtor.net === 0) debtors.shift();
  }
  return transfers;
}
