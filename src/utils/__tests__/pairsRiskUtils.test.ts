import { describe, it, expect } from 'vitest'
import { parseRiskInput, calculateLegSizes, usdToAssetSize } from '../pairsRiskUtils'

const WALLET = 10_000

describe('parseRiskInput', () => {
  it('converts a percentage of the wallet balance', () => {
    expect(parseRiskInput('2%', WALLET)).toBe(200)
  })

  it('parses an explicit dollar amount', () => {
    expect(parseRiskInput('$150', WALLET)).toBe(150)
  })

  it('parses a bare number as a dollar amount', () => {
    expect(parseRiskInput('75', WALLET)).toBe(75)
  })

  it('caps dollar amounts at the wallet balance', () => {
    expect(parseRiskInput('$50000', WALLET)).toBe(WALLET)
    expect(parseRiskInput('50000', WALLET)).toBe(WALLET)
  })

  describe('default fallback (0.5% of wallet)', () => {
    const fallback = WALLET * 0.005

    it.each([
      ['empty input', ''],
      ['whitespace input', '  '],
      ['invalid percentage', 'abc%'],
      ['zero percentage', '0%'],
      ['percentage above 100', '101%'],
      ['invalid dollars', '$abc'],
      ['negative dollars', '$-5'],
      ['negative bare number', '-5'],
    ])('is used for %s', (_label, input) => {
      expect(parseRiskInput(input, WALLET)).toBe(fallback)
    })
  })

  it('honors a custom default percentage', () => {
    expect(parseRiskInput('', WALLET, 1)).toBe(100)
  })
})

describe('calculateLegSizes', () => {
  it('sizes both legs equally with a hedge ratio of 1', () => {
    expect(calculateLegSizes(500)).toEqual({ legA: 500, legB: 500 })
  })

  it('scales leg B by the hedge ratio', () => {
    expect(calculateLegSizes(500, 1.5)).toEqual({ legA: 500, legB: 750 })
  })

  it('uses the absolute value of a negative hedge ratio', () => {
    expect(calculateLegSizes(500, -2)).toEqual({ legA: 500, legB: 1000 })
  })

  it('falls back to a 1.0 ratio when the ratio is zero', () => {
    expect(calculateLegSizes(500, 0)).toEqual({ legA: 500, legB: 500 })
  })
})

describe('usdToAssetSize', () => {
  it('converts USD notional to asset units', () => {
    expect(usdToAssetSize(1000, 50)).toBe(20)
  })

  it('returns 0 for a zero price instead of dividing by zero', () => {
    expect(usdToAssetSize(1000, 0)).toBe(0)
  })

  it('returns 0 for a negative price', () => {
    expect(usdToAssetSize(1000, -10)).toBe(0)
  })
})
