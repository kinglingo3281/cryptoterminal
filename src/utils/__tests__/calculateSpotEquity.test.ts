import { describe, it, expect } from 'vitest'
import { calculateSpotEquity, type SpotBalance } from '../calculateSpotEquity'

function balance(coin: string, total: number, token = 0, hold = 0): SpotBalance {
  return { coin, token, total, hold }
}

describe('calculateSpotEquity', () => {
  it('returns 0 for an empty balance list', () => {
    expect(calculateSpotEquity([], {})).toBe(0)
  })

  it('values stablecoins at $1 without needing a price feed', () => {
    const balances = [balance('USDC', 250), balance('USDH', 100)]
    expect(calculateSpotEquity(balances, {})).toBe(350)
  })

  it('uses the direct price when available', () => {
    const balances = [balance('HYPE', 10)]
    expect(calculateSpotEquity(balances, { HYPE: 54.9 })).toBeCloseTo(549)
  })

  it('maps wrapped spot tokens to their perp price (UBTC -> BTC)', () => {
    const balances = [balance('UBTC', 0.5)]
    expect(calculateSpotEquity(balances, { BTC: 64_000 })).toBe(32_000)
  })

  it('falls back to the @token index format', () => {
    const balances = [balance('OTHER', 2, 123)]
    expect(calculateSpotEquity(balances, { '@123': 5 })).toBe(10)
  })

  it('prefers the direct price over the mapped perp price', () => {
    const balances = [balance('UETH', 1)]
    expect(calculateSpotEquity(balances, { UETH: 1900, ETH: 2000 })).toBe(1900)
  })

  it('skips zero and negative balances', () => {
    const balances = [balance('HYPE', 0), balance('BTC', -1)]
    expect(calculateSpotEquity(balances, { HYPE: 50, BTC: 64_000 })).toBe(0)
  })

  it('ignores tokens with no resolvable price instead of guessing', () => {
    const balances = [balance('UNKNOWN', 42), balance('USDC', 10)]
    expect(calculateSpotEquity(balances, {})).toBe(10)
  })

  it('ignores NaN prices', () => {
    const balances = [balance('HYPE', 10)]
    expect(calculateSpotEquity(balances, { HYPE: NaN })).toBe(0)
  })

  it('sums a mixed portfolio correctly', () => {
    const balances = [
      balance('USDC', 100),
      balance('UBTC', 0.1),
      balance('HYPE', 20),
    ]
    const prices = { BTC: 60_000, HYPE: 50 }
    expect(calculateSpotEquity(balances, prices)).toBe(100 + 6_000 + 1_000)
  })
})
