import { useEffect, useState, useCallback } from 'react'
import { useTradeHistoryStore } from '@/store/useTradeHistoryStore'
import { TradeHistoryService } from '@/services/TradeHistoryService'
import type { TradeHistoryCache } from '@/types/trade-history'
import * as hl from '@nktkas/hyperliquid'

export function useTradeHistory(userAddress: string | null) {
  const store = useTradeHistoryStore()
  const [infoClient, setInfoClient] = useState<hl.InfoClient | null>(null)
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (!userAddress || initialized) return

    console.log('[useTradeHistory] Initializing for user:', userAddress)

    const cache = TradeHistoryService.loadCache(userAddress)
    if (cache && cache.fills.length > 0) {
      console.log(`[useTradeHistory] Loaded ${cache.fills.length} fills from cache`)
      store.setFills(cache.fills)
      store.updateStats()
    }

    const transport = new hl.HttpTransport({ isTestnet: false })
    const client = new hl.InfoClient({ transport })
    setInfoClient(client)
    setInitialized(true)
  }, [userAddress, initialized, store])

  const refresh = useCallback(async () => {
    if (!infoClient || !userAddress) {
      console.warn('[useTradeHistory] Cannot refresh: missing client or address')
      return
    }

    store.setLoading(true)
    try {
      const cache = TradeHistoryService.loadCache(userAddress)
      const { newFills } = await TradeHistoryService.fetchNewFills(
        infoClient,
        userAddress,
        cache
      )

      if (newFills.length > 0) {
        store.addFills(newFills)
        store.updateStats()
      }

      const currentFills = useTradeHistoryStore.getState().fills
      const updatedCache: TradeHistoryCache = {
        version: 1,
        fills: currentFills.slice(0, 10000),
        lastCheckTimestamp: Date.now(),
        newestFillTime: currentFills[0]?.time || null,
        userAddress
      }
      TradeHistoryService.saveCache(updatedCache)
      
      console.log('[useTradeHistory] Refresh complete')
    } catch (error) {
      console.error('[useTradeHistory] Refresh error:', error)
    } finally {
      store.setLoading(false)
    }
  }, [infoClient, userAddress, store])

  const fullRefresh = useCallback(async () => {
    if (!infoClient || !userAddress) {
      console.warn('[useTradeHistory] Cannot full refresh: missing client or address')
      return
    }

    store.setLoading(true)
    try {
      const fills = await TradeHistoryService.fullRefresh(infoClient, userAddress)
      store.setFills(fills)
      store.updateStats()

      const cache: TradeHistoryCache = {
        version: 1,
        fills: fills.slice(0, 10000),
        lastCheckTimestamp: Date.now(),
        newestFillTime: fills[0]?.time || null,
        userAddress
      }
      TradeHistoryService.saveCache(cache)
      
      console.log('[useTradeHistory] Full refresh complete')
    } catch (error) {
      console.error('[useTradeHistory] Full refresh error:', error)
    } finally {
      store.setLoading(false)
    }
  }, [infoClient, userAddress, store])

  return {
    fills: store.fills,
    stats: store.stats,
    isLoading: store.isLoading,
    refresh,
    fullRefresh
  }
}
