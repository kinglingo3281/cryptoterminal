import { useEffect, useRef } from 'react'
import { GridStrategyService } from '@/services/GridStrategyService'
import { HyperliquidOrderClient } from '@/services/HyperliquidOrderClient'
import { useUserStore } from '@/store/useUserStore'
import { useChaseTracker } from '@/hooks/useChaseTracker'
import type { GridConfig } from '@/types/grid'

export function useGridTracker() {
  const serviceRef = useRef<GridStrategyService | null>(null)
  const { apiKeys } = useUserStore()
  const { startChase, stopChase } = useChaseTracker()

  useEffect(() => {
    if (!apiKeys?.hyperliquid?.apiKey) {
      if (serviceRef.current) {
        serviceRef.current = null
      }
      return
    }

    const orderClient = new HyperliquidOrderClient()
    orderClient.initialize(apiKeys.hyperliquid.apiKey).then(() => {
      serviceRef.current = new GridStrategyService(orderClient, { startChase, stopChase })
      // console.log('[useGridTracker] GridStrategyService initialized')
    }).catch(error => {
      console.error('[useGridTracker] Failed to initialize GridStrategyService:', error)
    })

    return () => {
      if (serviceRef.current) {
        serviceRef.current = null
      }
    }
  }, [apiKeys?.hyperliquid?.apiKey, startChase, stopChase])

  const startGrid = async (config: GridConfig) => {
    if (!serviceRef.current) {
      return { success: false, error: 'Grid service not initialized' }
    }
    return serviceRef.current.startGrid(config)
  }

  const stopGrid = async (gridId: string) => {
    if (!serviceRef.current) {
      return { success: false }
    }
    return serviceRef.current.stopGrid(gridId)
  }

  return {
    startGrid,
    stopGrid
  }
}
