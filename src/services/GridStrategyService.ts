/**
 * Grid Strategy Service
 * Creates multiple chase orders at different tick/percent distances
 * Grid strategy implementation in TypeScript
 */

import { HyperliquidOrderClient } from './HyperliquidOrderClient'
import type { GridConfig, GridState, GridOrder, GridResult } from '@/types/grid'
import type { ChaseSettings } from '@/types/chase'
import { toast } from 'sonner'

interface ChaseTracker {
  startChase: (orderId: string, orderData: any, settings: ChaseSettings) => Promise<any>
  stopChase: (chaseId: string) => Promise<any>
}

export class GridStrategyService {
  private orderClient: HyperliquidOrderClient
  private chaseTracker: ChaseTracker
  private activeGrids: Map<string, GridState> = new Map()
  private assetLocks: Set<string> = new Set()

  constructor(orderClient: HyperliquidOrderClient, chaseTracker: ChaseTracker) {
    this.orderClient = orderClient
    this.chaseTracker = chaseTracker
  }

  async startGrid(config: GridConfig): Promise<GridResult> {
    // Spot assets don't support grid strategy
    if (config.asset.startsWith('@')) {
      return { success: false, error: 'EV Grid is not supported for spot assets' }
    }

    // Check for existing grid on this asset
    if (this.assetLocks.has(config.asset)) {
      return { success: false, error: `Grid already running for ${config.asset}` }
    }

    // Validate config
    const validation = this.validateConfig(config)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Set asset lock
    this.assetLocks.add(config.asset)

    try {
      const gridId = `grid-${Date.now()}`

      const gridState: GridState = {
        gridId,
        asset: config.asset,
        levels: config.levels,
        baseTickDistance: config.baseTickDistance,
        basePercentDistance: config.basePercentDistance,
        isPercent: config.isPercent,
        sizePerLevel: config.sizePerLevel,
        anchor: config.anchor,
        chaseSettings: config.chaseSettings,
        orders: [],
        status: 'active',
        startTime: Date.now()
      }

      // Get current market prices
      const prices = await this.getMarketPrices(config.asset)
      if (!prices) {
        return { success: false, error: 'Failed to get market prices' }
      }

      const { bestBid, bestAsk, mid } = prices
      const anchor = config.anchor || mid

      // Validate anchor is within ±10% of mid
      const anchorDeviation = Math.abs(anchor - mid) / mid
      if (anchorDeviation > 0.10) {
        return {
          success: false,
          error: `Anchor price ${anchor.toFixed(2)} is ${(anchorDeviation * 100).toFixed(1)}% from market. Max: 10%`
        }
      }

      // Build orders to place
      const ordersToPlace: Array<{ asset: string; side: 'buy' | 'sell'; price: number; size: number }> = []
      const orderMeta: Array<{ side: 'buy' | 'sell'; level: number; price: number; distance: number }> = []

      for (let level = 1; level <= config.levels; level++) {
        let buyPrice: number, sellPrice: number, distance: number

        if (config.isPercent && config.basePercentDistance) {
          const percentDistance = config.basePercentDistance * level
          distance = percentDistance
          buyPrice = this.roundToTickSize(bestBid * (1 - percentDistance / 100))
          sellPrice = this.roundToTickSize(bestAsk * (1 + percentDistance / 100))
        } else {
          const tickDistance = config.baseTickDistance * level
          distance = tickDistance
          const tickSize = await this.getTickSize(config.asset, bestBid, bestAsk)
          buyPrice = this.roundToTickSize(bestBid - (tickDistance * tickSize))
          sellPrice = this.roundToTickSize(bestAsk + (tickDistance * tickSize))
        }

        // BUY order
        ordersToPlace.push({ asset: config.asset, side: 'buy', price: buyPrice, size: config.sizePerLevel })
        orderMeta.push({ side: 'buy', level, price: buyPrice, distance })

        // SELL order
        ordersToPlace.push({ asset: config.asset, side: 'sell', price: sellPrice, size: config.sizePerLevel })
        orderMeta.push({ side: 'sell', level, price: sellPrice, distance })
      }

      console.log(`[GRID] Starting grid ${gridId} for ${config.asset} with ${ordersToPlace.length} orders`)

      // Batch place all orders
      const placedOrders = await this.batchPlaceOrders(ordersToPlace, config.leverage, config.isCrossMargin)

      // Wait for orders to settle
      await new Promise(resolve => setTimeout(resolve, 500))

      // Start chase for each placed order
      for (let i = 0; i < placedOrders.length; i++) {
        const placedOrder = placedOrders[i]
        const meta = orderMeta[i]

        if (!placedOrder.oid) {
          console.warn(`[GRID] No OID for order ${i}, skipping`)
          continue
        }

        // Start chase with grid-specific settings
        const chaseSettings: ChaseSettings = {
          ...config.chaseSettings,
          tickDistance: config.isPercent ? undefined : meta.distance,
          percentDistance: config.isPercent ? meta.distance : undefined,
          isPercent: config.isPercent,
          useAnchor: config.useAnchor,
          anchorPrice: config.anchor,
          aggressive: false // EVgrid always uses passive mode
        }

        const gridIsHip3 = config.asset.includes(':')
        const chase = await this.chaseTracker.startChase(
          placedOrder.oid,
          {
            oid: parseInt(placedOrder.oid),
            coin: config.asset,
            side: meta.side === 'buy' ? 'BUY' : 'SELL',
            size: config.sizePerLevel,
            limitPx: meta.price,
            isPositionTpsl: false,
            reduceOnly: false,
            dex: gridIsHip3 ? config.asset.split(':')[0] : 'main',
            isHip3: gridIsHip3
          } as any,
          chaseSettings
        )

        if (chase?.success) {
          gridState.orders.push({
            side: meta.side,
            level: meta.level,
            tickDistance: config.isPercent ? undefined : meta.distance,
            percentDistance: config.isPercent ? meta.distance : undefined,
            isPercent: config.isPercent,
            oid: placedOrder.oid,
            price: meta.price,
            chaseId: chase.chaseId,
            status: 'active'
          })
        } else {
          console.warn(`[GRID] Failed to start chase for order ${placedOrder.oid}`)
        }
      }

      if (gridState.orders.length === 0) {
        return { success: false, error: 'Failed to place any orders' }
      }

      this.activeGrids.set(gridId, gridState)

      console.log(`[GRID] Grid ${gridId} started with ${gridState.orders.length} orders`)

      return { success: true, gridId, ordersPlaced: gridState.orders.length }

    } catch (error: any) {
      console.error('[GRID] Error starting grid:', error)
      return { success: false, error: error.message }
    } finally {
      this.assetLocks.delete(config.asset)
    }
  }

  async stopGrid(gridId: string): Promise<{ success: boolean; error?: string }> {
    const grid = this.activeGrids.get(gridId)
    if (!grid) {
      return { success: false, error: 'Grid not found' }
    }

    grid.status = 'stopping'

    try {
      // Stop all chase instances
      for (const order of grid.orders) {
        if (order.chaseId && order.status === 'active') {
          await this.chaseTracker.stopChase(order.chaseId)
        }
      }

      grid.status = 'stopped'
      this.activeGrids.delete(gridId)
      this.assetLocks.delete(grid.asset)

      console.log(`[GRID] Grid ${gridId} stopped`)
      toast.info('Grid stopped', { description: grid.asset })

      return { success: true }
    } catch (error: any) {
      console.error('[GRID] Error stopping grid:', error)
      return { success: false, error: error.message }
    }
  }

  private async getMarketPrices(asset: string): Promise<{ bestBid: number; bestAsk: number; mid: number } | null> {
    try {
      // Use HIP-3-safe getBestBidAsk which handles orderbook fallback for HIP-3 assets
      const result = await this.orderClient.getBestBidAsk(asset)
      return result
    } catch (error) {
      console.error('[GRID] Error getting market prices:', error)
      return null
    }
  }

  private async getTickSize(asset: string, bestBid: number, bestAsk: number): Promise<number> {
    try {
      // Get szDecimals from metadata
      await (this.orderClient as any).getAssetIndex(asset)
      const szDecimals = (this.orderClient as any).assetSzDecimals

      if (szDecimals !== undefined && szDecimals !== null) {
        const priceDecimals = 6 - szDecimals
        return Math.pow(10, -priceDecimals)
      }
    } catch (e) {
      console.warn('[GRID] Could not get szDecimals, using fallback')
    }

    // Fallback: calculate from bid/ask
    const bidStr = String(bestBid)
    const askStr = String(bestAsk)
    const bidDecimals = bidStr.includes('.') ? bidStr.split('.')[1].length : 0
    const askDecimals = askStr.includes('.') ? askStr.split('.')[1].length : 0
    const decimals = Math.max(bidDecimals, askDecimals)
    return Math.pow(10, -decimals)
  }

  private roundToTickSize(price: number): number {
    // Use orderClient's rounding if available
    if (typeof (this.orderClient as any).roundToTickSize === 'function') {
      return (this.orderClient as any).roundToTickSize(price)
    }
    // Fallback: round to 6 decimals
    return Math.round(price * 1000000) / 1000000
  }

  private async batchPlaceOrders(
    orders: Array<{ asset: string; side: 'buy' | 'sell'; price: number; size: number }>,
    leverage: number,
    isCrossMargin: boolean
  ): Promise<Array<{ oid: string | null; price: number; side: 'buy' | 'sell'; size: number }>> {
    const results: Array<{ oid: string | null; price: number; side: 'buy' | 'sell'; size: number }> = []

    // Place orders sequentially (batch API not available in client)
    for (const order of orders) {
      try {
        const result = await this.orderClient.executeTradingOrder({
          asset: order.asset,
          orderSide: order.side,
          size: order.size,
          price: order.price,
          orderType: 'limit',
          timeInForce: 'GTC',
          reduceOnly: false,
          leverage: leverage,
          isCrossMargin: isCrossMargin,
          tpslEnabled: false,
          tpPrice: null,
          slPrice: null
        })

        const oid = result.result?.response?.data?.statuses?.[0]?.resting?.oid ||
                     result.result?.response?.data?.statuses?.[0]?.filled?.oid

        results.push({ oid: oid || null, price: order.price, side: order.side, size: order.size })
      } catch (error) {
        console.error('[GRID] Error placing order:', error)
        results.push({ oid: null, price: order.price, side: order.side, size: order.size })
      }
    }

    return results
  }

  private validateConfig(config: GridConfig): { valid: boolean; error?: string } {
    if (!config.asset || typeof config.asset !== 'string') {
      return { valid: false, error: 'Asset is required' }
    }

    if (![3, 6, 10].includes(config.levels)) {
      return { valid: false, error: 'Levels must be 3, 6, or 10' }
    }

    if (config.sizePerLevel <= 0) {
      return { valid: false, error: 'Size per level must be greater than 0' }
    }

    if (config.isPercent) {
      if (!config.basePercentDistance || config.basePercentDistance <= 0 || config.basePercentDistance > 10) {
        return { valid: false, error: 'Percent distance must be between 0 and 10%' }
      }
    } else {
      if (config.baseTickDistance <= 0) {
        return { valid: false, error: 'Tick distance must be greater than 0' }
      }
    }

    return { valid: true }
  }

  // Public getters for bot API
  getActiveGrids(): GridState[] {
    return Array.from(this.activeGrids.values())
  }

  getGrid(gridId: string): GridState | null {
    return this.activeGrids.get(gridId) || null
  }

  getGridsForAsset(asset: string): GridState[] {
    return Array.from(this.activeGrids.values()).filter(g => g.asset === asset)
  }
}
