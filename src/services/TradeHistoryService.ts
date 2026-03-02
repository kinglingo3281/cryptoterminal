import type { TradeHistoryFill, TradeHistoryCache, TradeHistoryStats } from '@/types/trade-history'

export class TradeHistoryService {
  private static readonly STORAGE_KEY_PREFIX = 'tradeHistory'
  private static readonly MAX_CACHED_FILLS = 10000
  private static readonly CACHE_VERSION = 1

  private static getStorageKey(userAddress: string): string {
    return `${this.STORAGE_KEY_PREFIX}_${userAddress.toLowerCase()}`
  }

  static loadCache(userAddress: string): TradeHistoryCache | null {
    if (typeof window === 'undefined') return null
    
    try {
      const key = this.getStorageKey(userAddress)
      const raw = localStorage.getItem(key)
      if (!raw) return null

      const cache = JSON.parse(raw) as TradeHistoryCache
      
      if (!cache.version || cache.version !== this.CACHE_VERSION) {
        console.warn('[TradeHistory] Cache version mismatch, clearing')
        this.clearCache(userAddress)
        return null
      }
      
      if (cache.userAddress.toLowerCase() !== userAddress.toLowerCase()) {
        console.warn('[TradeHistory] Cache user mismatch, clearing')
        this.clearCache(userAddress)
        return null
      }

      console.log(`[TradeHistory] Loaded ${cache.fills.length} cached fills`)
      return cache
    } catch (error) {
      console.error('[TradeHistory] Load cache error:', error)
      return null
    }
  }

  static saveCache(cache: TradeHistoryCache): void {
    if (typeof window === 'undefined') return

    try {
      const key = this.getStorageKey(cache.userAddress)
      
      const limitedCache: TradeHistoryCache = {
        ...cache,
        fills: cache.fills.slice(0, this.MAX_CACHED_FILLS)
      }
      
      localStorage.setItem(key, JSON.stringify(limitedCache))
      console.log(`[TradeHistory] Saved ${limitedCache.fills.length} fills to cache`)
    } catch (error) {
      console.error('[TradeHistory] Save cache error:', error)
    }
  }

  static async fetchNewFills(
    infoClient: any,
    userAddress: string,
    cache: TradeHistoryCache | null
  ): Promise<{ newFills: TradeHistoryFill[]; hasMore: boolean }> {
    try {
      console.log('[TradeHistory] Fetching new fills...')
      
      const apiFills = await infoClient.userFills({
        user: userAddress,
        aggregateByTime: true
      })

      if (!apiFills || apiFills.length === 0) {
        console.log('[TradeHistory] No fills returned from API')
        return { newFills: [], hasMore: false }
      }

      const normalized = this.normalizeFills(apiFills)
      
      if (!cache || !cache.newestFillTime) {
        console.log('[TradeHistory] No cache, returning all fills')
        return { newFills: normalized, hasMore: normalized.length >= 10000 }
      }

      const newFills: TradeHistoryFill[] = []
      const cachedTids = new Set(cache.fills.map(f => f.tid))

      for (const fill of normalized) {
        if (cachedTids.has(fill.tid)) {
          console.log('[TradeHistory] Found cached fill, stopping')
          break
        }
        
        if (fill.time <= cache.newestFillTime) {
          console.log('[TradeHistory] Reached cached timestamp, stopping')
          break
        }
        
        newFills.push(fill)
      }

      console.log(`[TradeHistory] Found ${newFills.length} new fills`)
      return { 
        newFills, 
        hasMore: newFills.length >= 10000 && newFills.length === normalized.length 
      }
    } catch (error) {
      console.error('[TradeHistory] Fetch new fills error:', error)
      throw error
    }
  }

  static async fullRefresh(
    infoClient: any,
    userAddress: string
  ): Promise<TradeHistoryFill[]> {
    try {
      console.log('[TradeHistory] Full refresh...')
      
      const apiFills = await infoClient.userFills({
        user: userAddress,
        aggregateByTime: true
      })

      if (!apiFills || apiFills.length === 0) {
        return []
      }

      const normalized = this.normalizeFills(apiFills)
      console.log(`[TradeHistory] Full refresh complete: ${normalized.length} fills`)
      return normalized
    } catch (error) {
      console.error('[TradeHistory] Full refresh error:', error)
      throw error
    }
  }

  private static normalizeFills(apiFills: any[]): TradeHistoryFill[] {
    return apiFills.map(fill => ({
      tid: Number(fill.tid),
      time: Number(fill.time),
      coin: String(fill.coin),
      side: fill.side === 'A' ? 'SELL' : 'BUY',
      price: parseFloat(fill.px || '0'),
      size: Math.abs(parseFloat(fill.sz || '0')),
      direction: fill.dir || '',
      closedPnl: parseFloat(fill.closedPnl || '0'),
      fee: parseFloat(fill.fee || '0'),
      feeToken: fill.feeToken || 'USDC',
      builderFee: fill.builderFee ? parseFloat(fill.builderFee) : undefined,
      startPosition: parseFloat(fill.startPosition || '0'),
      oid: Number(fill.oid),
      crossed: Boolean(fill.crossed),
      hash: String(fill.hash || '')
    }))
  }

  static mergeFills(
    newFills: TradeHistoryFill[],
    cachedFills: TradeHistoryFill[]
  ): TradeHistoryFill[] {
    const tidSet = new Set<number>()
    const merged: TradeHistoryFill[] = []

    const allFills = [...newFills, ...cachedFills]

    for (const fill of allFills) {
      if (!tidSet.has(fill.tid)) {
        tidSet.add(fill.tid)
        merged.push(fill)
      }
    }

    merged.sort((a, b) => b.time - a.time)

    return merged.slice(0, this.MAX_CACHED_FILLS)
  }

  static calculateStats(fills: TradeHistoryFill[]): TradeHistoryStats {
    if (fills.length === 0) {
      return {
        totalFills: 0,
        totalVolume: 0,
        totalFees: 0,
        realizedPnl: 0,
        dateRange: null
      }
    }

    let totalVolume = 0
    let totalFees = 0
    let realizedPnl = 0

    for (const fill of fills) {
      totalVolume += fill.price * fill.size
      totalFees += fill.fee
      if (fill.builderFee) totalFees += fill.builderFee
      realizedPnl += fill.closedPnl
    }

    const times = fills.map(f => f.time).sort((a, b) => a - b)

    return {
      totalFills: fills.length,
      totalVolume,
      totalFees,
      realizedPnl,
      dateRange: {
        start: times[0],
        end: times[times.length - 1]
      }
    }
  }

  static clearCache(userAddress: string): void {
    if (typeof window === 'undefined') return

    try {
      const key = this.getStorageKey(userAddress)
      localStorage.removeItem(key)
      console.log('[TradeHistory] Cache cleared')
    } catch (error) {
      console.error('[TradeHistory] Clear cache error:', error)
    }
  }
}
