import { FundingPair } from '@/types/funding'
import { atrService } from '@/services/ATRService'
import { HyperliquidOrderClient } from '@/services/HyperliquidOrderClient'
import { FundingService } from '@/services/FundingService'
import { useChaseStore } from '@/store/useChaseStore'
import type { Order } from '@/types/positions'
import type { ChaseSettings } from '@/types/chase'
import { parseRiskInput, calculateLegSizes, usdToAssetSize } from '@/utils/pairsRiskUtils'

const CHASE_TIMEOUT_MS = 60000
const INITIAL_PERCENT_OFFSET = 0
const HIP3_PERCENT_OFFSET = 0.15
const MIN_PAIR_SIZE = 10

const DEFAULT_CHASE_SETTINGS: ChaseSettings = {
  tickDistance: 5,
  isPercent: false,
  frequencyRangeMin: 5,
  frequencyRangeMax: 5,
  useAnchor: false,
  aggressive: true,
  gracePeriodMs: 5000
}

type PairDirection = 'LONG' | 'SHORT'

type ExecutionState = {
  executionId: string
  symbolA: string
  symbolB: string
  directionA: PairDirection
  directionB: PairDirection
  sizeA: number
  sizeB: number
  priceA: number
  priceB: number
  currentOidA?: string
  currentOidB?: string
  legAFilled: number
  legBFilled: number
  status: 'EXECUTING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'
}

export type FundingPairTradeResult = {
  success: boolean
  status?: 'COMPLETED' | 'PARTIAL'
  executionId?: string
  error?: string
}

type PlaceLegResult =
  | { success: true; orderId: string; limitPrice: number }
  | { success: false; error?: string }

export class FundingPairTradeExecutor {
  private orderClient: HyperliquidOrderClient
  private startChase: (orderId: string, orderData: Order, settings: ChaseSettings) => Promise<{ success: boolean; chaseId?: string; error?: string }>
  private activeExecutions = new Map<string, ExecutionState>()

  constructor(
    orderClient: HyperliquidOrderClient,
    startChase: (orderId: string, orderData: Order, settings: ChaseSettings) => Promise<{ success: boolean; chaseId?: string; error?: string }>
  ) {
    this.orderClient = orderClient
    this.startChase = startChase
  }

  async executeFundingPairTrade(params: {
    pair: FundingPair
    pairSize: number
    walletBalance: number
    userAddress: string
    hedgeRatio?: number
    timeframe?: '1h' | '1m'
    autoSlTp?: boolean
  }): Promise<FundingPairTradeResult> {
    const { pair, pairSize, walletBalance, userAddress } = params

    if (!pairSize || pairSize < MIN_PAIR_SIZE) {
      return { success: false, error: `Minimum size is $${MIN_PAIR_SIZE} per leg` }
    }

    const executionId = `funding_${Date.now()}`
    let atrAValue: number | null = null
    let atrBValue: number | null = null

    try {
      const symbolA = pair.long_symbol
      const symbolB = pair.short_symbol
      const directionA: PairDirection = 'LONG'
      const directionB: PairDirection = 'SHORT'
      const hedgeRatio = params.hedgeRatio ?? 1.0

      if (params.autoSlTp !== false) {
        const [atrA, atrB] = await Promise.all([
          atrService.getATR(symbolA),
          atrService.getATR(symbolB)
        ])

        if (atrA?.atr && atrB?.atr) {
          atrAValue = atrA.atr
          atrBValue = atrB.atr
        }
      }

      const totalRisk = parseRiskInput(`$${pairSize}`, walletBalance)
      const { legA, legB } = calculateLegSizes(totalRisk, hedgeRatio)

      const priceA = await this.orderClient.getCurrentMarketPrice(symbolA)
      const priceB = await this.orderClient.getCurrentMarketPrice(symbolB)

      if (!priceA || !priceB) {
        throw new Error('Failed to fetch prices')
      }

      const sizeA = usdToAssetSize(legA, priceA)
      const sizeB = usdToAssetSize(legB, priceB)

      if (!sizeA || sizeA <= 0 || !Number.isFinite(sizeA)) {
        throw new Error(`Invalid size for ${symbolA}: ${sizeA}`)
      }
      if (!sizeB || sizeB <= 0 || !Number.isFinite(sizeB)) {
        throw new Error(`Invalid size for ${symbolB}: ${sizeB}`)
      }

      const execution: ExecutionState = {
        executionId,
        symbolA,
        symbolB,
        directionA,
        directionB,
        sizeA,
        sizeB,
        priceA,
        priceB,
        legAFilled: 0,
        legBFilled: 0,
        status: 'EXECUTING'
      }

      this.activeExecutions.set(executionId, execution)

      const resultA = await this.placeLegOrder(symbolA, directionA, sizeA, priceA)
      const resultB = await this.placeLegOrder(symbolB, directionB, sizeB, priceB)

      if (!resultA.success || !resultB.success) {
        const errors: string[] = []
        if (!resultA.success) errors.push(`${symbolA}: ${resultA.error || 'unknown'}`)
        if (!resultB.success) errors.push(`${symbolB}: ${resultB.error || 'unknown'}`)

        if (resultA.success && resultA.orderId) {
          await this.cancelOrderWithRetry(symbolA, resultA.orderId)
          await this.closeOrphanedPosition(symbolA, userAddress)
        }
        if (resultB.success && resultB.orderId) {
          await this.cancelOrderWithRetry(symbolB, resultB.orderId)
          await this.closeOrphanedPosition(symbolB, userAddress)
        }

        throw new Error(`Failed to place legs: ${errors.join(', ')}`)
      }

      execution.currentOidA = resultA.orderId
      execution.currentOidB = resultB.orderId

      if (resultA.orderId) {
        await this.startLegChase(resultA.orderId, symbolA, directionA, sizeA, resultA.limitPrice)
      }
      if (resultB.orderId) {
        await this.startLegChase(resultB.orderId, symbolB, directionB, sizeB, resultB.limitPrice)
      }

      const monitored = await this.monitorExecution(execution, userAddress)

      if (monitored.status === 'COMPLETED') {
        if (atrAValue && atrBValue) {
          await this.placeSkewedSlTp(monitored, userAddress, params.timeframe || '1h', atrAValue, atrBValue)
        }
        await this.persistHistory(pair, monitored, userAddress, pairSize)
      }

      this.activeExecutions.delete(executionId)

      return {
        success: monitored.status === 'COMPLETED' || monitored.status === 'PARTIAL',
        status: monitored.status === 'COMPLETED' ? 'COMPLETED' : 'PARTIAL',
        executionId
      }
    } catch (error: any) {
      console.error('[FundingPairTradeExecutor] Error:', error)
      this.activeExecutions.delete(executionId)
      return { success: false, error: error.message || 'Execution failed' }
    }
  }

  private async placeLegOrder(
    symbol: string,
    direction: PairDirection,
    size: number,
    price: number
  ): Promise<PlaceLegResult> {
    const orderSide = direction === 'LONG' ? 'buy' : 'sell'
    const isHip3 = symbol.includes(':')
    const offset = isHip3 ? HIP3_PERCENT_OFFSET / 100 : INITIAL_PERCENT_OFFSET
    const limitPrice = orderSide === 'buy'
      ? price * (1 - offset)
      : price * (1 + offset)

    const result = await this.orderClient.executeTradingOrder({
      asset: symbol,
      orderSide,
      size,
      price: limitPrice,
      orderType: 'limit',
      timeInForce: 'GTC',
      reduceOnly: false,
      leverage: null,
      isCrossMargin: true,
      tpslEnabled: false,
      tpPrice: null,
      slPrice: null
    })

    if (!result?.success) {
      return { success: false, error: result?.error || 'Order placement failed' }
    }

    const orderId = this.extractOrderId(result)
    if (!orderId) {
      return { success: false, error: 'Order placed but no OID returned' }
    }

    return { success: true, orderId, limitPrice }
  }

  private extractOrderId(result: any): string | null {
    return (
      result?.oid ||
      result?.result?.response?.data?.statuses?.[0]?.resting?.oid ||
      result?.result?.response?.data?.statuses?.[0]?.filled?.oid ||
      result?.orderId ||
      null
    )?.toString() || null
  }

  private async startLegChase(orderId: string, symbol: string, direction: PairDirection, size: number, price: number) {
    const isHip3 = symbol.includes(':')
    const orderForChase: Order = {
      oid: Number(orderId),
      coin: symbol,
      side: direction === 'LONG' ? 'BUY' : 'SELL',
      size,
      limitPx: price,
      isPositionTpsl: false,
      reduceOnly: false,
      dex: isHip3 ? symbol.split(':')[0] : 'main',
      isHip3
    }

    const settings: ChaseSettings = {
      ...DEFAULT_CHASE_SETTINGS,
      isPercent: false
    }

    const chaseResult = await this.startChase(orderId, orderForChase, settings)
    if (!chaseResult.success) {
      console.warn(`[FundingPairTradeExecutor] Chase failed for ${symbol}: ${chaseResult.error}`)
    }
  }

  private async monitorExecution(execution: ExecutionState, userAddress: string): Promise<ExecutionState> {
    const startTime = Date.now()

    while (Date.now() - startTime < CHASE_TIMEOUT_MS) {
      const chaseStore = useChaseStore.getState()

      const chaseA = execution.currentOidA
        ? chaseStore.getChaseForOrder(String(execution.currentOidA))
        : null
      const chaseB = execution.currentOidB
        ? chaseStore.getChaseForOrder(String(execution.currentOidB))
        : null

      if (!chaseA && execution.legAFilled === 0) {
        const posA = await this.verifyPosition(execution.symbolA, execution.directionA, userAddress)
        if (posA) {
          execution.legAFilled = posA.size
        }
      }

      if (!chaseB && execution.legBFilled === 0) {
        const posB = await this.verifyPosition(execution.symbolB, execution.directionB, userAddress)
        if (posB) {
          execution.legBFilled = posB.size
        }
      }

      if (execution.legAFilled >= execution.sizeA * 0.99 && execution.legBFilled >= execution.sizeB * 0.99) {
        execution.status = 'COMPLETED'
        return execution
      }

      await this.sleep(1000)
    }

    execution.status = 'PARTIAL'

    const [posA, posB] = await Promise.all([
      this.orderClient.getPositionEntry(execution.symbolA, userAddress),
      this.orderClient.getPositionEntry(execution.symbolB, userAddress)
    ])

    const legAFilled = !!posA
    const legBFilled = !!posB

    if (legAFilled && !legBFilled) {
      if (execution.currentOidB) {
        await this.cancelOrderWithRetry(execution.symbolB, execution.currentOidB)
      }
      await this.closeOrphanedPosition(execution.symbolA, userAddress)
    } else if (!legAFilled && legBFilled) {
      if (execution.currentOidA) {
        await this.cancelOrderWithRetry(execution.symbolA, execution.currentOidA)
      }
      await this.closeOrphanedPosition(execution.symbolB, userAddress)
    }

    return execution
  }

  private async verifyPosition(symbol: string, direction: PairDirection, userAddress: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const entry = await this.orderClient.getPositionEntry(symbol, userAddress)
      if (entry && entry.side === direction && entry.size > 0) {
        return entry
      }
      await this.sleep(1000)
    }

    return null
  }

  private async placeSkewedSlTp(
    execution: ExecutionState,
    userAddress: string,
    timeframe: '1h' | '1m',
    atrAValue: number,
    atrBValue: number
  ) {
    const [posA, posB] = await Promise.all([
      this.orderClient.getPositionEntry(execution.symbolA, userAddress),
      this.orderClient.getPositionEntry(execution.symbolB, userAddress)
    ])

    if (!posA || !posB) {
      console.warn('[FundingPairTradeExecutor] Positions missing, skipping SL/TP')
      return
    }

    const atrMult = timeframe === '1m' ? 0.5 : 1.5

    const distanceA = atrAValue * atrMult
    const distanceB = atrBValue * atrMult

    const tpA = execution.directionA === 'LONG' ? posA.entryPrice + distanceA : posA.entryPrice - distanceA
    const slA = execution.directionA === 'LONG' ? posA.entryPrice - distanceA : posA.entryPrice + distanceA
    const tpB = execution.directionB === 'LONG' ? posB.entryPrice + distanceB : posB.entryPrice - distanceB
    const slB = execution.directionB === 'LONG' ? posB.entryPrice - distanceB : posB.entryPrice + distanceB

    await Promise.all([
      this.orderClient.setTPSL({
        asset: execution.symbolA,
        positionSize: posA.size,
        side: execution.directionA,
        userAddress,
        tp: { price: tpA, isMarket: false },
        sl: { price: slA, isMarket: false }
      }),
      this.orderClient.setTPSL({
        asset: execution.symbolB,
        positionSize: posB.size,
        side: execution.directionB,
        userAddress,
        tp: { price: tpB, isMarket: false },
        sl: { price: slB, isMarket: false }
      })
    ])
  }

  private async persistHistory(pair: FundingPair, execution: ExecutionState, userAddress: string, tradeSize: number) {
    const history = FundingService.loadHistory()
    const exists = history.pairs.some((p: any) =>
      p.longSymbol === execution.symbolA &&
      p.shortSymbol === execution.symbolB &&
      p.status === 'ACTIVE'
    )

    if (exists) {
      return
    }

    const [posA, posB] = await Promise.all([
      this.orderClient.getPositionEntry(execution.symbolA, userAddress),
      this.orderClient.getPositionEntry(execution.symbolB, userAddress)
    ])

    if (!posA || !posB) {
      return
    }

    history.pairs.push({
      id: `${execution.symbolA}-${execution.symbolB}-${Date.now()}`,
      longSymbol: execution.symbolA,
      shortSymbol: execution.symbolB,
      longRate: pair.long_rate_1h_pct || 0,
      shortRate: pair.short_rate_1h_pct || 0,
      spread: pair.spread_1h_pct || 0,
      spreadAnnualized: pair.annualized_pct || 0,
      signalStrength: pair.signal_strength || 0,
      longPosition: {
        actualSymbol: execution.symbolA,
        size: posA.size,
        entryPrice: posA.entryPrice,
        direction: 'LONG'
      },
      shortPosition: {
        actualSymbol: execution.symbolB,
        size: posB.size,
        entryPrice: posB.entryPrice,
        direction: 'SHORT'
      },
      tradeSize,
      openedAt: Date.now(),
      status: 'ACTIVE',
      lastVerified: Date.now(),
      verificationAttempts: 0,
      closedAt: null
    })

    FundingService.saveHistory(history)
  }

  private async cancelOrderWithRetry(symbol: string, orderId: string, maxAttempts = 4) {
    let lastError: any = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.orderClient.cancelOrder(orderId, symbol)
        if (result?.success !== false) {
          return result
        }
        lastError = new Error(result?.error || 'Cancel returned false')
      } catch (error) {
        lastError = error
      }

      if (attempt < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
        await this.sleep(delay)
      }
    }

    console.error(`[FundingPairTradeExecutor] Failed to cancel ${symbol} order ${orderId}:`, lastError?.message)
    return { success: false, error: lastError?.message }
  }

  private async closeOrphanedPosition(symbol: string, userAddress: string) {
    try {
      const result = await this.orderClient.closePosition(symbol, userAddress)
      if (!result.success) {
        console.error(`[FundingPairTradeExecutor] Failed to close ${symbol}:`, result.error)
      }
      return result
    } catch (error: any) {
      console.error(`[FundingPairTradeExecutor] Error closing ${symbol}:`, error)
      return { success: false, error: error.message }
    }
  }

  private async sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}
