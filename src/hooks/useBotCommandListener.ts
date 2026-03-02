'use client'

/**
 * Bot Command Listener Hook
 * Listens for commands from Clawdbot via Supabase Realtime
 * Executes trades locally in browser with user's keys
 */

import { useEffect, useCallback, useRef } from 'react'
import { getBrowserSupabaseClient } from '@/lib/supabaseBrowserClient'
import { useQuickTrade } from '@/hooks/useQuickTrade'
import { useUserStore } from '@/store/useUserStore'
import { usePositionsStore } from '@/store/usePositionsStore'
import { useChaseStore } from '@/store/useChaseStore'
import { useAutomationStore } from '@/store/useAutomationStore'
import { useTrackerStore } from '@/store/useTrackerStore'
import { useFundingStore } from '@/store/useFundingStore'
import { useSSEData } from '@/providers/SSEProvider'
import { HyperliquidOrderClient } from '@/services/HyperliquidOrderClient'
import { ChaseService } from '@/services/ChaseService'
import { GridStrategyService } from '@/services/GridStrategyService'
import { FundingService } from '@/services/FundingService'
import { atrService } from '@/services/ATRService'
import type { BotCommand, CommandResult } from '@/types/bot-commands'
import type { ChaseSettings } from '@/types/chase'
import type { GridConfig } from '@/types/grid'

const LOG_BOT_LISTENER = false

const log = (...args: unknown[]) => {
  if (LOG_BOT_LISTENER) {
    console.log(...args)
  }
}

export function useBotCommandListener() {
  const { executeQuickTrade, isReady } = useQuickTrade()
  const { apiKeys, user } = useUserStore()
  const { allTrades } = useSSEData()
  const accountSummary = usePositionsStore(state => state.accountSummary)
  const orderClientRef = useRef<HyperliquidOrderClient | null>(null)
  const chaseServiceRef = useRef<ChaseService | null>(null)
  const gridServiceRef = useRef<GridStrategyService | null>(null)
  const supabaseRef = useRef<any>(null)

  // Initialize order client for direct orders
  useEffect(() => {
    if (!apiKeys?.hyperliquid?.apiKey) {
      orderClientRef.current = null
      return
    }

    const client = new HyperliquidOrderClient()
    client.initialize(apiKeys.hyperliquid.apiKey).then(() => {
      orderClientRef.current = client
      
      // Initialize chase service
      chaseServiceRef.current = new ChaseService(client)
      
      // Initialize grid service (needs chase tracker functions)
      const chaseTracker = {
        startChase: async (orderId: string, orderData: any, settings: ChaseSettings) => {
          return chaseServiceRef.current?.startChase(orderId, orderData, settings)
        },
        stopChase: async (chaseId: string) => {
          return chaseServiceRef.current?.stopChase(chaseId, 'bot_stopped')
        }
      }
      gridServiceRef.current = new GridStrategyService(client, chaseTracker)
      
      log('[BotListener] Order client, Chase service, and Grid service initialized')
    })

    return () => {
      if (chaseServiceRef.current) {
        chaseServiceRef.current.cleanup()
        chaseServiceRef.current = null
      }
      gridServiceRef.current = null
      orderClientRef.current = null
    }
  }, [apiKeys?.hyperliquid?.apiKey])

  // Update command status in Supabase
  const updateCommandStatus = useCallback(async (
    commandId: string, 
    status: 'received' | 'executed' | 'failed',
    result?: CommandResult
  ) => {
    if (!supabaseRef.current) return

    try {
      await supabaseRef.current
        .from('bot_commands')
        .update({ 
          status, 
          result,
          executed_at: status === 'executed' || status === 'failed' ? new Date().toISOString() : null
        })
        .eq('id', commandId)
    } catch (error) {
      console.error('[BotListener] Failed to update command status:', error)
    }
  }, [])

  // Execute a command
  const executeCommand = useCallback(async (command: BotCommand): Promise<CommandResult> => {
    log('[BotListener] Executing command:', command.command_type, command.payload)

    try {
      switch (command.command_type) {
        case 'execute': {
          // Execute from signal - supports ID or criteria-based lookup
          const payload = command.payload as {
            signal_id?: string
            asset?: string
            direction?: 'long' | 'short'
            position_size?: string
            scale_up?: boolean
            select?: 'newest' | 'highest_confidence' | 'best_rr'
          }
          
          let signal = null
          
          // Option 1: Find by exact ID
          if (payload.signal_id) {
            signal = allTrades.find(t => t.id === payload.signal_id)
            if (!signal) {
              return { success: false, error: `Signal not found: ${payload.signal_id}` }
            }
          }
          // Option 2: Find by criteria
          else if (payload.asset || payload.direction) {
            let candidates = [...allTrades]
            
            if (payload.asset) {
              candidates = candidates.filter(t => t.asset === payload.asset)
            }
            if (payload.direction) {
              candidates = candidates.filter(t => t.direction === payload.direction)
            }
            
            if (candidates.length === 0) {
              return { success: false, error: `No signals found for criteria: asset=${payload.asset}, direction=${payload.direction}` }
            }
            
            // Select based on criteria
            const selectMode = payload.select || 'newest'
            switch (selectMode) {
              case 'newest':
                // Already sorted newest first
                signal = candidates[0]
                break
              case 'highest_confidence':
                signal = candidates.reduce((best, s) => (s.confidence || 0) > (best.confidence || 0) ? s : best)
                break
              case 'best_rr':
                const calcRR = (s: any) => {
                  const entry = s.entry_price || 0
                  const tp = s.target_price || 0
                  const sl = s.stop_price || 0
                  if (!entry || !tp || !sl) return 0
                  const reward = Math.abs(tp - entry)
                  const risk = Math.abs(entry - sl)
                  return risk === 0 ? 0 : reward / risk
                }
                signal = candidates.reduce((best, s) => calcRR(s) > calcRR(best) ? s : best)
                break
            }
          }
          else {
            return { success: false, error: 'Must provide signal_id or asset/direction criteria' }
          }

          const result = await executeQuickTrade(
            signal,
            payload.position_size || '2.5%',
            payload.scale_up !== false
          )

          return {
            success: result.success,
            data: result.success ? { 
              orderId: result.orderId, 
              size: result.size,
              signal_id: signal.id,
              asset: signal.asset,
              direction: signal.direction
            } : undefined,
            error: result.error
          }
        }

        case 'order': {
          // Direct order
          if (!orderClientRef.current) {
            return { success: false, error: 'Order client not initialized' }
          }

          const payload = command.payload as {
            asset: string
            side: 'buy' | 'sell'
            type: 'market' | 'limit'
            size: number
            price?: number
            leverage?: number
            reduce_only?: boolean
            tp_price?: number
            sl_price?: number
          }

          log('[BotListener] Order payload received:', payload)

          const result = await orderClientRef.current.executeTradingOrder({
            asset: payload.asset,
            orderSide: payload.side,
            orderType: payload.type,
            size: payload.size,
            price: payload.price || null,
            leverage: payload.leverage || null,
            isCrossMargin: true,
            reduceOnly: payload.reduce_only || false,
            timeInForce: 'GTC',
            tpslEnabled: !!(payload.tp_price || payload.sl_price),
            tpPrice: payload.tp_price || null,
            slPrice: payload.sl_price || null,
            tpIsLimit: true,
            slIsLimit: false
          })

          return {
            success: result.success,
            data: result.success ? { oid: result.oid } : undefined,
            error: result.error
          }
        }

        case 'cancel': {
          if (!orderClientRef.current) {
            return { success: false, error: 'Order client not initialized' }
          }

          const payload = command.payload as { order_id: string | number; asset: string }
          const result = await orderClientRef.current.cancelOrder(payload.order_id, payload.asset)

          return {
            success: result.success,
            data: result.success ? { message: 'Order cancelled' } : undefined,
            error: result.error
          }
        }

        case 'close': {
          if (!orderClientRef.current || !user?.wallet_address) {
            return { success: false, error: 'Order client not initialized or no wallet' }
          }

          const payload = command.payload as { asset: string }
          const result = await orderClientRef.current.closePosition(payload.asset, user.wallet_address)

          return {
            success: result.success,
            data: result.success ? { message: 'Position closed' } : undefined,
            error: result.error
          }
        }

        case 'cancel_all': {
          if (!orderClientRef.current || !user?.wallet_address) {
            return { success: false, error: 'Order client not initialized or no wallet' }
          }

          const payload = command.payload as { asset?: string }
          const orders = usePositionsStore.getState().orders
          
          let ordersToCancel = orders.map(o => ({
            orderId: String(o.oid),
            asset: o.coin,
            reduceOnly: o.reduceOnly || false
          }))
          
          if (payload.asset) {
            ordersToCancel = ordersToCancel.filter(o => o.asset === payload.asset)
          }

          if (ordersToCancel.length === 0) {
            return { success: true, data: { message: 'No orders to cancel', cancelled: 0 } }
          }

          const result = await orderClientRef.current.cancelMultipleOrders(ordersToCancel)

          return {
            success: result.success,
            data: { 
              message: `Cancelled ${result.successCount}/${result.totalOrders} orders`,
              cancelled: result.successCount,
              total: result.totalOrders,
              errors: result.errors
            },
            error: result.errors.length > 0 ? result.errors.join(', ') : undefined
          }
        }

        case 'close_all': {
          if (!orderClientRef.current || !user?.wallet_address) {
            return { success: false, error: 'Order client not initialized or no wallet' }
          }

          const payload = command.payload as { method: 'market' | 'limit'; asset?: string }
          const positions = usePositionsStore.getState().positions
          
          let positionsToClose = positions.map(p => ({
            asset: p.coin,
            userAddress: user.wallet_address!
          }))
          
          if (payload.asset) {
            positionsToClose = positionsToClose.filter(p => p.asset === payload.asset)
          }

          if (positionsToClose.length === 0) {
            return { success: true, data: { message: 'No positions to close', closed: 0 } }
          }

          const result = payload.method === 'limit' 
            ? await orderClientRef.current.closeMultiplePositionsLimit(positionsToClose)
            : await orderClientRef.current.closeMultiplePositions(positionsToClose)

          return {
            success: result.success,
            data: { 
              message: `Closed ${result.successCount}/${result.totalPositions} positions`,
              closed: result.successCount,
              total: result.totalPositions,
              method: payload.method,
              errors: result.errors
            },
            error: result.errors.length > 0 ? result.errors.join(', ') : undefined
          }
        }

        case 'start_chase': {
          if (!chaseServiceRef.current || !orderClientRef.current) {
            return { success: false, error: 'Chase service not initialized' }
          }

          const payload = command.payload as {
            order_id: number | string
            asset: string
            tick_distance?: number
            percent_distance?: number
            frequency_min?: number
            frequency_max?: number
            range_price?: number
            range_type?: 'upper' | 'lower'
            anchor_price?: number
            use_anchor?: boolean
            aggressive?: boolean
          }

          const orders = usePositionsStore.getState().orders
          const order = orders.find(o => String(o.oid) === String(payload.order_id))

          if (!order) {
            return { success: false, error: `Order not found: ${payload.order_id}` }
          }

          const chaseSettings: ChaseSettings = {
            tickDistance: payload.tick_distance,
            percentDistance: payload.percent_distance,
            isPercent: !!payload.percent_distance,
            frequencyRangeMin: payload.frequency_min || 5,
            frequencyRangeMax: payload.frequency_max || 15,
            rangePrice: payload.range_price,
            rangeType: payload.range_type,
            anchorPrice: payload.anchor_price,
            useAnchor: payload.use_anchor || false,
            aggressive: payload.aggressive || false
          }

          const result = await chaseServiceRef.current.startChase(
            String(payload.order_id),
            order,
            chaseSettings
          )

          return {
            success: result.success,
            data: result.success ? { chase_id: result.chaseId, order_id: payload.order_id } : undefined,
            error: result.error
          }
        }

        case 'stop_chase': {
          if (!chaseServiceRef.current) {
            return { success: false, error: 'Chase service not initialized' }
          }

          const payload = command.payload as { chase_id?: string; asset?: string }
          const activeChases = useChaseStore.getState().activeChases

          if (payload.chase_id) {
            const result = await chaseServiceRef.current.stopChase(payload.chase_id, 'bot_stopped')
            return {
              success: result.success,
              data: { message: `Chase ${payload.chase_id} stopped` }
            }
          }

          if (payload.asset) {
            let stoppedCount = 0
            for (const [chaseId, chase] of activeChases) {
              if (chase.asset === payload.asset) {
                await chaseServiceRef.current.stopChase(chaseId, 'bot_stopped')
                stoppedCount++
              }
            }
            return {
              success: true,
              data: { message: `Stopped ${stoppedCount} chases for ${payload.asset}`, stopped: stoppedCount }
            }
          }

          return { success: false, error: 'Must provide chase_id or asset' }
        }

        case 'stop_all_chases': {
          if (!chaseServiceRef.current) {
            return { success: false, error: 'Chase service not initialized' }
          }

          const activeChases = useChaseStore.getState().activeChases
          let stoppedCount = 0

          for (const [chaseId] of activeChases) {
            await chaseServiceRef.current.stopChase(chaseId, 'bot_stopped')
            stoppedCount++
          }

          return {
            success: true,
            data: { message: `Stopped ${stoppedCount} chases`, stopped: stoppedCount }
          }
        }

        case 'start_grid': {
          if (!gridServiceRef.current) {
            return { success: false, error: 'Grid service not initialized' }
          }

          const payload = command.payload as {
            asset: string
            levels: 3 | 6 | 10
            base_tick_distance?: number
            base_percent_distance?: number
            size_per_level: number
            leverage?: number
            is_cross_margin?: boolean
            anchor?: number
            chase_frequency_min?: number
            chase_frequency_max?: number
          }

          const gridConfig: GridConfig = {
            asset: payload.asset,
            levels: payload.levels,
            baseTickDistance: payload.base_tick_distance || 10,
            basePercentDistance: payload.base_percent_distance,
            isPercent: !!payload.base_percent_distance,
            sizePerLevel: payload.size_per_level,
            leverage: payload.leverage || 20,
            isCrossMargin: payload.is_cross_margin !== false,
            anchor: payload.anchor,
            useAnchor: !!payload.anchor,
            frequency: payload.chase_frequency_min || 5,
            chaseSettings: {
              frequencyRangeMin: payload.chase_frequency_min || 5,
              frequencyRangeMax: payload.chase_frequency_max || 15,
              isPercent: !!payload.base_percent_distance,
              useAnchor: false,
              aggressive: false
            }
          }

          const result = await gridServiceRef.current.startGrid(gridConfig)

          return {
            success: result.success,
            data: result.success ? { 
              grid_id: result.gridId, 
              orders_placed: result.ordersPlaced 
            } : undefined,
            error: result.error
          }
        }

        case 'stop_grid': {
          if (!gridServiceRef.current) {
            return { success: false, error: 'Grid service not initialized' }
          }

          const payload = command.payload as { grid_id: string }
          const result = await gridServiceRef.current.stopGrid(payload.grid_id)

          return {
            success: result.success,
            data: result.success ? { message: `Grid ${payload.grid_id} stopped` } : undefined,
            error: result.error
          }
        }

        case 'modify_order': {
          if (!orderClientRef.current || !user?.wallet_address) {
            return { success: false, error: 'Order client not initialized or no wallet' }
          }

          const payload = command.payload as {
            order_id: number | string
            asset: string
            new_price: number
            new_size: number
            tp_price?: number
            tp_is_market?: boolean
            sl_price?: number
            sl_is_market?: boolean
          }

          const orders = usePositionsStore.getState().orders
          const order = orders.find(o => String(o.oid) === String(payload.order_id))

          if (!order) {
            return { success: false, error: `Order not found: ${payload.order_id}` }
          }

          // Step 1: Cancel the old order first
          const cancelResult = await orderClientRef.current.cancelOrder(String(payload.order_id), payload.asset)
          if (!cancelResult.success) {
            return { success: false, error: `Failed to cancel old order: ${cancelResult.error}` }
          }

          // Step 2: Place new order with updated params
          // Convert LONG/SHORT to BUY/SELL for the API
          const sideStr = order.side as string
          const apiSide: 'buy' | 'sell' = (sideStr === 'LONG' || sideStr === 'BUY') ? 'buy' : 'sell'

          const newOrderResult = await orderClientRef.current.executeTradingOrder({
            asset: payload.asset,
            orderSide: apiSide,
            orderType: 'limit',
            size: payload.new_size,
            price: payload.new_price,
            leverage: 20,
            isCrossMargin: true,
            reduceOnly: order.reduceOnly || false,
            timeInForce: 'GTC',
            tpslEnabled: !!(payload.tp_price || payload.sl_price),
            tpPrice: payload.tp_price || null,
            slPrice: payload.sl_price || null
          })

          return {
            success: newOrderResult.success,
            data: newOrderResult.success ? { 
              message: 'Order modified',
              new_oid: newOrderResult.oid
            } : undefined,
            error: newOrderResult.error
          }
        }

        case 'modify_tpsl': {
          if (!orderClientRef.current || !user?.wallet_address) {
            return { success: false, error: 'Order client not initialized or no wallet' }
          }

          const payload = command.payload as {
            asset: string
            tp_price?: number
            tp_is_market?: boolean
            sl_price?: number
            sl_is_market?: boolean
          }

          const positions = usePositionsStore.getState().positions
          const position = positions.find(p => p.coin === payload.asset)

          if (!position) {
            return { success: false, error: `Position not found for: ${payload.asset}` }
          }

          const result = await orderClientRef.current.setTPSL({
            asset: payload.asset,
            positionSize: Math.abs(position.size),
            side: position.side as 'LONG' | 'SHORT',
            userAddress: user.wallet_address,
            tp: payload.tp_price ? { price: payload.tp_price, isMarket: payload.tp_is_market || false } : undefined,
            sl: payload.sl_price ? { price: payload.sl_price, isMarket: payload.sl_is_market || false } : undefined
          })

          return {
            success: result.success,
            data: result.success ? { message: 'TP/SL modified' } : undefined,
            error: result.error
          }
        }

        case 'chase_order': {
          if (!orderClientRef.current || !chaseServiceRef.current) {
            return { success: false, error: 'Order client or chase service not initialized' }
          }

          const payload = command.payload as {
            asset: string
            side: 'buy' | 'sell'
            size: number
            price: number
            leverage?: number
            tick_distance?: number
            percent_distance?: number
            frequency_min?: number
            frequency_max?: number
            range_price?: number
            range_type?: 'upper' | 'lower'
            aggressive?: boolean
          }

          // Step 1: Place the limit order
          const orderResult = await orderClientRef.current.executeTradingOrder({
            asset: payload.asset,
            orderSide: payload.side,
            size: payload.size,
            price: payload.price,
            orderType: 'limit',
            timeInForce: 'GTC',
            reduceOnly: false,
            leverage: payload.leverage || 20,
            isCrossMargin: true,
            tpslEnabled: false,
            tpPrice: null,
            slPrice: null
          })

          if (!orderResult.success) {
            return { success: false, error: orderResult.error || 'Failed to place order' }
          }

          // Extract order ID
          const oid = orderResult.result?.response?.data?.statuses?.[0]?.resting?.oid
          if (!oid) {
            return { success: false, error: 'Order placed but no OID returned' }
          }

          // Construct order object directly (don't wait for store)
          const botIsHip3 = payload.asset.includes(':')
          const orderForChase = {
            oid: oid,
            coin: payload.asset,
            side: payload.side.toUpperCase() as 'BUY' | 'SELL',
            size: payload.size,
            limitPx: payload.price,
            isPositionTpsl: false,
            reduceOnly: false,
            dex: botIsHip3 ? payload.asset.split(':')[0] : 'main',
            isHip3: botIsHip3
          }

          // Step 2: Start chase immediately
          const chaseSettings: ChaseSettings = {
            tickDistance: payload.tick_distance,
            percentDistance: payload.percent_distance,
            isPercent: !!payload.percent_distance,
            frequencyRangeMin: payload.frequency_min || 10,
            frequencyRangeMax: payload.frequency_max || 20,
            rangePrice: payload.range_price,
            rangeType: payload.range_type,
            useAnchor: false,
            aggressive: payload.aggressive || false
          }

          const chaseResult = await chaseServiceRef.current.startChase(
            String(oid),
            orderForChase as any,
            chaseSettings
          )

          return {
            success: true,
            data: {
              order_id: oid,
              chase_id: chaseResult.chaseId,
              chase_started: chaseResult.success,
              message: chaseResult.success ? 'Order placed and chase started' : `Order placed but chase failed: ${chaseResult.error}`
            }
          }
        }

        case 'get_chases': {
          const payload = command.payload as { asset?: string; chase_id?: string }
          const activeChases = useChaseStore.getState().activeChases

          let chases: any[] = []

          if (payload.chase_id) {
            // Get specific chase
            const chase = activeChases.get(payload.chase_id)
            if (chase) chases = [chase]
          } else if (payload.asset) {
            // Filter by asset
            chases = Array.from(activeChases.values()).filter(c => c.asset === payload.asset)
          } else {
            // Get all active chases
            chases = Array.from(activeChases.values())
          }

          // Format for API response
          const formattedChases = chases.map(c => ({
            chase_id: c.chaseId,
            order_id: c.currentOid,
            original_order_id: c.originalOid,
            asset: c.asset,
            side: c.direction,
            size: c.size,
            original_price: c.originalPrice,
            current_price: c.currentPrice,
            status: c.status,
            modification_count: c.modificationCount,
            ticks_away: c.currentTicksAway,
            best_price: c.currentBestPrice,
            start_time: c.startTime,
            last_modification: c.lastModification,
            settings: {
              tick_distance: c.settings.tickDistance,
              percent_distance: c.settings.percentDistance,
              is_percent: c.settings.isPercent,
              frequency_min: c.settings.frequencyRangeMin,
              frequency_max: c.settings.frequencyRangeMax,
              range_price: c.settings.rangePrice,
              range_type: c.settings.rangeType,
              aggressive: c.settings.aggressive
            }
          }))

          return {
            success: true,
            data: {
              chases: formattedChases,
              count: formattedChases.length
            }
          }
        }

        case 'get_grids': {
          if (!gridServiceRef.current) {
            return { success: false, error: 'Grid service not initialized' }
          }

          const payload = command.payload as { asset?: string; grid_id?: string }
          let grids: any[] = []

          if (payload.grid_id) {
            // Get specific grid
            const grid = gridServiceRef.current.getGrid(payload.grid_id)
            if (grid) grids = [grid]
          } else if (payload.asset) {
            // Filter by asset
            grids = gridServiceRef.current.getGridsForAsset(payload.asset)
          } else {
            // Get all active grids
            grids = gridServiceRef.current.getActiveGrids()
          }

          // Format for API response
          const formattedGrids = grids.map(g => ({
            grid_id: g.gridId,
            asset: g.asset,
            levels: g.levels,
            status: g.status,
            start_time: g.startTime,
            size_per_level: g.sizePerLevel,
            base_tick_distance: g.baseTickDistance,
            base_percent_distance: g.basePercentDistance,
            is_percent: g.isPercent,
            anchor: g.anchor,
            orders: g.orders.map((o: any) => ({
              side: o.side,
              level: o.level,
              oid: o.oid,
              price: o.price,
              chase_id: o.chaseId,
              status: o.status,
              tick_distance: o.tickDistance,
              percent_distance: o.percentDistance
            })),
            order_count: g.orders.length,
            active_orders: g.orders.filter((o: any) => o.status === 'active').length
          }))

          return {
            success: true,
            data: {
              grids: formattedGrids,
              count: formattedGrids.length
            }
          }
        }

        // ====================================================================
        // Alpha Dashboard & Analytics Commands
        // ====================================================================

        case 'get_alpha_data': {
          const payload = command.payload as { symbol: string }
          if (!payload.symbol) {
            return { success: false, error: 'symbol is required' }
          }

          let trackerStore = useTrackerStore.getState()
          
          // Auto-connect if not connected
          if (!trackerStore.isConnected()) {
            log('[BotListener] Tracker not connected, triggering connection...')
            const walletAddress = user?.wallet_address || apiKeys?.hyperliquid?.publicAddress
            if (!walletAddress) {
              return { success: false, error: 'No wallet address available for tracker connection' }
            }
            const connected = await trackerStore.connectTracker(walletAddress)
            if (!connected) {
              return { success: false, error: 'Failed to connect to Alpha Dashboard tracker. Please try again.' }
            }
            // Re-read store after connection
            trackerStore = useTrackerStore.getState()
          }
          
          const symbolData = trackerStore.getSymbolData(payload.symbol.toUpperCase())

          if (!symbolData) {
            return { 
              success: false, 
              error: `No data available for ${payload.symbol}. Available symbols: ${trackerStore.getSymbolList().slice(0, 10).join(', ')}...` 
            }
          }

          // Format comprehensive alpha data
          const price = typeof symbolData.price === 'number' 
            ? symbolData.price 
            : (symbolData.price?.mark || symbolData.price?.current || 0)

          return {
            success: true,
            data: {
              symbol: payload.symbol.toUpperCase(),
              price,
              price_change: symbolData.price_change,
              generated_at: symbolData.generated_at,
              
              // EVFlow signal
              evflow: symbolData.evflow ? {
                score: symbolData.evflow.score,
                signal: symbolData.evflow.signal,
                confidence: symbolData.evflow.confidence,
                aligned: symbolData.evflow.aligned,
                diverging: symbolData.evflow.diverging,
                divergence_warning: symbolData.evflow.divergence_warning,
                components: symbolData.evflow.components
              } : null,

              // Flow Score
              flow_score: symbolData.flow_score ? {
                score: symbolData.flow_score.score,
                signal: symbolData.flow_score.signal,
                confidence: symbolData.flow_score.confidence,
                tier: symbolData.flow_score.tier,
                inputs: symbolData.flow_score.inputs
              } : null,

              // Smart/Dumb CVD
              smart_dumb_cvd: symbolData.smart_dumb_cvd ? {
                divergence_signal: symbolData.smart_dumb_cvd.divergence_signal,
                combined_score: symbolData.smart_dumb_cvd.combined_score,
                labeled_cvd_pct: symbolData.smart_dumb_cvd.labeled_cvd_pct,
                divergence_z: symbolData.smart_dumb_cvd.divergence_z,
                smart_cvd_pct: symbolData.smart_dumb_cvd.smart_cvd_pct,
                dumb_cvd_pct: symbolData.smart_dumb_cvd.dumb_cvd_pct,
                smart_cvd: symbolData.smart_dumb_cvd.smart_cvd,
                dumb_cvd: symbolData.smart_dumb_cvd.dumb_cvd,
                smart_volume: symbolData.smart_dumb_cvd.smart_volume,
                dumb_volume: symbolData.smart_dumb_cvd.dumb_volume,
                total_volume: symbolData.smart_dumb_cvd.total_volume,
                trade_count: symbolData.smart_dumb_cvd.trade_count,
                significance: symbolData.smart_dumb_cvd.significance,
                warm: symbolData.smart_dumb_cvd.warm
              } : null,

              // Multi-Exchange CVD
              cvd: symbolData.cvd ? {
                multi_exchange: symbolData.cvd.multi_exchange,
                hl_cvd_5m: symbolData.cvd.hl_cvd_5m,
                binance_cvd_5m: symbolData.cvd.binance_cvd_5m,
                cvd_divergence: symbolData.cvd.cvd_divergence,
                cvd_divergence_type: symbolData.cvd.cvd_divergence_type
              } : null,

              // Order Flow Metrics
              ofm: symbolData.ofm,

              // Perp Signals (strong signal indicators)
              perp_signals: symbolData.perp_signals,

              // Liquidation Heatmap
              liquidation_heatmap: symbolData.liquidation_heatmap ? {
                most_huntable_long: symbolData.liquidation_heatmap.most_huntable_long,
                most_huntable_short: symbolData.liquidation_heatmap.most_huntable_short,
                long_total_pnl: symbolData.liquidation_heatmap.long_total_pnl,
                short_total_pnl: symbolData.liquidation_heatmap.short_total_pnl,
                smart_long_pnl: symbolData.liquidation_heatmap.smart_long_pnl,
                smart_short_pnl: symbolData.liquidation_heatmap.smart_short_pnl,
                dumb_long_pnl: symbolData.liquidation_heatmap.dumb_long_pnl,
                dumb_short_pnl: symbolData.liquidation_heatmap.dumb_short_pnl,
                long_liquidations_count: symbolData.liquidation_heatmap.long_liquidations?.length || 0,
                short_liquidations_count: symbolData.liquidation_heatmap.short_liquidations?.length || 0,
                // Include top 10 liquidation levels each side
                top_long_liquidations: symbolData.liquidation_heatmap.long_liquidations?.slice(0, 10).map((l: any) => ({
                  price: l.price_bucket || l.price,
                  total_value: l.total_value,
                  total_pnl: l.total_pnl,
                  concentration: l.concentration
                })),
                top_short_liquidations: symbolData.liquidation_heatmap.short_liquidations?.slice(0, 10).map((l: any) => ({
                  price: l.price_bucket || l.price,
                  total_value: l.total_value,
                  total_pnl: l.total_pnl,
                  concentration: l.concentration
                }))
              } : null,

              // Orderbook Heatmap
              orderbook_heatmap: symbolData.orderbook_heatmap || null,

              // Position Alerts
              position_alerts: symbolData.position_alerts ? {
                signal: symbolData.position_alerts.signal,
                alert_count: symbolData.position_alerts.alert_count,
                smart_long: symbolData.position_alerts.smart_long,
                smart_short: symbolData.position_alerts.smart_short,
                dumb_long: symbolData.position_alerts.dumb_long,
                dumb_short: symbolData.position_alerts.dumb_short,
                alerts: symbolData.position_alerts.alerts || []
              } : null,

              // Fragile Wallets
              fragile_wallets: symbolData.fragile_wallets ? {
                count: symbolData.fragile_wallets.count,
                high_sensitivity_count: symbolData.fragile_wallets.high_sensitivity_count,
                wallets: symbolData.fragile_wallets.wallets || []
              } : null,

              // Breakdown tables (hot zone = root level, all = _all variants)
              breakdown: {
                by_label: symbolData.by_label || symbolData.breakdown?.by_label,
                by_cohort: symbolData.by_cohort || symbolData.breakdown?.by_cohort,
                by_size: symbolData.by_size || symbolData.breakdown?.by_size,
                by_label_all: (symbolData as any).by_label_all || symbolData.breakdown?.by_label_all || symbolData.by_label,
                by_cohort_all: (symbolData as any).by_cohort_all || symbolData.breakdown?.by_cohort_all || symbolData.by_cohort,
                by_size_all: (symbolData as any).by_size_all || symbolData.breakdown?.by_size_all || symbolData.by_size,
                hot_zone_pct: symbolData.summary?.hot_zone_pct || symbolData.breakdown?.hot_zone_pct,
                total_positions: symbolData.summary?.total_positions || symbolData.breakdown?.total_positions,
                filtered_positions: symbolData.summary?.filtered_positions || symbolData.breakdown?.filtered_positions,
                avg_leverage: symbolData.breakdown?.avg_leverage || (symbolData as any).summary?.avg_leverage,
                coverage_pct: symbolData.breakdown?.coverage_pct || (symbolData as any).summary?.coverage_pct
              },

              // Funding
              funding: symbolData.funding
            }
          }
        }

        case 'get_signal_details': {
          const payload = command.payload as { signal_id: string }
          if (!payload.signal_id) {
            return { success: false, error: 'signal_id is required' }
          }

          // Find signal in allTrades from SSE
          const signal = allTrades.find(t => t.id === payload.signal_id) as any

          if (!signal) {
            return { success: false, error: `Signal not found: ${payload.signal_id}` }
          }

          // Fetch enhanced data (clusters, positions) from API
          let enhancedData = null
          try {
            const enhancedResponse = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001'}/trade/${payload.signal_id}/enhanced`)
            if (enhancedResponse.ok) {
              const enhancedResult = await enhancedResponse.json()
              if (enhancedResult.success) {
                enhancedData = enhancedResult.data
              }
            }
          } catch (err) {
            log('[BotListener] Could not fetch enhanced data:', err)
          }

          // Return FULL signal data including cascade, bias, indicators, flow, CVD, volume, liquidity
          return {
            success: true,
            data: {
              signal: {
                // Basic signal data
                id: signal.id,
                asset: signal.asset,
                direction: signal.direction,
                entry_price: signal.entry_price,
                target_price: signal.target_price,
                stop_price: signal.stop_price,
                current_price: signal.current_price,
                confidence: signal.confidence,
                reward_risk: signal.reward_risk,
                signal_type: signal.signal_type,
                timestamp: signal.file_timestamp || signal.created_at || signal.timestamp,
                tp_pct: signal.tp_pct,
                sl_pct: signal.sl_pct,
                tp_range: signal.tp_range,
                
                // Cascade data
                overall_cascade_probability: signal.overall_cascade_probability,
                cascade_levels: signal.cascade_levels,
                cascade_reasoning: signal.cascade_reasoning,
                
                // Bias data
                dominant_bias: signal.dominant_bias,
                bias_score: signal.bias_score,
                bias_confidence: signal.bias_confidence,
                
                // Supporting data
                supporting_indicators: signal.supporting_indicators,
                trigger_reason: signal.trigger_reason,
                
                // Flow & CVD
                evflow_signal: signal.evflow_signal,
                evflow_score: signal.evflow_score,
                smart_dumb_signal: signal.smart_dumb_signal,
                smart_dumb_score: signal.smart_dumb_score,
                
                // Volume & Liquidity
                volume_24h: signal.volume_24h,
                liquidity_score: signal.liquidity_score,
                liquidity_rating: signal.liquidity_rating,
                
                // Position sizing
                recommended_size: signal.recommended_size,
                max_leverage: signal.max_leverage,
                
                // Additional metadata
                created_at: signal.created_at,
                file_timestamp: signal.file_timestamp
              },
              // Enhanced data with clusters and individual positions
              enhanced_data: enhancedData
            }
          }
        }

        case 'get_funding_pairs': {
          const payload = command.payload as { limit?: number; min_spread?: number; min_strength?: number }

          // Read from client's funding store
          let fundingStore = useFundingStore.getState()
          
          // Auto-fetch if store is empty
          if (fundingStore.pairs.length === 0) {
            log('[BotListener] Funding store empty, triggering fetch...')
            const success = await fundingStore.fetchFundingData()
            if (!success) {
              return { 
                success: false, 
                error: 'Failed to fetch funding data. Please try again.' 
              }
            }
            // Re-read store after fetch
            fundingStore = useFundingStore.getState()
          }

          let pairs = [...fundingStore.pairs]

          // Apply filters
          if (payload.min_spread) {
            pairs = pairs.filter(p => p.spread_1h_pct >= payload.min_spread!)
          }
          if (payload.min_strength) {
            pairs = pairs.filter(p => p.signal_strength >= payload.min_strength!)
          }
          if (payload.limit) {
            pairs = pairs.slice(0, payload.limit)
          }

          // Get strength class for each pair
          const getStrengthLabel = (s: number) => s >= 4 ? 'VERY_STRONG' : s >= 3 ? 'STRONG' : s >= 2 ? 'MODERATE' : 'WEAK'

          return {
            success: true,
            data: {
              pairs: pairs.map(p => ({
                long_symbol: p.long_symbol,
                short_symbol: p.short_symbol,
                long_rate_1h_pct: p.long_rate_1h_pct,
                short_rate_1h_pct: p.short_rate_1h_pct,
                spread_1h_pct: p.spread_1h_pct,
                annualized_pct: p.annualized_pct,
                signal_strength: p.signal_strength,
                strength_label: getStrengthLabel(p.signal_strength),
                recommendation: p.signal_strength >= 3 ? 'RECOMMENDED' : p.signal_strength >= 2 ? 'CONSIDER' : 'LOW_PRIORITY'
              })),
              count: pairs.length,
              total_pairs_available: fundingStore.pairs.length,
              assets_count: fundingStore.assets.length,
              next_funding: fundingStore.countdown || FundingService.getNextFundingCountdown(),
              last_update: fundingStore.lastFetch?.toISOString() || null,
              // Include top individual assets by rate
              top_positive_rates: fundingStore.assets
                .filter(a => a.rate_1h_pct > 0)
                .sort((a, b) => b.rate_1h_pct - a.rate_1h_pct)
                .slice(0, 10)
                .map(a => ({
                  symbol: a.symbol,
                  rate_1h_pct: a.rate_1h_pct,
                  volume_24h: a.volume_24h
                })),
              top_negative_rates: fundingStore.assets
                .filter(a => a.rate_1h_pct < 0)
                .sort((a, b) => a.rate_1h_pct - b.rate_1h_pct)
                .slice(0, 10)
                .map(a => ({
                  symbol: a.symbol,
                  rate_1h_pct: a.rate_1h_pct,
                  volume_24h: a.volume_24h
                }))
            }
          }
        }

        case 'get_atr': {
          const payload = command.payload as { asset: string; timeframe?: string }
          if (!payload.asset) {
            return { success: false, error: 'asset is required' }
          }

          try {
            const atrData = await atrService.getATR(payload.asset)

            if (!atrData) {
              return { success: false, error: `Could not calculate ATR for ${payload.asset}` }
            }

            // Also get TPSL recommendations for reference
            const tpslLong = atrService.getTPSLSync(payload.asset, atrData.price, true)
            const tpslShort = atrService.getTPSLSync(payload.asset, atrData.price, false)

            return {
              success: true,
              data: {
                asset: payload.asset,
                atr: atrData.atr,
                atr_pct: atrData.atrPct,
                price: atrData.price,
                timestamp: atrData.timestamp,
                // TPSL recommendations based on ATR
                recommendations: {
                  long: {
                    tp: tpslLong.tp,
                    sl: tpslLong.sl,
                    tp_pct: ((tpslLong.tp - atrData.price) / atrData.price * 100).toFixed(2) + '%',
                    sl_pct: ((atrData.price - tpslLong.sl) / atrData.price * 100).toFixed(2) + '%'
                  },
                  short: {
                    tp: tpslShort.tp,
                    sl: tpslShort.sl,
                    tp_pct: ((atrData.price - tpslShort.tp) / atrData.price * 100).toFixed(2) + '%',
                    sl_pct: ((tpslShort.sl - atrData.price) / atrData.price * 100).toFixed(2) + '%'
                  }
                }
              }
            }
          } catch (error: any) {
            return { success: false, error: `ATR calculation failed: ${error.message}` }
          }
        }

        case 'get_symbols': {
          let trackerStore = useTrackerStore.getState()
          
          // Auto-connect if not connected
          if (!trackerStore.isConnected()) {
            log('[BotListener] Tracker not connected for get_symbols, triggering connection...')
            const walletAddress = user?.wallet_address || apiKeys?.hyperliquid?.publicAddress
            if (!walletAddress) {
              return { success: false, error: 'No wallet address available for tracker connection' }
            }
            const connected = await trackerStore.connectTracker(walletAddress)
            if (!connected) {
              return { success: false, error: 'Failed to connect to Alpha Dashboard tracker. Please try again.' }
            }
            trackerStore = useTrackerStore.getState()
          }
          
          const symbols = trackerStore.getSymbolList()

          // Get summary data for each symbol
          const symbolSummaries = symbols.map(symbol => {
            const data = trackerStore.getSymbolData(symbol)
            if (!data) return { symbol, has_data: false }

            const price = typeof data.price === 'number' 
              ? data.price 
              : (data.price?.mark || data.price?.current || 0)

            return {
              symbol,
              has_data: true,
              price,
              evflow_signal: data.evflow?.signal,
              evflow_score: data.evflow?.score,
              smart_dumb_signal: data.smart_dumb_cvd?.divergence_signal,
              flow_score: data.flow_score?.score,
              updated_at: data.generated_at
            }
          })

          return {
            success: true,
            data: {
              symbols: symbolSummaries,
              count: symbols.length,
              connection_state: trackerStore.connectionState
            }
          }
        }

        // ====================================================================
        // Bot Control Commands
        // ====================================================================

        case 'bot_start': {
          const payload = command.payload as { bot: string }
          const store = useAutomationStore.getState()
          const started: string[] = []
          const alreadyRunning: string[] = []

          const startBot = (botKey: string, enableFn: () => void, currentState: boolean) => {
            if (currentState) {
              alreadyRunning.push(botKey)
            } else {
              enableFn()
              started.push(botKey)
            }
          }

          if (payload.bot === 'all' || payload.bot === 'autotrade') {
            startBot('autotrade', () => store.setAutoTradeEnabled(true), store.autoTradeEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'cancel') {
            startBot('cancel', () => store.setCancelBotEnabled(true), store.cancelBotEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'sltp') {
            startBot('sltp', () => store.setSltpBotEnabled(true), store.sltpBotEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'trailing') {
            startBot('trailing', () => store.setTrailingSLEnabled(true), store.trailingSLEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'mm') {
            startBot('mm', () => store.setMmBotEnabled(true), store.mmBotEnabled)
          }

          return {
            success: true,
            data: { started, already_running: alreadyRunning }
          }
        }

        case 'bot_stop': {
          const payload = command.payload as { bot: string }
          const store = useAutomationStore.getState()
          const stopped: string[] = []
          const alreadyStopped: string[] = []

          const stopBot = (botKey: string, disableFn: () => void, currentState: boolean) => {
            if (!currentState) {
              alreadyStopped.push(botKey)
            } else {
              disableFn()
              stopped.push(botKey)
            }
          }

          if (payload.bot === 'all' || payload.bot === 'autotrade') {
            stopBot('autotrade', () => store.setAutoTradeEnabled(false), store.autoTradeEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'cancel') {
            stopBot('cancel', () => store.setCancelBotEnabled(false), store.cancelBotEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'sltp') {
            stopBot('sltp', () => store.setSltpBotEnabled(false), store.sltpBotEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'trailing') {
            stopBot('trailing', () => store.setTrailingSLEnabled(false), store.trailingSLEnabled)
          }
          if (payload.bot === 'all' || payload.bot === 'mm') {
            stopBot('mm', () => store.setMmBotEnabled(false), store.mmBotEnabled)
          }

          return {
            success: true,
            data: { stopped, already_stopped: alreadyStopped }
          }
        }

        case 'bot_status': {
          const store = useAutomationStore.getState()
          
          return {
            success: true,
            data: {
              autotrade: {
                enabled: store.autoTradeEnabled,
                mode: store.activeMode,
                risk_level: store.riskLevel,
                position_size: store.positionSize
              },
              cancel: {
                enabled: store.cancelBotEnabled,
                timeout_minutes: store.cancelTimeout,
                limit_only: store.cancelLimitOnly
              },
              sltp: {
                enabled: store.sltpBotEnabled,
                auto_sl: store.autoSlEnabled,
                auto_tp: store.autoTpEnabled,
                sl_percent: store.defaultSlPercent,
                tp_percent: store.defaultTpPercent
              },
              trailing: {
                enabled: store.trailingSLEnabled,
                profit_trigger: store.trailingProfitTrigger,
                mode: store.trailingMode
              },
              mm: {
                enabled: store.mmBotEnabled,
                pricing_mode: store.mmPricingMode,
                active_pairs: Object.values(store.mmPairSettings).filter((p: any) => p.enabled).length
              }
            }
          }
        }

        // ====================================================================
        // Settings Commands
        // ====================================================================

        case 'get_autotrade_settings': {
          const store = useAutomationStore.getState()
          
          // Build active filters summary
          const activeFilters: string[] = []
          if (store.confidenceEnabled) activeFilters.push(`confidence>=${(store.minConfidence * 100).toFixed(0)}%`)
          if (store.rrEnabled) activeFilters.push(`R:R ${store.minRR}-${store.maxRR}`)
          if (store.tpDistanceEnabled) activeFilters.push(`TP ${store.minTpDistance}-${store.maxTpDistance}%`)
          if (store.slDistanceEnabled) activeFilters.push(`SL ${store.minSlDistance}-${store.maxSlDistance}%`)
          if (store.entryDistanceEnabled) activeFilters.push(`Entry ${store.minEntryDistance}-${store.maxEntryDistance}%`)
          activeFilters.push(`maxLongs:${store.maxLongs}`)
          activeFilters.push(`maxShorts:${store.maxShorts}`)

          // Build signal types
          const signalTypes: string[] = []
          if (store.rangingEnabled) signalTypes.push('ranging')
          if (store.liquidityEnabled) signalTypes.push('liquidity')
          if (store.enhancedEnabled) signalTypes.push('enhanced')
          if (store.v3Enabled) signalTypes.push('v3')

          return {
            success: true,
            data: {
              enabled: store.autoTradeEnabled,
              mode: store.activeMode,
              risk_level: store.riskLevel,
              position_size: store.positionSize,
              active_filters: activeFilters,
              signal_types: signalTypes,
              blacklist: store.blacklistedAssets,
              // Full settings
              settings: {
                confidence: { enabled: store.confidenceEnabled, min: store.minConfidence },
                rr: { enabled: store.rrEnabled, min: store.minRR, max: store.maxRR },
                tp_distance: { enabled: store.tpDistanceEnabled, min: store.minTpDistance, max: store.maxTpDistance },
                sl_distance: { enabled: store.slDistanceEnabled, min: store.minSlDistance, max: store.maxSlDistance },
                entry_distance: { enabled: store.entryDistanceEnabled, min: store.minEntryDistance, max: store.maxEntryDistance },
                position_limits: { max_longs: store.maxLongs, max_shorts: store.maxShorts },
                market_bias: {
                  long: { enabled: store.longBiasEnabled, value: store.longBias },
                  short: { enabled: store.shortBiasEnabled, value: store.shortBias }
                },
                order_sizing: {
                  scale_up: store.scaleUpSize,
                  layering: store.orderLayering,
                  cross_order: store.crossOrder
                }
              }
            }
          }
        }

        case 'set_autotrade_mode': {
          const payload = command.payload as { mode: 'volume' | 'advanced'; risk_level?: number }
          const store = useAutomationStore.getState()

          store.setActiveMode(payload.mode)
          if (payload.mode === 'volume' && payload.risk_level) {
            store.setRiskLevel(payload.risk_level)
          }

          return {
            success: true,
            data: {
              mode: payload.mode,
              risk_level: payload.mode === 'volume' ? (payload.risk_level || store.riskLevel) : null,
              message: `Mode set to ${payload.mode}${payload.mode === 'volume' ? ` (Risk Level ${payload.risk_level || store.riskLevel})` : ''}`
            }
          }
        }

        case 'set_position_size': {
          const payload = command.payload as { size: string }
          const store = useAutomationStore.getState()

          store.setPositionSize(payload.size)

          return {
            success: true,
            data: { position_size: payload.size, message: `Position size set to ${payload.size}` }
          }
        }

        case 'set_advanced_filters': {
          const payload = command.payload as any
          const store = useAutomationStore.getState()
          const updated: string[] = []

          // Apply each provided setting
          if (payload.confidence_enabled !== undefined) { store.setConfidenceEnabled(payload.confidence_enabled); updated.push('confidence_enabled') }
          if (payload.min_confidence !== undefined) { store.setMinConfidence(payload.min_confidence); updated.push('min_confidence') }
          if (payload.rr_enabled !== undefined) { store.setRrEnabled(payload.rr_enabled); updated.push('rr_enabled') }
          if (payload.min_rr !== undefined) { store.setMinRR(payload.min_rr); updated.push('min_rr') }
          if (payload.max_rr !== undefined) { store.setMaxRR(payload.max_rr); updated.push('max_rr') }
          if (payload.tp_distance_enabled !== undefined) { store.setTpDistanceEnabled(payload.tp_distance_enabled); updated.push('tp_distance_enabled') }
          if (payload.min_tp_distance !== undefined) { store.setMinTpDistance(payload.min_tp_distance); updated.push('min_tp_distance') }
          if (payload.max_tp_distance !== undefined) { store.setMaxTpDistance(payload.max_tp_distance); updated.push('max_tp_distance') }
          if (payload.sl_distance_enabled !== undefined) { store.setSlDistanceEnabled(payload.sl_distance_enabled); updated.push('sl_distance_enabled') }
          if (payload.min_sl_distance !== undefined) { store.setMinSlDistance(payload.min_sl_distance); updated.push('min_sl_distance') }
          if (payload.max_sl_distance !== undefined) { store.setMaxSlDistance(payload.max_sl_distance); updated.push('max_sl_distance') }
          if (payload.entry_distance_enabled !== undefined) { store.setEntryDistanceEnabled(payload.entry_distance_enabled); updated.push('entry_distance_enabled') }
          if (payload.min_entry_distance !== undefined) { store.setMinEntryDistance(payload.min_entry_distance); updated.push('min_entry_distance') }
          if (payload.max_entry_distance !== undefined) { store.setMaxEntryDistance(payload.max_entry_distance); updated.push('max_entry_distance') }
          if (payload.max_longs !== undefined) { store.setMaxLongs(payload.max_longs); updated.push('max_longs') }
          if (payload.max_shorts !== undefined) { store.setMaxShorts(payload.max_shorts); updated.push('max_shorts') }
          if (payload.long_bias_enabled !== undefined) { store.setLongBiasEnabled(payload.long_bias_enabled); updated.push('long_bias_enabled') }
          if (payload.short_bias_enabled !== undefined) { store.setShortBiasEnabled(payload.short_bias_enabled); updated.push('short_bias_enabled') }
          if (payload.long_bias !== undefined) { store.setLongBias(payload.long_bias); updated.push('long_bias') }
          if (payload.short_bias !== undefined) { store.setShortBias(payload.short_bias); updated.push('short_bias') }
          if (payload.ranging_enabled !== undefined) { store.setRangingEnabled(payload.ranging_enabled); updated.push('ranging_enabled') }
          if (payload.liquidity_enabled !== undefined) { store.setLiquidityEnabled(payload.liquidity_enabled); updated.push('liquidity_enabled') }
          if (payload.enhanced_enabled !== undefined) { store.setEnhancedEnabled(payload.enhanced_enabled); updated.push('enhanced_enabled') }
          if (payload.v3_enabled !== undefined) { store.setV3Enabled(payload.v3_enabled); updated.push('v3_enabled') }
          if (payload.scale_up_size !== undefined) { store.setScaleUpSize(payload.scale_up_size); updated.push('scale_up_size') }
          if (payload.order_layering !== undefined) { store.setOrderLayering(payload.order_layering); updated.push('order_layering') }
          if (payload.cross_order !== undefined) { store.setCrossOrder(payload.cross_order); updated.push('cross_order') }

          return {
            success: true,
            data: { updated, count: updated.length, message: `Updated ${updated.length} settings` }
          }
        }

        case 'set_blacklist': {
          const payload = command.payload as { action: string; assets?: string[] }
          const store = useAutomationStore.getState()

          switch (payload.action) {
            case 'add':
              if (payload.assets) {
                payload.assets.forEach(asset => store.addToBlacklist(asset))
              }
              break
            case 'remove':
              if (payload.assets) {
                payload.assets.forEach(asset => store.removeFromBlacklist(asset))
              }
              break
            case 'set':
              if (payload.assets) {
                store.setBlacklist(payload.assets)
              }
              break
            case 'clear':
              store.clearBlacklist()
              break
          }

          return {
            success: true,
            data: {
              action: payload.action,
              assets: payload.assets,
              blacklist: useAutomationStore.getState().blacklistedAssets,
              count: useAutomationStore.getState().blacklistedAssets.length
            }
          }
        }

        // ====================================================================
        // Logs Commands
        // ====================================================================

        case 'get_logs': {
          const payload = command.payload as { bot?: string; type?: string; limit?: number; search?: string }
          const store = useAutomationStore.getState()
          
          let logs = [...store.activityLog]

          // Apply filters
          if (payload.bot) {
            logs = logs.filter(log => log.bot === payload.bot)
          }
          if (payload.type) {
            logs = logs.filter(log => log.type === payload.type)
          }
          if (payload.search) {
            const searchLower = payload.search.toLowerCase()
            logs = logs.filter(log => log.message.toLowerCase().includes(searchLower))
          }

          // Apply limit
          const limit = payload.limit || 50
          const total = logs.length
          logs = logs.slice(0, limit)

          // Format for response
          const formattedLogs = logs.map(log => ({
            timestamp: new Date(log.timestamp).toISOString(),
            bot: log.bot,
            type: log.type,
            message: log.message
          }))

          return {
            success: true,
            data: {
              logs: formattedLogs,
              count: formattedLogs.length,
              total,
              filters: { bot: payload.bot, type: payload.type, search: payload.search, limit }
            }
          }
        }

        default:
          return { success: false, error: `Unknown command type: ${command.command_type}` }
      }
    } catch (error: any) {
      console.error('[BotListener] Command execution error:', error)
      return { success: false, error: error.message || 'Execution failed' }
    }
  }, [executeQuickTrade, allTrades, user?.wallet_address])

  // Handle incoming command
  const handleCommand = useCallback(async (command: BotCommand) => {
    log('[BotListener] Received command:', command.id, command.command_type)

    // Mark as received
    await updateCommandStatus(command.id, 'received')

    // Execute
    const result = await executeCommand(command)

    // Update status
    await updateCommandStatus(
      command.id, 
      result.success ? 'executed' : 'failed',
      result
    )

    log('[BotListener] Command result:', result)
  }, [executeCommand, updateCommandStatus])

  // Subscribe to Supabase Realtime
  useEffect(() => {
    if (!user?.privy_id || !apiKeys?.hyperliquid?.apiKey) {
      log('[BotListener] Not ready - missing user or API key')
      return
    }

    // Create Supabase client
    const supabase = getBrowserSupabaseClient()
    supabaseRef.current = supabase

    log('[BotListener] Subscribing to bot_commands for user:', user.privy_id)

    // Subscribe to new commands for this user
    const channel = supabase
      .channel('bot_commands')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bot_commands',
          filter: `user_id=eq.${user.privy_id}`
        },
        (payload) => {
          const command = payload.new as BotCommand
          if (command.status === 'pending') {
            handleCommand(command)
          }
        }
      )
      .subscribe((status) => {
        log('[BotListener] Subscription status:', status)
      })

    // Also check for any pending commands on load
    const checkPendingCommands = async () => {
      const { data: pending } = await supabase
        .from('bot_commands')
        .select('*')
        .eq('user_id', user.privy_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: true })

      if (pending && pending.length > 0) {
        log('[BotListener] Found pending commands:', pending.length)
        for (const cmd of pending) {
          await handleCommand(cmd)
        }
      }
    }

    checkPendingCommands()

    return () => {
      log('[BotListener] Unsubscribing')
      supabase.removeChannel(channel)
    }
  }, [user?.privy_id, apiKeys?.hyperliquid?.apiKey, handleCommand])

  return {
    isListening: !!user?.privy_id && !!apiKeys?.hyperliquid?.apiKey,
    isReady
  }
}
