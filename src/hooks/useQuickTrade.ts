/**
 * Quick Trade Hook
 * React hook wrapper for QuickTradeService
 */

import { useEffect, useRef, useState } from 'react'
import { QuickTradeService, type QuickTradeOptions } from '@/services/QuickTradeService'
import { HyperliquidOrderClient } from '@/services/HyperliquidOrderClient'
import { quickTradeRiskManager } from '@/services/QuickTradeRiskManager'
import { useChaseTracker } from '@/hooks/useChaseTracker'
import { useUserStore } from '@/store/useUserStore'
import { usePositionsStore } from '@/store/usePositionsStore'
import type { TradeSignal } from '@/hooks/useTradeDataManager'

const LOG_QUICK_TRADE = false

const log = (...args: unknown[]) => {
  if (LOG_QUICK_TRADE) {
    console.log(...args)
  }
}

const logError = (...args: unknown[]) => {
  if (LOG_QUICK_TRADE) {
    console.error(...args)
  }
}

export interface QuickTradeResult {
  success: boolean
  orderId?: string
  error?: string
  size?: number
  notional?: number
  leverage?: number
}

export function useQuickTrade() {
  const serviceRef = useRef<QuickTradeService | null>(null)
  const [isExecuting, setIsExecuting] = useState(false)
  const { apiKeys, user } = useUserStore()
  const accountSummary = usePositionsStore(state => state.accountSummary)
  const positions = usePositionsStore(state => state.positions)
  const { startChase } = useChaseTracker()

  useEffect(() => {
    if (!apiKeys?.hyperliquid?.apiKey) {
      if (serviceRef.current) {
        serviceRef.current = null
      }
      return
    }

    const orderClient = new HyperliquidOrderClient()
    orderClient.initialize(apiKeys.hyperliquid.apiKey).then(() => {
      serviceRef.current = new QuickTradeService(orderClient, quickTradeRiskManager)
      log('[useQuickTrade] QuickTradeService initialized')
    }).catch(error => {
      logError('[useQuickTrade] Failed to initialize QuickTradeService:', error)
    })

    return () => {
      if (serviceRef.current) {
        serviceRef.current = null
      }
    }
  }, [apiKeys?.hyperliquid?.apiKey])

  const executeQuickTrade = async (
    signal: TradeSignal,
    positionSize: string = '2.5%',
    scaleUpEnabled: boolean = true,
    options: QuickTradeOptions = {}
  ): Promise<QuickTradeResult> => {
    if (!serviceRef.current) {
      return { 
        success: false, 
        error: 'Quick trade service not initialized. Please check API credentials.' 
      }
    }

    if (!accountSummary?.accountValue) {
      return { 
        success: false, 
        error: 'Account value not available. Please wait for account data to load.' 
      }
    }

    if (isExecuting) {
      return { 
        success: false, 
        error: 'Already executing a trade. Please wait.' 
      }
    }

    setIsExecuting(true)

    try {
      const mergedOptions: QuickTradeOptions = {
        ...options,
        startChase: options.startChase ?? startChase,
        userAddress: options.userAddress ?? user?.wallet_address ?? null,
        openPositionsCount: options.openPositionsCount ?? positions.length
      }

      const result = await serviceRef.current.executeQuickTrade(
        signal,
        accountSummary.accountValue,
        positionSize,
        scaleUpEnabled,
        mergedOptions
      )

      return result
    } catch (error: any) {
      logError('[useQuickTrade] Execution error:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      }
    } finally {
      setIsExecuting(false)
    }
  }

  return {
    executeQuickTrade,
    isExecuting,
    isReady: !!serviceRef.current && !!accountSummary?.accountValue
  }
}
