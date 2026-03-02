import { useChaseStore } from '@/store/useChaseStore'
import { usePositionsStore } from '@/store/usePositionsStore'
import { HyperliquidOrderClient } from './HyperliquidOrderClient'
import { ChaseOrderbookService } from './ChaseOrderbookService'
import { ChaseUtils } from './ChaseUtils'
import { atrService } from './ATRService'
import type { ChaseData, ChaseSettings, OrderbookData, OrderAnalysis } from '@/types/chase'
import type { Order, Position } from '@/types/positions'
import { toast } from 'sonner'

export class ChaseService {
  private orderClient: HyperliquidOrderClient
  private orderbookService: ChaseOrderbookService
  private orderbookListeners: Map<string, (data: OrderbookData) => void> = new Map()
  
  constructor(orderClient: HyperliquidOrderClient) {
    this.orderClient = orderClient
    this.orderbookService = new ChaseOrderbookService()
  }
  
  /**
   * Start chasing an order
   */
  async startChase(
    orderId: string,
    orderData: Order,
    settings: ChaseSettings
  ): Promise<{ success: boolean; chaseId?: string; error?: string }> {
    try {
      // Spot assets don't support chase
      if (orderData.coin.startsWith('@')) {
        return { success: false, error: 'Chase is not supported for spot assets' }
      }

      // Validate settings
      const validation = ChaseUtils.validateSettings(settings)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }
      
      const chaseId = `chase-${orderId}-${Date.now()}`
      
      // Normalize order data
      const normalizedData = {
        asset: orderData.coin,
        side: ChaseUtils.convertSide(orderData.side, 'side_api') as 'B' | 'A',
        size: orderData.size,
        price: orderData.limitPx,
        reduceOnly: orderData.reduceOnly || false
      }
      
      const direction = normalizedData.side === 'B' ? 'LONG' : 'SHORT'
      
      // Cancel existing TP/SL orders for this position
      const cancelledTpSl = await this.cancelTpSlOrders(normalizedData.asset, normalizedData.side)
      
      // Create chase state
      const chaseState: ChaseData = {
        chaseId,
        originalOid: String(orderId),
        currentOid: String(orderId),
        oidHistory: [String(orderId)],
        asset: normalizedData.asset,
        side: normalizedData.side,
        direction,
        size: normalizedData.size,
        originalSize: normalizedData.size,
        sizeHistory: [normalizedData.size],
        originalPrice: normalizedData.price,
        currentPrice: normalizedData.price,
        priceHistory: [normalizedData.price],
        reduceOnly: normalizedData.reduceOnly,
        fillEvents: [],
        missingCount: 0,
        settings,
        status: 'active',
        lastModification: null,
        modificationCount: 0,
        startTime: Date.now(),
        cancelledTpSl,
        isModifying: false
      }
      
      // Get tick size from Hyperliquid metadata (same as GridStrategyService)
      try {
        await (this.orderClient as any).getAssetIndex(normalizedData.asset)
        const szDecimals = (this.orderClient as any).assetSzDecimals
        if (szDecimals !== undefined && szDecimals !== null) {
          const priceDecimals = 6 - szDecimals
          chaseState.tickSize = Math.pow(10, -priceDecimals)
          console.log(`[Chase ${chaseId}] Tick size from metadata: $${chaseState.tickSize} (szDecimals=${szDecimals})`)
        } else {
          chaseState.tickSize = 1 // Safe default
          console.log(`[Chase ${chaseId}] Using default tick size: $1`)
        }
      } catch (e) {
        chaseState.tickSize = 1 // Safe default
        console.log(`[Chase ${chaseId}] Using default tick size: $1`)
      }
      
      // Store in Zustand
      useChaseStore.getState().addChase(chaseState)
      
      console.log(`[Chase ${chaseId}] Starting chase for ${normalizedData.asset} (${direction}) at $${normalizedData.price}`)
      console.log(`[Chase ${chaseId}] Settings:`, {
        tickDistance: settings.tickDistance,
        percentDistance: settings.percentDistance,
        isPercent: settings.isPercent,
        frequencyRange: `${settings.frequencyRangeMin}-${settings.frequencyRangeMax}s`
      })
      
      // Subscribe to orderbook
      await this.connectOrderbook(chaseState)
      console.log(`[Chase ${chaseId}] Subscribed to ${normalizedData.asset} orderbook`)
      
      // Dispatch custom event for UI
      window.dispatchEvent(new CustomEvent('chase-started', {
        detail: { chaseId, orderId, asset: normalizedData.asset }
      }))
      
      return { success: true, chaseId }
      
    } catch (error: any) {
      console.error('[ChaseService] Error starting chase:', error)
      return { success: false, error: error.message }
    }
  }
  
  /**
   * Cancel TP/SL orders for a position
   */
  private async cancelTpSlOrders(asset: string, side: 'B' | 'A'): Promise<any[]> {
    try {
      const orders = usePositionsStore.getState().orders
      const tpslOrders = orders.filter(o => {
        if (o.coin !== asset) return false
        if (!o.reduceOnly && !o.isPositionTpsl) return false
        // Opposite side: if chase is Buy(B), TP/SL are Sell-side
        const oppositeSide = side === 'B'
          ? ['A', 'SELL', 'SHORT'].includes(o.side.toUpperCase())
          : ['B', 'BUY', 'LONG'].includes(o.side.toUpperCase())
        return oppositeSide
      })
      
      const cancelled = []
      for (const order of tpslOrders) {
        const result = await this.orderClient.cancelOrder(String(order.oid), asset)
        if (result.success) {
          cancelled.push(order)
        }
      }
      
      return cancelled
    } catch (error) {
      console.warn('[ChaseService] Error cancelling TP/SL:', error)
      return []
    }
  }
  
  /**
   * Connect to orderbook WebSocket
   */
  private async connectOrderbook(chase: ChaseData) {
    const listener = (data: OrderbookData) => {
      this.handleOrderbookUpdate(chase.chaseId, data)
    }
    
    this.orderbookListeners.set(chase.chaseId, listener)
    await this.orderbookService.subscribe(chase.asset, listener)
  }
  
  /**
   * Handle orderbook update
   */
  private handleOrderbookUpdate(chaseId: string, orderbookData: OrderbookData) {
    const chase = useChaseStore.getState().activeChases.get(chaseId)
    if (!chase || chase.status !== 'active') return
    if (chase.isModifying) return
    
    // Tick size should already be set from metadata in startChase
    // If somehow missing, use safe default of $1
    if (!chase.tickSize) {
      console.log(`[Chase ${chase.chaseId}] Warning: tickSize not set, using $1 default`)
      useChaseStore.getState().updateChase(chaseId, { tickSize: 1 })
    }
    
    // Initialize next check time
    if (!chase.nextCheckTime) {
      const GRACE_PERIOD = chase.settings.gracePeriodMs ?? 30000
      const randomInterval = ChaseUtils.getRandomInterval(chase.settings)
      // Use whichever is longer: grace period or random interval
      const initialInterval = Math.max(GRACE_PERIOD, randomInterval)
      console.log(`[Chase ${chase.chaseId}] Initial check interval: ${initialInterval}ms (grace period: ${GRACE_PERIOD}ms)`)
      useChaseStore.getState().updateChase(chaseId, { nextCheckTime: Date.now() + initialInterval })
      return // Skip first check, wait for interval
    }
    
    // Check if enough time has passed since last modification (like reference code)
    const now = Date.now()
    const timeSinceLastMod = chase.lastModification ? (now - chase.lastModification) : Infinity
    const nextAllowedModTime = chase.nextCheckTime || (now)
    
    if (now < nextAllowedModTime) {
      // Still waiting for delay
      return
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
    console.log(`[Chase ${chase.chaseId}] ⏰ DELAY SATISFIED - Running modification check`)
    console.log(`  Time since last mod: ${(timeSinceLastMod / 1000).toFixed(1)}s`)
    console.log(`  Orderbook: bestBid=$${orderbookData.bestBid}, bestAsk=$${orderbookData.bestAsk}`)
    console.log(`  Spread: $${(orderbookData.bestAsk - orderbookData.bestBid).toFixed(4)}`)
    
    // Analyze order position
    const analysis = this.analyzeOrderPosition(chase, orderbookData)
    
    // Store current analysis for UI display
    useChaseStore.getState().updateChase(chaseId, { 
      currentTicksAway: analysis.ticksAway,
      currentBestPrice: analysis.bestPrice
    })
    
    // Check if modification needed
    if (this.shouldModifyOrder(chase, analysis)) {
      // Execute modification (async but don't await - it handles errors internally)
      this.modifyOrder(chase, analysis, orderbookData).then(() => {
        // Set next allowed modification time (like reference code line 615-625)
        const nextInterval = ChaseUtils.getRandomInterval(chase.settings)
        const nextCheck = Date.now() + nextInterval
        console.log(`[Chase ${chase.chaseId}] ⏱️  Next modification allowed in ${(nextInterval / 1000).toFixed(1)}s`)
        useChaseStore.getState().updateChase(chaseId, { nextCheckTime: nextCheck })
      }).catch((error) => {
        console.error(`[Chase ${chase.chaseId}] Modification error:`, error)
      })
    } else {
      // No modification needed, check again soon
      const nextInterval = ChaseUtils.getRandomInterval(chase.settings)
      const nextCheck = Date.now() + nextInterval
      useChaseStore.getState().updateChase(chaseId, { nextCheckTime: nextCheck })
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`)
  }
  
  /**
   * Analyze order position in orderbook
   */
  private analyzeOrderPosition(chase: ChaseData, orderbookData: OrderbookData): OrderAnalysis {
    const isBuy = chase.side === 'B'
    const levels = isBuy ? orderbookData.bids : orderbookData.asks
    const bestPrice = isBuy ? orderbookData.bestBid : orderbookData.bestAsk
    
    if (levels.length === 0) {
      return { position: -1, ticksAway: 0, bestPrice, isValid: false }
    }
    
    // Find position in queue
    let position = 1
    for (const [price] of levels) {
      if (Math.abs(price - chase.currentPrice) < 0.0001) {
        break
      }
      position++
    }
    
    // Calculate ticks away from best
    const tickSize = chase.tickSize || 0.01
    const ticksAway = Math.abs(chase.currentPrice - bestPrice) / tickSize
    
    return {
      position,
      ticksAway: Math.round(ticksAway),
      bestPrice,
      isValid: true
    }
  }
  
  /**
   * Check if order needs modification
   */
  private shouldModifyOrder(chase: ChaseData, analysis: OrderAnalysis): boolean {
    const isBuy = chase.side === 'B'
    
    console.log(`[Chase ${chase.chaseId}] 🔍 MODIFICATION CHECK:`)
    console.log(`  Current order price: $${chase.currentPrice}`)
    console.log(`  Best ${isBuy ? 'bid' : 'ask'}: $${analysis.bestPrice}`)
    console.log(`  Order position in queue: #${analysis.position}`)
    
    // Skip if already modifying
    if (chase.isModifying) {
      console.log(`  ⏸️  SKIP: Already modifying`)
      return false
    }
    
    // Skip if invalid data or no tick size
    if (!analysis.isValid || !chase.tickSize) {
      console.log(`  ⏸️  SKIP: Invalid data (valid=${analysis.isValid}, tickSize=${chase.tickSize})`)
      return false
    }
    
    // Calculate drift from target
    let actualDistance: number
    let targetDistance: number
    let tolerance: number
    
    if (chase.settings.isPercent && chase.settings.percentDistance) {
      const bestPrice = analysis.bestPrice
      actualDistance = (Math.abs(bestPrice - chase.currentPrice) / bestPrice) * 100
      targetDistance = chase.settings.percentDistance
      tolerance = targetDistance * 0.2 // 20% tolerance
      
      console.log(`  📊 PERCENT MODE:`)
      console.log(`    Target distance: ${targetDistance}%`)
      console.log(`    Actual distance: ${actualDistance.toFixed(3)}%`)
      console.log(`    Tolerance: ±${tolerance.toFixed(3)}%`)
      console.log(`    Drift: ${(Math.abs(actualDistance - targetDistance)).toFixed(3)}%`)
    } else {
      // Both actualDistance and targetDistance are in TICKS (not dollars)
      actualDistance = analysis.ticksAway // Number of ticks from best price
      targetDistance = chase.settings.tickDistance || 10 // Target ticks from settings
      tolerance = 0 // No tolerance - must match exactly
      
      console.log(`  📊 TICK MODE:`)
      console.log(`    Target distance: ${targetDistance} ticks`)
      console.log(`    Actual distance: ${actualDistance} ticks`)
      console.log(`    Drift: ${Math.abs(actualDistance - targetDistance)} ticks`)
    }
    
    const drift = Math.abs(actualDistance - targetDistance)
    const needsModification = drift > tolerance
    
    if (needsModification) {
      console.log(`  ✅ DECISION: MODIFY (drift ${drift.toFixed(3)} > tolerance ${tolerance})`)
    } else {
      console.log(`  ❌ DECISION: NO MODIFY (drift ${drift.toFixed(3)} <= tolerance ${tolerance})`)
    }
    
    return needsModification
  }
  
  /**
   * Modify order (cancel + recreate)
   */
  private async modifyOrder(chase: ChaseData, analysis: OrderAnalysis, orderbookData: OrderbookData) {
    // Set mutex flag
    useChaseStore.getState().updateChase(chase.chaseId, { isModifying: true })
    
    try {
      // Check if client is initialized
      if (!(this.orderClient as any).isInitialized) {
        console.error('[ChaseService] Cannot modify order - client not initialized')
        useChaseStore.getState().updateChase(chase.chaseId, { isModifying: false })
        return
      }
      
      // STEP 1: Verify order still exists
      // Use orders from Zustand store first (already being polled every 2s)
      const allOrders = usePositionsStore.getState().orders
      console.log(`[Chase ${chase.chaseId}] Checking orders from store...`)
      console.log(`  Total orders in store: ${allOrders.length}`)
      console.log(`  Looking for OID: ${chase.currentOid}`)
      
      if (allOrders.length > 0) {
        console.log(`  Sample order:`, { 
          oid: allOrders[0].oid, 
          coin: allOrders[0].coin, 
          side: allOrders[0].side,
          size: allOrders[0].size
        })
      }
      
      let assetOrders = allOrders.filter(o => o.coin === chase.asset)
      console.log(`  Found ${assetOrders.length} orders for ${chase.asset}`)
      
      if (assetOrders.length > 0) {
        console.log(`  ${chase.asset} orders:`, assetOrders.map(o => ({
          oid: o.oid,
          side: o.side,
          size: o.size,
          price: o.limitPx
        })))
      }
      
      let order = ChaseUtils.matchOrder(chase, assetOrders)
      
      // HIP-3 fallback: if order not found in store, query the specific DEX directly
      // Store may not have HIP-3 orders yet due to DEX rotation polling
      if (!order && chase.asset.includes(':')) {
        const dexName = chase.asset.split(':')[0]
        console.log(`[Chase ${chase.chaseId}] Order not in store, querying ${dexName} DEX directly...`)
        try {
          const freshOrders = await this.orderClient.getAllUserOrders(dexName)
          if (freshOrders && Array.isArray(freshOrders)) {
            const mappedOrders = freshOrders.map((o: any) => ({
              oid: o.oid,
              coin: o.coin?.includes(':') ? o.coin : `${dexName}:${o.coin}`,
              side: o.side === 'B' ? 'BUY' : o.side === 'A' ? 'SELL' : o.side,
              size: parseFloat(o.sz || o.size || '0'),
              limitPx: parseFloat(o.limitPx || '0'),
              isPositionTpsl: o.isPositionTpsl || false,
              reduceOnly: o.reduceOnly || false,
              dex: dexName,
              isHip3: true
            })) as Order[]
            assetOrders = mappedOrders.filter(o => o.coin === chase.asset)
            order = ChaseUtils.matchOrder(chase, assetOrders)
            if (order) {
              console.log(`[Chase ${chase.chaseId}] ✅ Found order via direct ${dexName} API call`)
            }
          }
        } catch (e) {
          console.warn(`[Chase ${chase.chaseId}] Direct DEX query failed:`, e)
        }
      }
      
      // Final verification: if still not found, do one last fresh API call before giving up
      if (!order) {
        console.log(`[Chase ${chase.chaseId}] ❌ Order not found, performing FINAL API verification...`)
        try {
          const isHip3 = chase.asset.includes(':')
          let freshOrders: any[]
          if (isHip3) {
            const dexName = chase.asset.split(':')[0]
            freshOrders = await this.orderClient.getAllUserOrders(dexName)
          } else {
            freshOrders = await (this.orderClient as any).getUserOpenOrders?.() 
              || await (this.orderClient as any).infoClient?.openOrders({ user: (this.orderClient as any).wallet?.address })
              || []
          }
          if (freshOrders && Array.isArray(freshOrders)) {
            const matchedFresh = freshOrders.find((o: any) => {
              const oid = String(o.oid)
              return oid === chase.currentOid || chase.oidHistory.includes(oid)
            })
            if (matchedFresh) {
              console.log(`[Chase ${chase.chaseId}] ✅ FINAL CHECK: Order found! OID=${matchedFresh.oid}`)
              const coin = chase.asset
              order = {
                oid: matchedFresh.oid,
                coin,
                side: matchedFresh.side === 'B' ? 'BUY' : matchedFresh.side === 'A' ? 'SELL' : matchedFresh.side,
                size: parseFloat(matchedFresh.sz || matchedFresh.size || '0'),
                limitPx: parseFloat(matchedFresh.limitPx || '0'),
                isPositionTpsl: matchedFresh.isPositionTpsl || false,
                reduceOnly: matchedFresh.reduceOnly || false,
                dex: isHip3 ? coin.split(':')[0] : 'main',
                isHip3
              } as Order
            }
          }
        } catch (e) {
          console.warn(`[Chase ${chase.chaseId}] Final verification failed:`, e)
        }
      }
      
      if (!order) {
        console.log(`  ❌ Order not found after all checks - likely filled`)
        console.log(`  🛑 TERMINATING: Entry order no longer exists`)
        await this.stopChase(chase.chaseId, 'order_filled')
        return
      }
      
      console.log(`  ✅ Order found: OID=${order.oid}, Price=$${order.limitPx}, Size=${order.size}`)
      
      // Store current order size (handles partial fills)
      const currentOrderSize = order.size
      
      // STEP 2: Calculate new price
      const isBuy = chase.side === 'B'
      const bestBid = orderbookData.bestBid
      const bestAsk = orderbookData.bestAsk
      
      console.log(`[Chase ${chase.chaseId}] 💰 PRICE CALCULATION:`)
      console.log(`  Side: ${chase.side}`)

      let rawTarget: number

      if (chase.settings.isPercent && chase.settings.percentDistance) {
        const marketPrice = isBuy ? bestBid : bestAsk
        const percentOffset = chase.settings.percentDistance / 100
        const dollarOffset = marketPrice * percentOffset

        console.log(`  Mode: PERCENT (${chase.settings.percentDistance}%)`)
        console.log(`  Reference: $${marketPrice} (${isBuy ? 'bestBid' : 'bestAsk'})`)
        console.log(`  Offset: $${dollarOffset.toFixed(4)}`)

        rawTarget = isBuy
          ? marketPrice - dollarOffset
          : marketPrice + dollarOffset
      } else {
        // Tick mode - tickDistance is in TICKS, multiply by tickSize to get dollar offset
        const tickCount = chase.settings.tickDistance || 10
        const tickSize = chase.tickSize || 1
        const dollarOffset = tickCount * tickSize

        console.log(`  Mode: TICK (${tickCount} ticks × $${tickSize} = $${dollarOffset})`)
        console.log(`  Reference: $${isBuy ? bestBid : bestAsk} (${isBuy ? 'bestBid' : 'bestAsk'})`)
        console.log(`  Offset: $${dollarOffset.toFixed(4)}`)

        if (chase.settings.aggressive) {
          rawTarget = isBuy
            ? bestAsk + dollarOffset
            : bestBid - dollarOffset
        } else {
          rawTarget = isBuy
            ? bestBid - dollarOffset
            : bestAsk + dollarOffset
        }
      }

      const tickSize = chase.tickSize || 1
      const newPrice = ChaseUtils.roundToTickSize(rawTarget, tickSize)

      if (!newPrice || Number.isNaN(newPrice)) {
        useChaseStore.getState().updateChase(chase.chaseId, { isModifying: false })
        return
      }

      if (chase.settings.rangePrice !== null && chase.settings.rangePrice !== undefined) {
        if (chase.settings.rangeType === 'upper' && newPrice >= chase.settings.rangePrice) {
          await this.stopChase(chase.chaseId, 'price_limit_reached')
          return
        }
        if (chase.settings.rangeType === 'lower' && newPrice <= chase.settings.rangePrice) {
          await this.stopChase(chase.chaseId, 'price_limit_reached')
          return
        }
      }
      
      // STEP 3: Cancel old order
      const cancelResult = await this.orderClient.cancelOrder(String(order.oid), chase.asset)
      if (!cancelResult.success) {
        useChaseStore.getState().updateChase(chase.chaseId, { isModifying: false })
        return
      }
      
      // STEP 4: Place new order using placeChaseOrder (no leverage update - like reference)
      const orderSide = ChaseUtils.convertSide(chase.side, 'side_sdk') as 'buy' | 'sell'
      console.log(`[Chase ${chase.chaseId}] Placing new order: size=${currentOrderSize}, price=$${newPrice}`)
      
      const newOrderResult = await this.orderClient.placeChaseOrder({
        asset: chase.asset,
        side: orderSide,
        price: newPrice,
        size: currentOrderSize,
        reduceOnly: chase.reduceOnly
      })
      
      if (!newOrderResult.success) {
        await this.stopChase(chase.chaseId, 'modification_failed_orphan')
        return
      }
      
      // STEP 5: Check if order filled immediately (placed near best bid/ask)
      if (newOrderResult.filledImmediately) {
        console.log(`[Chase ${chase.chaseId}] ⚡ Order FILLED IMMEDIATELY at $${newPrice}`)
        useChaseStore.getState().updateChase(chase.chaseId, { isModifying: false })
        await this.stopChase(chase.chaseId, 'order_filled')
        return
      }
      
      // STEP 5b: Extract new OID
      const newOid = ChaseUtils.extractOrderId(newOrderResult)
      if (!newOid) {
        console.error(`[Chase ${chase.chaseId}] Failed to extract OID from modification result:`, newOrderResult)
        await this.stopChase(chase.chaseId, 'modification_failed')
        return
      }
      
      console.log(`[Chase ${chase.chaseId}] ✅ Modified order: ${order.oid} -> ${newOid} (price: ${chase.currentPrice} -> ${newPrice})`)
      
      // STEP 6: Update chase state
      const updatedHistory = [...chase.oidHistory, String(newOid)].slice(-5)
      const updatedPriceHistory = [...chase.priceHistory, newPrice].slice(-5)
      
      useChaseStore.getState().updateChase(chase.chaseId, {
        currentOid: String(newOid),
        oidHistory: updatedHistory,
        currentPrice: newPrice,
        priceHistory: updatedPriceHistory,
        modificationCount: chase.modificationCount + 1,
        lastModification: Date.now(),
        missingCount: 0,
        isModifying: false
      })
      
      console.log(`[Chase ${chase.chaseId}] Modification count: ${chase.modificationCount + 1}`)
      
      // Dispatch event
      window.dispatchEvent(new CustomEvent('chase-order-modified', {
        detail: { chaseId: chase.chaseId, oldOid: order.oid, newOid, newPrice }
      }))
      
    } catch (error) {
      console.error('[ChaseService] Error modifying order:', error)
      useChaseStore.getState().updateChase(chase.chaseId, { isModifying: false })
    }
  }
  
  
  /**
   * Handle partial fill
   */
  private handlePartialFill(chase: ChaseData, order: Order, newSize: number) {
    const filled = chase.size - newSize
    
    useChaseStore.getState().updateChase(chase.chaseId, {
      size: newSize,
      sizeHistory: [...chase.sizeHistory, newSize].slice(-5),
      fillEvents: [
        ...chase.fillEvents,
        {
          timestamp: Date.now(),
          filled,
          remaining: newSize
        }
      ]
    })
  }
  
  /**
   * Place TP/SL orders after chase order fills
   * Ported from old chase-tracker.js placeTPSLOnFill
   */
  private async placeTPSLOnFill(chase: ChaseData): Promise<void> {
    try {
      const { asset, side, settings } = chase
      const isBuy = side === 'B'
      
      // Check Zustand store for position data (already polled every 2s)
      const positions = usePositionsStore.getState().positions
      let position = positions.find(p => p.coin === asset)
      
      // HIP-3 fallback: if position not in store, query specific DEX directly
      if (!position && asset.includes(':')) {
        try {
          const walletAddr = (this.orderClient as any).wallet?.address
          if (walletAddr) {
            const posEntry = await this.orderClient.getPositionEntry(asset, walletAddr)
            if (posEntry && Math.abs(posEntry.size) > 0) {
              console.log(`[Chase ${chase.chaseId}] Got HIP-3 position via direct API: entry=$${posEntry.entryPrice}, size=${posEntry.size}`)
              position = {
                coin: asset,
                size: posEntry.size,
                entryPrice: posEntry.entryPrice,
                unrealizedPnl: 0,
                side: posEntry.size > 0 ? 'LONG' : 'SHORT',
                dex: asset.split(':')[0],
                isHip3: true
              } as Position
            }
          }
        } catch (e) {
          console.warn(`[Chase ${chase.chaseId}] HIP-3 position lookup failed:`, e)
        }
      }
      
      let entryPrice: number
      let positionSize: number
      
      if (position && position.entryPrice > 0 && Math.abs(position.size) > 0) {
        entryPrice = position.entryPrice
        positionSize = Math.abs(position.size)
        console.log(`[Chase ${chase.chaseId}] Position from store: entry=$${entryPrice}, size=${positionSize}`)
      } else {
        // Fallback: use chase's last known price and size (position may not be in store yet)
        entryPrice = chase.currentPrice
        positionSize = chase.size
        console.warn(`[Chase ${chase.chaseId}] Position not in store yet, using chase data: entry=$${entryPrice}, size=${positionSize}`)
      }
      
      let tpPrice: number | null = null
      let slPrice: number | null = null
      
      // Check for fixed prices first (Strong Signal passes pre-calculated TP/SL)
      if (settings.tpPrice || settings.slPrice) {
        tpPrice = settings.tpPrice || null
        slPrice = settings.slPrice || null
        console.log(`[Chase ${chase.chaseId}] Using fixed TP/SL: tp=${tpPrice}, sl=${slPrice}`)
      } else {
        // Calculate from ATR multiples
        let atr: number | null = null
        try {
          const atrData = await atrService.getATR(asset)
          if (atrData?.atr) {
            atr = atrData.atr
          }
        } catch (e) {
          console.warn(`[Chase ${chase.chaseId}] ATR fetch failed:`, e)
        }
        
        if (!atr) {
          // Fallback: 1.5% of entry price
          atr = entryPrice * 0.015
          console.warn(`[Chase ${chase.chaseId}] ATR unavailable, using 1.5% fallback: ${atr.toFixed(4)}`)
        }
        
        const tpMultiple = settings.tpAtrMultiple || 2.0
        const slMultiple = settings.slAtrMultiple || 1.5
        
        if (isBuy) {
          tpPrice = entryPrice + (atr * tpMultiple)
          slPrice = entryPrice - (atr * slMultiple)
        } else {
          tpPrice = entryPrice - (atr * tpMultiple)
          slPrice = entryPrice + (atr * slMultiple)
        }
        
        console.log(`[Chase ${chase.chaseId}] ATR-based TP/SL: atr=${atr.toFixed(4)}, tp=$${tpPrice.toFixed(2)} (${tpMultiple}x), sl=$${slPrice.toFixed(2)} (${slMultiple}x)`)
      }
      
      const walletAddress = (this.orderClient as any).wallet?.address || ''
      
      // Place TP/SL via setTPSL (respect limit vs market from UI, default to market)
      const tpIsMarket = settings.tpIsLimit === true ? false : true
      const slIsMarket = settings.slIsLimit === true ? false : true
      
      const result = await this.orderClient.setTPSL({
        asset,
        positionSize,
        side: isBuy ? 'LONG' : 'SHORT',
        userAddress: walletAddress,
        tp: tpPrice ? { price: tpPrice, isMarket: tpIsMarket } : undefined,
        sl: slPrice ? { price: slPrice, isMarket: slIsMarket } : undefined
      })
      
      if (result.success) {
        console.log(`[Chase ${chase.chaseId}] ✅ TP/SL placed: tp=$${tpPrice?.toFixed(2)}, sl=$${slPrice?.toFixed(2)}`)
      } else {
        console.error(`[Chase ${chase.chaseId}] ❌ TP/SL placement failed:`, result.error)
      }
      
    } catch (error) {
      console.error(`[Chase ${chase.chaseId}] Error placing TP/SL on fill:`, error)
    }
  }
  
  /**
   * Stop a chase
   */
  async stopChase(chaseId: string, reason: string): Promise<{ success: boolean }> {
    const chase = useChaseStore.getState().activeChases.get(chaseId)
    if (!chase) return { success: false }
    
    console.log(`[Chase ${chaseId}] 🛑 stopChase CALLED - Reason: ${reason}`)
    console.log(`[Chase ${chaseId}] Call stack:`, new Error().stack)
    console.log(`[Chase ${chaseId}] Final stats - Modifications: ${chase.modificationCount}, Price history: [${chase.priceHistory.join(', ')}]`)
    
    if (reason === 'order_filled') {
      toast.success('Chase filled', { description: `${chase.asset} @ $${chase.currentPrice}` })
    } else if (reason === 'user_stopped') {
      toast.info('Chase stopped', { description: chase.asset })
    } else if (reason === 'price_limit_reached') {
      toast.warning('Chase hit price limit', { description: chase.asset })
    } else if (reason.includes('failed')) {
      toast.error('Chase failed', { description: `${chase.asset}: ${reason}` })
    }
    
    // Place TP/SL only when order actually filled (not on user_stopped, modification_failed, etc.)
    // placeTPSLOnFill verifies position exists on exchange as additional safety
    if (reason === 'order_filled' && chase.settings?.tpslEnabled) {
      if (!chase._tpslPlaced) {
        useChaseStore.getState().updateChase(chaseId, { _tpslPlaced: true })
        try {
          await this.placeTPSLOnFill(chase)
        } catch (error) {
          console.error(`[Chase ${chaseId}] Error placing TP/SL on fill:`, error)
          useChaseStore.getState().updateChase(chaseId, { _tpslPlaced: false })
        }
      } else {
        console.log(`[Chase ${chaseId}] TP/SL already placed, skipping duplicate`)
      }
    }
    
    // Unsubscribe from orderbook
    const listener = this.orderbookListeners.get(chaseId)
    if (listener) {
      await this.orderbookService.unsubscribe(chase.asset, listener)
      this.orderbookListeners.delete(chaseId)
    }
    
    // Update status and move to history
    useChaseStore.getState().updateChase(chaseId, {
      status: 'stopped',
      endTime: Date.now(),
      endReason: reason
    })
    
    useChaseStore.getState().moveToHistory(chaseId)
    
    // Dispatch event
    window.dispatchEvent(new CustomEvent('chase-stopped', {
      detail: { chaseId, reason }
    }))
    
    return { success: true }
  }
  
  /**
   * Cleanup service
   */
  async cleanup() {
    await this.orderbookService.cleanup()
    this.orderbookListeners.clear()
  }
}
