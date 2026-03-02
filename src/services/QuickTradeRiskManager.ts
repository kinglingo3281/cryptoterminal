export type QuickTradeRiskCheck = {
  allowed: boolean
  reason?: string
  type?: string
  remainingMs?: number
}

export type QuickTradeRiskState = {
  globalCooldownRemaining: number
  globalCooldownTotal: number
  circuitBreakerTripped: boolean
  circuitBreakerRemaining: number
  consecutiveLosses: number
  maxConsecutiveLosses: number
  tradesLastMinute: number
  tradesLastHour: number
  maxTradesPerMinute: number
  maxTradesPerHour: number
  dailyPnL: number
  dailyLossPercent: number
  maxDailyLossPercent: number
  startingBalance: number
  maxSizeDollars: number
  maxAccountPercent: number
  confirmThreshold: number
  maxOpenPositions: number
}

type TradeRecord = {
  timestamp: number
  symbol: string
  success: boolean
  pnl?: number
}

export class QuickTradeRiskManager {
  // Position size limits
  private maxSizeDollars = 50
  private maxAccountPercent = 0.1
  private confirmThreshold = 30

  // Cooldown settings
  private globalCooldownMs = 3000
  private perSymbolCooldownMs = 10000
  private afterLossCooldownMs = 30000

  // Rate limits
  private maxTradesPerMinute = 10
  private maxTradesPerHour = 50

  // Circuit breaker settings
  private maxConsecutiveLosses = 3
  private circuitBreakerPauseMs = 30 * 60 * 1000

  // Daily loss limit
  private maxDailyLossPercent = 5

  // Max positions
  private maxOpenPositions = 5

  // State tracking
  private lastGlobalTrade = 0
  private lastSymbolTrades = new Map<string, number>()
  private tradeHistory: TradeRecord[] = []
  private consecutiveLosses = 0
  private circuitBreakerTripped = false
  private circuitBreakerTripTime: number | null = null
  private todayDate: string | null = null
  private dailyPnL = 0
  private startingBalance = 0

  constructor() {
    this.resetDailyIfNeeded()
  }

  async canExecute(request: { action?: string; symbol?: string; size?: number }): Promise<QuickTradeRiskCheck> {
    this.resetDailyIfNeeded()

    if (this.circuitBreakerTripped) {
      const elapsed = Date.now() - (this.circuitBreakerTripTime || 0)
      if (elapsed < this.circuitBreakerPauseMs) {
        const remaining = Math.ceil((this.circuitBreakerPauseMs - elapsed) / 60000)
        return {
          allowed: false,
          reason: `Circuit breaker active. ${remaining} minutes remaining.`,
          type: 'circuit_breaker'
        }
      }
      this.resetCircuitBreaker()
    }

    const now = Date.now()
    const timeSinceLastTrade = now - this.lastGlobalTrade
    if (timeSinceLastTrade < this.globalCooldownMs) {
      const remaining = Math.ceil((this.globalCooldownMs - timeSinceLastTrade) / 1000)
      return {
        allowed: false,
        reason: `Cooldown: wait ${remaining}s`,
        type: 'global_cooldown',
        remainingMs: this.globalCooldownMs - timeSinceLastTrade
      }
    }

    const symbol = this.normalizeSymbol(request.symbol || '')
    const lastSymbolTrade = this.lastSymbolTrades.get(symbol) || 0
    const timeSinceSymbol = now - lastSymbolTrade
    if (symbol !== 'UNKNOWN' && timeSinceSymbol < this.perSymbolCooldownMs) {
      const remaining = Math.ceil((this.perSymbolCooldownMs - timeSinceSymbol) / 1000)
      return {
        allowed: false,
        reason: `${symbol} cooldown: wait ${remaining}s`,
        type: 'symbol_cooldown',
        remainingMs: this.perSymbolCooldownMs - timeSinceSymbol
      }
    }

    const recentTrades = this.tradeHistory.filter(t => now - t.timestamp < 60000)
    if (recentTrades.length >= this.maxTradesPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit: max ${this.maxTradesPerMinute} trades/minute`,
        type: 'rate_limit'
      }
    }

    const hourlyTrades = this.tradeHistory.filter(t => now - t.timestamp < 3600000)
    if (hourlyTrades.length >= this.maxTradesPerHour) {
      return {
        allowed: false,
        reason: `Rate limit: max ${this.maxTradesPerHour} trades/hour`,
        type: 'rate_limit'
      }
    }

    if (this.startingBalance > 0) {
      const dailyLossPercent = Math.abs(Math.min(0, this.dailyPnL)) / this.startingBalance * 100
      if (dailyLossPercent >= this.maxDailyLossPercent) {
        return {
          allowed: false,
          reason: `Daily loss limit reached (${dailyLossPercent.toFixed(1)}%)`,
          type: 'daily_loss_limit'
        }
      }
    }

    return { allowed: true }
  }

  recordTrade(symbol: string, result: { success: boolean; pnl?: number }) {
    const normalizedSymbol = this.normalizeSymbol(symbol)
    const now = Date.now()

    this.lastGlobalTrade = now
    this.lastSymbolTrades.set(normalizedSymbol, now)

    this.tradeHistory.push({
      timestamp: now,
      symbol: normalizedSymbol,
      success: result.success,
      pnl: result.pnl
    })

    if (this.tradeHistory.length > 1000) {
      this.tradeHistory.shift()
    }

    if (result.pnl !== undefined && result.pnl < 0) {
      this.consecutiveLosses += 1
      this.dailyPnL += result.pnl

      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.tripCircuitBreaker('Consecutive losses limit reached')
      }

      this.lastGlobalTrade = now + this.afterLossCooldownMs - this.globalCooldownMs
    } else if (result.pnl !== undefined && result.pnl > 0) {
      this.consecutiveLosses = 0
      this.dailyPnL += result.pnl
    }
  }

  tripCircuitBreaker(reason: string) {
    this.circuitBreakerTripped = true
    this.circuitBreakerTripTime = Date.now()
    console.warn(`[RISK-MANAGER] Circuit breaker TRIPPED: ${reason}`)
  }

  resetCircuitBreaker() {
    this.circuitBreakerTripped = false
    this.circuitBreakerTripTime = null
    this.consecutiveLosses = 0
    console.log('[RISK-MANAGER] Circuit breaker RESET')
  }

  resetDailyIfNeeded() {
    const today = new Date().toDateString()
    if (this.todayDate !== today) {
      this.todayDate = today
      this.dailyPnL = 0
      console.log('[RISK-MANAGER] Daily tracking reset')
    }
  }

  setStartingBalance(balance: number) {
    if (!balance || balance <= 0) return
    this.startingBalance = balance
  }

  requiresConfirmation(sizeUsd: number): boolean {
    return sizeUsd > this.confirmThreshold
  }

  validateSize(sizeUsd: number, accountBalance: number): { valid: boolean; reason?: string; adjustedSize?: number } {
    const maxByPercent = accountBalance * this.maxAccountPercent
    const effectiveMax = Math.min(this.maxSizeDollars, maxByPercent)

    if (sizeUsd > effectiveMax) {
      return {
        valid: false,
        reason: `Size $${sizeUsd.toFixed(2)} exceeds limit $${effectiveMax.toFixed(0)}`,
        adjustedSize: effectiveMax
      }
    }

    return { valid: true }
  }

  getRiskState(): QuickTradeRiskState {
    const now = Date.now()
    const globalCooldownRemaining = Math.max(0, this.globalCooldownMs - (now - this.lastGlobalTrade))

    let circuitBreakerRemaining = 0
    if (this.circuitBreakerTripped && this.circuitBreakerTripTime) {
      circuitBreakerRemaining = Math.max(0, this.circuitBreakerPauseMs - (now - this.circuitBreakerTripTime))
    }

    const tradesLastMinute = this.tradeHistory.filter(t => now - t.timestamp < 60000).length
    const tradesLastHour = this.tradeHistory.filter(t => now - t.timestamp < 3600000).length

    const dailyLossPercent = this.startingBalance > 0
      ? (this.dailyPnL / this.startingBalance * 100)
      : 0

    return {
      globalCooldownRemaining,
      globalCooldownTotal: this.globalCooldownMs,
      circuitBreakerTripped: this.circuitBreakerTripped,
      circuitBreakerRemaining,
      consecutiveLosses: this.consecutiveLosses,
      maxConsecutiveLosses: this.maxConsecutiveLosses,
      tradesLastMinute,
      tradesLastHour,
      maxTradesPerMinute: this.maxTradesPerMinute,
      maxTradesPerHour: this.maxTradesPerHour,
      dailyPnL: this.dailyPnL,
      dailyLossPercent,
      maxDailyLossPercent: this.maxDailyLossPercent,
      startingBalance: this.startingBalance,
      maxSizeDollars: this.maxSizeDollars,
      maxAccountPercent: this.maxAccountPercent * 100,
      confirmThreshold: this.confirmThreshold,
      maxOpenPositions: this.maxOpenPositions
    }
  }

  getSymbolCooldown(symbol: string): { symbol: string; remaining: number; total: number; ready: boolean } {
    const normalizedSymbol = this.normalizeSymbol(symbol)
    const lastTrade = this.lastSymbolTrades.get(normalizedSymbol) || 0
    const elapsed = Date.now() - lastTrade
    const remaining = Math.max(0, this.perSymbolCooldownMs - elapsed)

    return {
      symbol: normalizedSymbol,
      remaining,
      total: this.perSymbolCooldownMs,
      ready: remaining === 0
    }
  }

  normalizeSymbol(symbol: string): string {
    if (!symbol) return 'UNKNOWN'

    if (symbol.includes(':')) {
      return symbol.split(':')[1].toUpperCase()
    }

    if (symbol.includes('-')) {
      return symbol.split('-')[1].toUpperCase()
    }

    return symbol.toUpperCase()
  }

  updateConfig(config: Partial<{
    maxSizeDollars: number
    maxAccountPercent: number
    globalCooldownMs: number
    perSymbolCooldownMs: number
    maxConsecutiveLosses: number
    maxDailyLossPercent: number
    confirmThreshold: number
  }>) {
    if (config.maxSizeDollars !== undefined) this.maxSizeDollars = config.maxSizeDollars
    if (config.maxAccountPercent !== undefined) this.maxAccountPercent = config.maxAccountPercent
    if (config.globalCooldownMs !== undefined) this.globalCooldownMs = config.globalCooldownMs
    if (config.perSymbolCooldownMs !== undefined) this.perSymbolCooldownMs = config.perSymbolCooldownMs
    if (config.maxConsecutiveLosses !== undefined) this.maxConsecutiveLosses = config.maxConsecutiveLosses
    if (config.maxDailyLossPercent !== undefined) this.maxDailyLossPercent = config.maxDailyLossPercent
    if (config.confirmThreshold !== undefined) this.confirmThreshold = config.confirmThreshold

    console.log('[RISK-MANAGER] Configuration updated:', config)
  }
}

export const quickTradeRiskManager = new QuickTradeRiskManager()
