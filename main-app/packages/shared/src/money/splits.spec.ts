import { describe, expect, it } from 'vitest';
import { formatAmountInput, parseAmount } from './money.js';
import { computeSplits, type NetBalance, simplifyDebts, type SplitType } from './splits.js';

const people = (...values: number[]) => values.map((value, i) => ({ userId: `u${i}`, value }));
const sum = (xs: { amount: number }[]) => xs.reduce((acc, x) => acc + x.amount, 0);

function amounts(total: number, type: SplitType, values: number[]): number[] {
  const result = computeSplits(total, type, people(...values));
  if (!result.ok) throw new Error(result.error);
  return result.splits.map((s) => s.amount);
}

describe('computeSplits', () => {
  it('splits equally, leftovers to the first people', () => {
    expect(amounts(100_000, 'equal', [0, 0, 0])).toEqual([33_334, 33_333, 33_333]);
  });

  it('accepts exact amounts only when they add up', () => {
    expect(amounts(300, 'exact', [100, 200, 0])).toEqual([100, 200]);
    const result = computeSplits(300, 'exact', people(100, 100));
    expect(result).toEqual({ ok: false, error: 'The amounts add up to 200, not 300' });
  });

  it('splits by percentage (basis points) with largest-remainder rounding', () => {
    // 33.33% / 33.33% / 33.34% of 100đ
    expect(amounts(100, 'percent', [3333, 3333, 3334])).toEqual([33, 33, 34]);
    expect(computeSplits(100, 'percent', people(5000, 4000))).toMatchObject({ ok: false });
    expect(computeSplits(100, 'percent', people(10_001, 0))).toMatchObject({ ok: false });
  });

  it('splits by shares', () => {
    expect(amounts(300_000, 'shares', [2, 1, 0])).toEqual([200_000, 100_000]);
    expect(amounts(100, 'shares', [1, 1, 1])).toEqual([34, 33, 33]);
    expect(computeSplits(100, 'shares', people(0, 0))).toMatchObject({ ok: false });
  });

  it('rejects duplicates, negatives, fractions and empty lists', () => {
    expect(computeSplits(100, 'equal', [])).toMatchObject({ ok: false });
    expect(
      computeSplits(100, 'equal', [
        { userId: 'a', value: 0 },
        { userId: 'a', value: 0 },
      ]),
    ).toMatchObject({ ok: false });
    expect(computeSplits(100, 'exact', people(-50, 150))).toMatchObject({ ok: false });
    expect(computeSplits(100, 'shares', people(1.5, 1))).toMatchObject({ ok: false });
    expect(computeSplits(0, 'equal', people(0))).toMatchObject({ ok: false });
  });

  it('always adds up to the total, without precision loss on large amounts', () => {
    const totals = [1, 7, 99, 100_001, 9_999_999_999];
    const cases: [SplitType, number[]][] = [
      ['equal', [0, 0, 0, 0, 0, 0, 0]],
      ['percent', [1, 1, 9998]],
      ['percent', [3333, 3333, 3334]],
      ['shares', [7, 3, 1, 1000]],
    ];
    for (const total of totals) {
      for (const [type, values] of cases) {
        const result = computeSplits(total, type, people(...values));
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(sum(result.splits)).toBe(total);
          expect(result.splits.every((s) => s.amount >= 0)).toBe(true);
        }
      }
    }
  });
});

describe('simplifyDebts', () => {
  const settle = (balances: NetBalance[]) => {
    const transfers = simplifyDebts(balances);
    const after = new Map(balances.map((b) => [b.userId, b.net]));
    for (const t of transfers) {
      expect(t.amount).toBeGreaterThan(0);
      after.set(t.fromUserId, after.get(t.fromUserId)! + t.amount);
      after.set(t.toUserId, after.get(t.toUserId)! - t.amount);
    }
    expect([...after.values()].every((v) => v === 0)).toBe(true);
    return transfers;
  };

  it('settles a simple trip', () => {
    // A paid 300k for three people: B and C each owe A 100k.
    expect(
      settle([
        { userId: 'A', net: 200_000 },
        { userId: 'B', net: -100_000 },
        { userId: 'C', net: -100_000 },
      ]),
    ).toEqual([
      { fromUserId: 'B', toUserId: 'A', amount: 100_000 },
      { fromUserId: 'C', toUserId: 'A', amount: 100_000 },
    ]);
  });

  it('needs at most n-1 payments', () => {
    const balances = [
      { userId: 'a', net: 500 },
      { userId: 'b', net: 300 },
      { userId: 'c', net: -200 },
      { userId: 'd', net: -350 },
      { userId: 'e', net: -250 },
      { userId: 'f', net: 0 },
    ];
    expect(settle(balances).length).toBeLessThanOrEqual(4);
  });

  it('returns nothing when everyone is even, and refuses unbalanced input', () => {
    expect(settle([{ userId: 'a', net: 0 }])).toEqual([]);
    expect(() => simplifyDebts([{ userId: 'a', net: 1 }])).toThrow(RangeError);
  });
});

describe('parseAmount', () => {
  it('reads VND with any thousands separator', () => {
    expect(parseAmount('150.000', 'VND')).toBe(150_000);
    expect(parseAmount('150,000', 'VND')).toBe(150_000);
    expect(parseAmount(' 150000 ₫', 'VND')).toBe(150_000);
    expect(parseAmount('1.5', 'VND')).toBeNull();
    expect(parseAmount('abc', 'VND')).toBeNull();
    expect(parseAmount('', 'VND')).toBeNull();
  });

  it('reads USD with up to two decimals', () => {
    expect(parseAmount('10.5', 'USD')).toBe(1050);
    expect(parseAmount('$1,234.56', 'USD')).toBe(123_456);
    expect(parseAmount('10.555', 'USD')).toBeNull();
  });

  it('round-trips with formatAmountInput', () => {
    expect(parseAmount(formatAmountInput(1_234_000, 'VND'), 'VND')).toBe(1_234_000);
    expect(parseAmount(formatAmountInput(1050, 'USD'), 'USD')).toBe(1050);
  });
});
