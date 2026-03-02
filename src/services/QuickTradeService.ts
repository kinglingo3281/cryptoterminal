/**
 * Quick Trade Service
 * Handles position size calculation and order execution for AI signals
 * Uses leverage-aware calculation for position sizing
 */

import { HyperliquidOrderClient } from './HyperliquidOrderClient'
import { atrService } from './ATRService'
import { QuickTradeRiskManager } from './QuickTradeRiskManager'
import { hyperliquid } from './hyperliquid'
import { parsePositionSize } from '@/utils/positionSizeParser'
import type { TradeSignal } from '@/hooks/useTradeDataManager'
import type { ChaseSettings } from '@/types/chase'
import type { Order } from '@/types/positions'

const LOG_QUICK_TRADE = false

const log = (...args: unknown[]) => {
  if (LOG_QUICK_TRADE) {
    console.log(...args)
  }
}

const logWarn = (...args: unknown[]) => {
  if (LOG_QUICK_TRADE) {
    console.warn(...args)
  }
}

const logError = (...args: unknown[]) => {
  if (LOG_QUICK_TRADE) {
    console.error(...args)
  }
}

interface QuickTradeResult {
  success: boolean
  orderId?: string
  error?: string
  size?: number
  notional?: number
  leverage?: number
}

export interface QuickTradeOptions {
  autoSlTp?: boolean
  tpPrice?: number | null
  slPrice?: number | null
  enableChase?: boolean
  chaseSettings?: ChaseSettings
  startChase?: (orderId: string, orderData: Order, settings: ChaseSettings) => Promise<{ success: boolean; chaseId?: string; error?: string }>
  userAddress?: string | null
  openPositionsCount?: number
  isClose?: boolean
  overrideSize?: number
  overrideLeverage?: number
}

const DEFAULT_CHASE_SETTINGS: ChaseSettings = {
  tickDistance: 1,
  isPercent: false,
  frequencyRangeMin: 5,
  frequencyRangeMax: 10,
  useAnchor: false,
  aggressive: true,
  gracePeriodMs: 5000
}

export class QuickTradeService {
  private orderClient: HyperliquidOrderClient
  private riskManager?: QuickTradeRiskManager

  constructor(orderClient: HyperliquidOrderClient, riskManager?: QuickTradeRiskManager) {
    this.orderClient = orderClient
    this.riskManager = riskManager
  }

  /**
   * Execute quick trade from AI signal
   * @param signal - Trade signal with entry price, direction, etc.
   * @param accountValue - Current account value in USD
   * @param positionSizeInput - Position size as "2.5%", "$50", etc.
   * @param scaleUpEnabled - Auto-scale to meet $10 minimum
   * @returns Trade result with success status
   */
  async executeQuickTrade(
    signal: TradeSignal,
    accountValue: number,
    positionSizeInput: string = '2.5%',
    scaleUpEnabled: boolean = true,
    options: QuickTradeOptions = {}
  ): Promise<QuickTradeResult> {
    try {
      const normalizedAsset = this.normalizeSymbol(signal.asset)
      log('[QuickTrade] Starting quick trade for:', normalizedAsset)
      log('[QuickTrade] Account value:', accountValue)
      log('[QuickTrade] Position size input:', positionSizeInput)

      // Validate inputs
      if (!signal) {
        return { success: false, error: 'Invalid trade signal' }
      }

      if (!accountValue || accountValue <= 0) {
        return { success: false, error: 'Invalid account value' }
      }

      let entryPrice = signal.entry_price
      if (!entryPrice || entryPrice <= 0) {
        try {
          entryPrice = await this.orderClient.getCurrentMarketPrice(normalizedAsset)
        } catch (error) {
          logError('[QuickTrade] Failed to fetch market price:', error)
        }
      }

      if (!entryPrice || entryPrice <= 0) {
        return { success: false, error: 'Invalid signal entry price' }
      }

      // Calculate order size (or use override from chart widget)
      let sizeResult: { success: boolean; size?: number; notional?: number; leverage?: number; margin?: number; entryPrice?: number; error?: string }

      if (options.overrideSize && options.overrideSize > 0) {
        const leverage = options.overrideLeverage || 20
        const notional = options.overrideSize * entryPrice
        sizeResult = {
          success: true,
          size: parseFloat(options.overrideSize.toPrecision(6)),
          notional,
          leverage,
          margin: notional / leverage,
          entryPrice
        }
        log(`[QuickTrade] Using override size: ${sizeResult.size} ${normalizedAsset} ($${notional.toFixed(2)} notional)`)
      } else {
        sizeResult = await this.calculateOrderSize(
          {
            ...signal,
            asset: normalizedAsset,
            entry_price: entryPrice
          },
          accountValue,
          positionSizeInput,
          scaleUpEnabled
        )
      }

      if (!sizeResult.success || !sizeResult.size) {
        return { success: false, error: sizeResult.error || 'Failed to calculate order size' }
      }

      if (this.riskManager && !options.isClose) {
        this.riskManager.setStartingBalance(accountValue)

        const sizeCheck = this.riskManager.validateSize(sizeResult.margin || 0, accountValue)
        if (!sizeCheck.valid) {
          if (sizeCheck.adjustedSize && sizeCheck.adjustedSize > 0 && sizeResult.entryPrice) {
            const adjustedNotional = sizeCheck.adjustedSize * (sizeResult.leverage || 20)
            const adjustedSize = parseFloat((adjustedNotional / sizeResult.entryPrice).toPrecision(6))
            sizeResult.size = adjustedSize
            sizeResult.notional = adjustedNotional
            sizeResult.margin = sizeCheck.adjustedSize
          } else {
            return { success: false, error: sizeCheck.reason || 'Trade size exceeds risk limits' }
          }
        }

        const allowed = await this.riskManager.canExecute({
          action: options.isClose ? 'close' : 'quick_trade',
          symbol: normalizedAsset,
          size: sizeResult.margin
        })
        if (!allowed.allowed) {
          return { success: false, error: allowed.reason || 'Trade blocked by risk controls' }
        }
      }

      log('[QuickTrade] Calculated size:', sizeResult.size, normalizedAsset)
      log('[QuickTrade] Notional value:', sizeResult.notional)

      // Execute order
      const orderResult = await this.orderClient.executeTradingOrder({
        asset: normalizedAsset,
        orderSide: signal.direction === 'long' ? 'buy' : 'sell',
        size: sizeResult.size,
        price: entryPrice,
        orderType: 'limit',
        timeInForce: 'GTC',
        reduceOnly: false,
        leverage: sizeResult.leverage || 20,
        isCrossMargin: true,
        tpslEnabled: false,
        tpPrice: null,
        slPrice: null
      })

      if (orderResult.success) {
        const status = orderResult.result?.response?.data?.statuses?.[0]
        const oid = orderResult.oid || status?.resting?.oid || status?.filled?.oid
        const wasFilledImmediately = Boolean(status?.filled?.oid)

        if (this.riskManager && oid && !options.isClose) {
          this.riskManager.recordTrade(normalizedAsset, { success: true })
        }

        if (!options.isClose && oid && options.startChase && options.enableChase && !wasFilledImmediately) {
          await this.startChaseTracking(oid, normalizedAsset, signal.direction, sizeResult.size, entryPrice, options)
        }

        if (!options.isClose && (options.autoSlTp || options.tpPrice || options.slPrice)) {
          const address = options.userAddress || this.orderClient.publicAddress
          if (address) {
            void this.scheduleTPSLPlacement({
              asset: normalizedAsset,
              direction: signal.direction,
              userAddress: address,
              tpPrice: options.tpPrice ?? null,
              slPrice: options.slPrice ?? null,
              autoSlTp: Boolean(options.autoSlTp),
              wasFilledImmediately
            })
          }
        }

        return {
          success: true,
          orderId: oid,
          size: sizeResult.size,
          notional: sizeResult.notional,
          leverage: sizeResult.leverage
        }
      } else {
        return {
          success: false,
          error: orderResult.error || 'Order placement failed'
        }
      }
    } catch (error: any) {
      logError('[QuickTrade] Error executing quick trade:', error)
      return { success: false, error: error.message || 'Unknown error' }
    }
  }

  /**
   * Calculate order size using leverage-aware method
   * Uses leverage-aware sizing calculation
   */
  private async calculateOrderSize(
    signal: TradeSignal,
    accountValue: number,
    positionSizeInput: string,
    scaleUpEnabled: boolean
  ): Promise<{ success: boolean; size?: number; notional?: number; leverage?: number; margin?: number; entryPrice?: number; error?: string }> {
    try {
      // STEP 0: Use signal.entry_price (limit price) for size calculation
      // Quick trades place LIMIT orders at signal.entry_price, so we must calculate size using that price
      // Otherwise: calc with current price ($9) but execute at limit ($11) = wrong notional
      const entryPrice = parseFloat(String(signal.entry_price));
      log(`[QuickTrade] Using limit price for ${signal.asset}: $${entryPrice}`);

      if (!entryPrice || entryPrice <= 0 || isNaN(entryPrice)) {
        return { success: false, error: `Invalid entry price: ${entryPrice}` }
      }

      // STEP 1: Parse position size
      const parsed = parsePositionSize(positionSizeInput)
      log('[QuickTrade] Parsed position size:', parsed)

      // STEP 2: Calculate MARGIN amount (what user is risking)
      let marginAmount: number

      if (parsed.type === 'percentage') {
        marginAmount = (accountValue * parsed.value) / 100
        log(`[QuickTrade] Margin (% mode): $${accountValue.toFixed(2)} × ${parsed.value}% = $${marginAmount.toFixed(2)}`)
      } else {
        marginAmount = parsed.value
        log(`[QuickTrade] Margin ($ mode): $${marginAmount.toFixed(2)}`)

        // Validation: Don't exceed account balance
        if (marginAmount > accountValue) {
          const originalMargin = marginAmount
          marginAmount = accountValue * 0.95 // Cap at 95%
          logWarn(`[QuickTrade] Margin $${originalMargin.toFixed(2)} exceeds account, capped to $${marginAmount.toFixed(2)}`)
        }
      }

      // STEP 3: Get asset's max leverage
      let maxLeverage = 20 // Default

      try {
        const assetMetadata = await hyperliquid.getAssetMetadata()
        const assetData = assetMetadata.find(a => a.name === signal.asset)
        
        if (assetData?.maxLeverage) {
          maxLeverage = assetData.maxLeverage
          log(`[QuickTrade] Found leverage for ${signal.asset}: ${maxLeverage}x`)
        } else {
          logWarn(`[QuickTrade] No leverage data for ${signal.asset}, using default 20x`)
        }
      } catch (error) {
        logWarn('[QuickTrade] Failed to fetch leverage, using default 20x:', error)
      }

      // Validate leverage minimum
      if (!maxLeverage || maxLeverage < 3) {
        logWarn(`[QuickTrade] Invalid leverage ${maxLeverage}x, using default 20x`)
        maxLeverage = 20
      }

      // STEP 4: Calculate NOTIONAL value
      let notionalAmount = marginAmount * maxLeverage
      let finalMargin = marginAmount

      log(`[QuickTrade] Notional: $${marginAmount.toFixed(2)} margin × ${maxLeverage}x = $${notionalAmount.toFixed(2)}`)

      // STEP 5: Scale up check (ensure notional meets Hyperliquid's $10 minimum)
      if (scaleUpEnabled && notionalAmount < 10.00) {
        const originalNotional = notionalAmount
        notionalAmount = 13.00 // $13 buffer for safety
        finalMargin = notionalAmount / maxLeverage
        log(`[QuickTrade] Scaled up: $${originalNotional.toFixed(2)} → $${notionalAmount.toFixed(2)} notional`)
        log(`[QuickTrade] New margin: $${finalMargin.toFixed(2)}`)
      }

      // STEP 6: Convert notional to asset quantity
      const assetSize = notionalAmount / entryPrice
      const finalSize = parseFloat(assetSize.toPrecision(6))

      log(`[QuickTrade] Final size: $${notionalAmount.toFixed(2)} / $${entryPrice} = ${finalSize} ${signal.asset}`)

      return {
        success: true,
        size: finalSize,
        notional: notionalAmount,
        leverage: maxLeverage,
        margin: finalMargin,
        entryPrice
      }
    } catch (error: any) {
      logError('[QuickTrade] Error calculating order size:', error)
      return { success: false, error: error.message || 'Calculation error' }
    }
  }

  private normalizeSymbol(symbol: string): string {
    if (!symbol) return symbol
    if (symbol.includes(':')) {
      const [dex, asset] = symbol.split(':')
      if (!dex || !asset) return symbol
      return `${dex.toLowerCase()}:${asset}`
    }
    return symbol
  }

  private async startChaseTracking(
    orderId: string,
    asset: string,
    direction: 'long' | 'short',
    size: number,
    price: number,
    options: QuickTradeOptions
  ) {
    const isHip3 = asset.includes(':')
    const orderForChase: Order = {
      oid: Number(orderId),
      coin: asset,
      side: direction === 'long' ? 'BUY' : 'SELL',
      size,
      limitPx: price,
      isPositionTpsl: false,
      reduceOnly: false,
      dex: isHip3 ? asset.split(':')[0] : 'main',
      isHip3
    }

    const settings = options.chaseSettings ?? DEFAULT_CHASE_SETTINGS

    const chaseResult = await options.startChase?.(orderId, orderForChase, settings)
    if (!chaseResult?.success) {
      console.warn(`[QuickTrade] Chase failed for ${asset}: ${chaseResult?.error || 'unknown error'}`)
    }
  }

  private async scheduleTPSLPlacement(params: {
    asset: string
    direction: 'long' | 'short'
    userAddress: string
    tpPrice: number | null
    slPrice: number | null
    autoSlTp: boolean
    wasFilledImmediately: boolean
  }) {
    const { asset, userAddress } = params

    const posEntry = await this.waitForPositionEntry(asset, userAddress, params.wasFilledImmediately ? 5 : 30)
    if (!posEntry) {
      console.warn(`[QuickTrade] TP/SL skipped - position not confirmed for ${asset}`)
      return
    }

    let tp = params.tpPrice
    let sl = params.slPrice

    if ((!tp || !sl) && params.autoSlTp) {
      const tpsl = await atrService.getTPSLRounded(asset, posEntry.entryPrice, posEntry.side === 'LONG')
      tp = tp || tpsl.tp
      sl = sl || tpsl.sl
    }

    if (!tp && !sl) {
      return
    }

    await this.orderClient.setTPSL({
      asset,
      positionSize: posEntry.size,
      side: posEntry.side,
      userAddress,
      tp: tp ? { price: tp, isMarket: false } : undefined,
      sl: sl ? { price: sl, isMarket: true } : undefined
    })
  }

  private async waitForPositionEntry(asset: string, userAddress: string, attempts = 10): Promise<{ entryPrice: number; size: number; side: 'LONG' | 'SHORT' } | null> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const entry = await this.orderClient.getPositionEntry(asset, userAddress)
      if (entry && entry.size > 0) {
        return entry
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    return null
  }
}
