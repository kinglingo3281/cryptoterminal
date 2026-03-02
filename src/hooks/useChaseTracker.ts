import { useEffect, useRef } from 'react'
import { useChaseStore } from '@/store/useChaseStore'
import { ChaseService } from '@/services/ChaseService'
import { HyperliquidOrderClient } from '@/services/HyperliquidOrderClient'
import { useUserStore } from '@/store/useUserStore'
import type { ChaseSettings, ChaseData } from '@/types/chase'
import type { Order } from '@/types/positions'

export function useChaseTracker() {
  const serviceRef = useRef<ChaseService | null>(null)
  const { activeChases, isOrderChased, getChaseForOrder } = useChaseStore()
  const { apiKeys } = useUserStore()
  
  // Initialize service when API keys available
  useEffect(() => {
    if (!apiKeys?.hyperliquid?.apiKey) {
      // Clear service if no API key
      if (serviceRef.current) {
        serviceRef.current.cleanup()
        serviceRef.current = null
      }
      return
    }

    // Initialize order client with API key
    const orderClient = new HyperliquidOrderClient()
    orderClient.initialize(apiKeys.hyperliquid.apiKey).then(() => {
      serviceRef.current = new ChaseService(orderClient)
      console.log('[useChaseTracker] ChaseService initialized')
      console.log('[useChaseTracker] Order client wallet:', (orderClient as any).wallet?.address)
    }).catch(error => {
      console.error('[useChaseTracker] Failed to initialize ChaseService:', error)
    })
    
    return () => {
      // Cleanup on unmount or when API key changes
      if (serviceRef.current) {
        serviceRef.current.cleanup()
        serviceRef.current = null
      }
    }
  }, [apiKeys?.hyperliquid?.apiKey])
  
  const startChase = async (orderId: string, orderData: Order, settings: ChaseSettings) => {
    if (!serviceRef.current) {
      return { success: false, error: 'Service not initialized' }
    }
    return serviceRef.current.startChase(orderId, orderData, settings)
  }
  
  const stopChase = async (chaseId: string) => {
    if (!serviceRef.current) {
      return { success: false }
    }
    return serviceRef.current.stopChase(chaseId, 'user_stopped')
  }
  
  return {
    activeChases: Array.from(activeChases.values()),
    startChase,
    stopChase,
    isOrderChased,
    getChaseForOrder
  }
}
