import { FundingAsset, FundingPair } from '@/types/funding'

export class FundingService {
  static async fetchAllRates(): Promise<FundingAsset[]> {
    const allAssets: FundingAsset[] = []

    // Dynamically fetch all DEXs (null = main, others = HIP-3)
    let dexes: Array<string | null> = [null]
    try {
      const dexListRes = await fetch('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'perpDexs' })
      })
      const dexList = await dexListRes.json()
      if (Array.isArray(dexList)) {
        for (const d of dexList) {
          if (d !== null && d?.name) dexes.push(d.name)
        }
      }
    } catch (e) {
      console.warn('[FundingService] Failed to fetch perpDexs, using main only')
    }

    for (const dex of dexes) {
      try {
        const payload: any = { type: 'metaAndAssetCtxs' }
        if (dex) payload.dex = dex

        const response = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

        const data = await response.json()
        const meta = data[0]?.universe || []
        const contexts = data[1] || []

        for (let i = 0; i < meta.length && i < contexts.length; i++) {
          let symbol = meta[i]?.name
          if (!symbol) continue

          if (dex && !symbol.includes(':')) {
            symbol = `${dex}:${symbol}`
          }

          const funding = parseFloat(contexts[i]?.funding || 0)
          const dayNtlVlm = parseFloat(contexts[i]?.dayNtlVlm || 0)

          if (funding !== 0 && dayNtlVlm >= 1000000) {
            allAssets.push({
              symbol: symbol,
              rate_1h: funding,
              rate_1h_pct: funding * 100,
              volume_24h: dayNtlVlm
            })
          }
        }
      } catch (e) {
        console.warn(`[FundingService] Failed to fetch ${dex || 'main'} DEX rates`)
      }
    }

    return allAssets
  }

  static calculatePairs(assets: FundingAsset[]): FundingPair[] {
    if (assets.length < 2) return []

    const sorted = [...assets].sort((a, b) => b.rate_1h - a.rate_1h)

    const symbolCount = new Map<string, number>()
    const MAX_SYMBOL_USAGE = 3

    const pairs: FundingPair[] = []
    const n = sorted.length
    let highIdx = 0
    let lowIdx = n - 1

    while (pairs.length < 30 && highIdx < lowIdx) {
      const high = sorted[highIdx]
      const low = sorted[lowIdx]

      const highCount = symbolCount.get(high.symbol) || 0
      const lowCount = symbolCount.get(low.symbol) || 0

      if (highCount >= MAX_SYMBOL_USAGE) {
        highIdx++
        continue
      }
      if (lowCount >= MAX_SYMBOL_USAGE) {
        lowIdx--
        continue
      }

      const spread_1h = high.rate_1h - low.rate_1h
      const spread_1h_pct = spread_1h * 100

      if (spread_1h_pct <= 0) break

      let strength: 1 | 2 | 3 | 4 = 1
      if (spread_1h_pct >= 0.06) strength = 4
      else if (spread_1h_pct >= 0.04) strength = 3
      else if (spread_1h_pct >= 0.02) strength = 2

      const annualized_pct = spread_1h * 24 * 365 * 100

      pairs.push({
        long_symbol: low.symbol,
        short_symbol: high.symbol,
        long_rate_1h_pct: Math.round(low.rate_1h_pct * 10000) / 10000,
        short_rate_1h_pct: Math.round(high.rate_1h_pct * 10000) / 10000,
        spread_1h_pct: Math.round(spread_1h_pct * 10000) / 10000,
        annualized_pct: Math.round(annualized_pct * 10) / 10,
        signal_strength: strength
      })

      symbolCount.set(high.symbol, highCount + 1)
      symbolCount.set(low.symbol, lowCount + 1)

      highIdx++
      if (lowCount + 1 >= MAX_SYMBOL_USAGE) {
        lowIdx--
      }
    }

    return pairs
  }

  static getStrengthClass(strength: number): string {
    if (strength >= 3) return 'strong'
    if (strength >= 2) return 'medium'
    return 'weak'
  }

  static formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000)

    if (seconds < 60) return `${seconds}s ago`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
    return `${Math.floor(seconds / 86400)}d ago`
  }

  static getNextFundingCountdown(): string {
    const now = new Date()
    const nextHour = new Date(now)
    nextHour.setHours(now.getHours() + 1, 0, 0, 0)
    const diff = Math.floor((nextHour.getTime() - now.getTime()) / 1000)
    const mins = Math.floor(diff / 60)
    const secs = diff % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  static loadHistory(): { version: number; pairs: any[] } {
    try {
      const raw = localStorage.getItem('fundingPairHistory')
      if (!raw) return { version: 1, pairs: [] }

      const data = JSON.parse(raw)
      if (!data.version) data.version = 1

      return data
    } catch (error) {
      console.error('[FundingService] Load history error:', error)
      return { version: 1, pairs: [] }
    }
  }

  static saveHistory(history: { version: number; pairs: any[] }): void {
    try {
      localStorage.setItem('fundingPairHistory', JSON.stringify(history))
    } catch (error) {
      console.error('[FundingService] Save history error:', error)
    }
  }
}
