import { describe, expect, it } from "vitest"

import {
  netBalances,
  parseVnd,
  simplifyDebts,
  splitByAmounts,
  splitByWeights,
  splitEqually,
} from "../src/lib/money"

describe("parseVnd", () => {
  it("reads plain, dotted and k amounts", () => {
    expect(parseVnd("150000")).toBe(150000)
    expect(parseVnd("150.000")).toBe(150000)
    expect(parseVnd("150k")).toBe(150000)
    expect(parseVnd(" 1,200,000 ")).toBe(1200000)
    expect(parseVnd("1.5k")).toBe(1500)
    expect(parseVnd("1,25k")).toBe(1250)
  })
  it("reads amounts written in parts", () => {
    expect(parseVnd("1m250k")).toBe(1_250_000)
    // Digits after a unit carry on from it, as people write it in Vietnam.
    expect(parseVnd("1m250")).toBe(1_250_000)
    expect(parseVnd("1tr2")).toBe(1_200_000)
    expect(parseVnd("1tr05")).toBe(1_050_000)
    expect(parseVnd("1tr250500")).toBe(1_250_500)
    expect(parseVnd("3k5")).toBe(3_500)
    expect(parseVnd("3k05")).toBe(3_050)
    expect(parseVnd("1m250k5")).toBe(1_250_500)
    expect(parseVnd("1m250k500")).toBe(1_250_500)
    expect(parseVnd("2tr500k")).toBe(2_500_000)
    expect(parseVnd("3k500")).toBe(3_500)
    expect(parseVnd("1M 250K")).toBe(1_250_000)
    expect(parseVnd("1m0k")).toBe(1_000_000)
    // A part too big for its place is a typo, and units come largest first, once each.
    for (const bad of [
      "1m2500k",
      "1k1000",
      "3k5000",
      "1m250k5000",
      "1m1000000",
      "250k1m",
      "1m1m",
      "1.5m250k",
      "m250k",
    ]) {
      expect(parseVnd(bad)).toBeNull()
    }
  })
  it("reads millions as m or tr", () => {
    expect(parseVnd("1m")).toBe(1_000_000)
    expect(parseVnd("1M")).toBe(1_000_000)
    expect(parseVnd("2.5m")).toBe(2_500_000)
    expect(parseVnd("1,2m")).toBe(1_200_000)
    expect(parseVnd("1tr")).toBe(1_000_000)
    expect(parseVnd("1.5 tr")).toBe(1_500_000)
    expect(parseVnd("10000m")).toBe(10_000_000_000)
    for (const bad of ["m", "tr", "1.2.3m", "0m", "10001m", "1mk", "1km"]) {
      expect(parseVnd(bad)).toBeNull()
    }
  })
  it("rejects zero, negatives, fractions and nonsense", () => {
    for (const bad of ["", "0", "-5", "1.5", "15.00", "1.2.3k", "abc", "k", "99999999999"]) {
      expect(parseVnd(bad)).toBeNull()
    }
  })
})

describe("splitEqually", () => {
  it("rounds only the last dong, onto the last people in the list", () => {
    expect([...splitEqually(1_000_000, ["an", "binh", "chi"])]).toEqual([
      ["an", 333_333],
      ["binh", 333_333],
      ["chi", 333_334],
    ])
    expect([...splitEqually(101, ["c", "a", "b", "d"]).values()]).toEqual([25, 25, 25, 26])
    expect([...splitEqually(102, ["c", "a", "b", "d"]).values()]).toEqual([25, 25, 26, 26])
  })
  it("always adds up to the amount", () => {
    for (const amount of [1, 7, 100001, 999999]) {
      const total = [...splitEqually(amount, ["x", "y", "z", "w"]).values()].reduce(
        (a, b) => a + b,
        0,
      )
      expect(total).toBe(amount)
    }
  })
})

describe("balances", () => {
  it("nets expenses and payments, and settles in few transfers", () => {
    const net = netBalances(
      [
        { amount: 300000, paidBy: "an", participants: ["an", "binh", "chi"] },
        { amount: 90000, paidBy: "binh", participants: ["an", "binh", "chi"] },
      ],
      [{ from: "chi", to: "an", amount: 50000 }],
    )
    expect(Object.fromEntries(net)).toEqual({ an: 120000, binh: -40000, chi: -80000 })
    expect(simplifyDebts(net)).toEqual([
      { from: "chi", to: "an", amount: 80000 },
      { from: "binh", to: "an", amount: 40000 },
    ])
    const settled = netBalances([], [])
    expect(simplifyDebts(settled)).toEqual([])
  })
})

describe("uneven splits", () => {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

  it("splits by shares, and the dong always add up", () => {
    // A couple (2 shares) and two singles on 1.000.000.
    const shares = splitByWeights(1_000_000, ["couple", "an", "binh"], [4, 2, 2])
    expect(Object.fromEntries(shares)).toEqual({ couple: 500_000, an: 250_000, binh: 250_000 })
    const odd = splitByWeights(100_001, ["a", "b", "c"], [1, 1, 1])
    expect([...odd.values()]).toEqual([33_333, 33_334, 33_334])
    // 7.5 and 2.5: a tie, so the later person takes the extra dong.
    expect([...splitByWeights(10, ["x", "y"], [3, 1]).values()]).toEqual([7, 3])
    // Huge amounts don't lose precision.
    expect(sum(splitByWeights(9_999_999_999, ["a", "b", "c"], [7, 11, 13]))).toBe(9_999_999_999)
  })

  it("falls back to equal when the weights don't fit", () => {
    expect(splitByWeights(300, ["a", "b", "c"], [1, 2])).toEqual(splitEqually(300, ["a", "b", "c"]))
    expect(splitByWeights(300, ["a", "b"], [1, -1])).toEqual(splitEqually(300, ["a", "b"]))
  })

  it("splits by amounts, sharing the rest among those left blank", () => {
    const r = splitByAmounts(1_200_000, [
      ["an", 300_000],
      ["binh", 250_000],
      ["chi", null],
      ["dung", null],
    ])
    expect(r.ok && Object.fromEntries(r.shares)).toEqual({
      an: 300_000,
      binh: 250_000,
      chi: 325_000,
      dung: 325_000,
    })
    expect(
      splitByAmounts(500, [
        ["a", 200],
        ["b", 300],
      ]).ok,
    ).toBe(true)
    expect(
      splitByAmounts(500, [
        ["a", 200],
        ["b", 250],
      ]),
    ).toEqual({ ok: false, left: 50 })
    expect(
      splitByAmounts(500, [
        ["a", 400],
        ["b", 200],
        ["c", null],
      ]),
    ).toEqual({ ok: false, left: -100 })
  })

  it("counts uneven expenses in balances", () => {
    const net = netBalances(
      [{ amount: 1_000_000, paidBy: "an", participants: ["an", "binh"], weights: [1, 3] }],
      [],
    )
    expect(Object.fromEntries(net)).toEqual({ an: 750_000, binh: -750_000 })
  })
})
