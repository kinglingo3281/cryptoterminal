import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parsePositionSize } from '../positionSizeParser'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('parsePositionSize', () => {
  it('parses a percentage input', () => {
    expect(parsePositionSize('2.5%')).toEqual({ type: 'percentage', value: 2.5, raw: '2.5%' })
  })

  it('parses a plain dollar amount as USD margin', () => {
    expect(parsePositionSize('50')).toEqual({ type: 'usd', value: 50, raw: '$50' })
  })

  it('strips an explicit $ prefix and parses as USD', () => {
    expect(parsePositionSize('$125.75')).toEqual({ type: 'usd', value: 125.75, raw: '$125.75' })
  })

  it('treats bare numbers as percentages for backward compatibility', () => {
    expect(parsePositionSize(10)).toEqual({ type: 'percentage', value: 10, raw: '10%' })
  })

  it('trims surrounding whitespace', () => {
    expect(parsePositionSize('  3% ')).toEqual({ type: 'percentage', value: 3, raw: '3%' })
  })

  describe('falls back to the 2.5% default', () => {
    const fallback = { type: 'percentage', value: 2.5, raw: '2.5%' }

    it.each([
      ['null', null as unknown as string],
      ['undefined', undefined as unknown as string],
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('for %s input', (_label, input) => {
      expect(parsePositionSize(input)).toEqual(fallback)
    })

    it.each([
      ['non-numeric percentage', 'abc%'],
      ['zero percentage', '0%'],
      ['negative percentage', '-5%'],
      ['percentage above 100', '150%'],
      ['non-numeric dollars', 'abc'],
      ['zero dollars', '0'],
      ['negative dollars', '-20'],
    ])('for invalid input: %s', (_label, input) => {
      expect(parsePositionSize(input)).toEqual(fallback)
    })
  })

  it('accepts the 100% boundary but rejects just above it', () => {
    expect(parsePositionSize('100%')).toEqual({ type: 'percentage', value: 100, raw: '100%' })
    expect(parsePositionSize('100.01%')).toEqual({ type: 'percentage', value: 2.5, raw: '2.5%' })
  })
})
