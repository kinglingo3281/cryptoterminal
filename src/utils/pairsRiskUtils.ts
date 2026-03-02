/**
 * Pairs Trading Risk Utilities
 * Pairs Trading Risk Utilities for funding pair sizing.
 */

export function parseRiskInput(
  input: string,
  walletBalance: number,
  defaultPct: number = 0.5
): number {
  if (!input || input.trim() === '') {
    return walletBalance * (defaultPct / 100)
  }

  const trimmed = input.trim()

  if (trimmed.endsWith('%')) {
    const pct = parseFloat(trimmed.slice(0, -1))
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      return walletBalance * (defaultPct / 100)
    }
    return walletBalance * (pct / 100)
  }

  if (trimmed.startsWith('$')) {
    const amount = parseFloat(trimmed.slice(1))
    if (isNaN(amount) || amount <= 0) {
      return walletBalance * (defaultPct / 100)
    }
    return Math.min(amount, walletBalance)
  }

  const amount = parseFloat(trimmed)
  if (isNaN(amount) || amount <= 0) {
    return walletBalance * (defaultPct / 100)
  }
  return Math.min(amount, walletBalance)
}

export function calculateLegSizes(totalRiskUsd: number, hedgeRatio: number = 1): {
  legA: number
  legB: number
} {
  const absGamma = Math.abs(hedgeRatio || 1.0)
  const legA = totalRiskUsd
  const legB = totalRiskUsd * absGamma
  return { legA, legB }
}

export function usdToAssetSize(legUsd: number, price: number): number {
  if (!price || price <= 0) return 0
  return legUsd / price
}
