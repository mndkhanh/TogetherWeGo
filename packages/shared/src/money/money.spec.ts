import { describe, expect, it } from 'vitest';
import { assertMinorUnits, formatMoney, splitEvenly } from './money.js';

describe('splitEvenly', () => {
  it('splits exactly when divisible', () => {
    expect(splitEvenly(600_000, 3)).toEqual([200_000, 200_000, 200_000]);
  });

  it('gives the remainder to the first shares and always sums to the total', () => {
    const shares = splitEvenly(100, 3);
    expect(shares).toEqual([34, 33, 33]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('handles totals smaller than the number of parts', () => {
    expect(splitEvenly(2, 4)).toEqual([1, 1, 0, 0]);
  });

  it('handles negative totals symmetrically', () => {
    expect(splitEvenly(-100, 3)).toEqual([-34, -33, -33]);
  });

  it('sums to the total for many random inputs', () => {
    for (let i = 0; i < 1000; i++) {
      const total = Math.floor(Math.random() * 10_000_000);
      const parts = 1 + Math.floor(Math.random() * 20);
      const shares = splitEvenly(total, parts);
      expect(shares).toHaveLength(parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
  });

  it('rejects invalid input', () => {
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(10.5, 2)).toThrow(RangeError);
  });
});

describe('assertMinorUnits', () => {
  it('rejects floats and unsafe integers', () => {
    expect(() => assertMinorUnits(0.1)).toThrow(RangeError);
    expect(() => assertMinorUnits(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => assertMinorUnits(150_000)).not.toThrow();
  });
});

describe('formatMoney', () => {
  it('formats VND without decimals', () => {
    expect(formatMoney(150_000, 'VND')).toMatch(/150\.000\s?₫/);
  });

  it('formats USD with cents', () => {
    expect(formatMoney(1050, 'USD', 'en-US')).toBe('$10.50');
  });
});
