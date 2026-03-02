/**
 * ExploreService - Aggregates wallet data from TrackerService across all symbols
 * Runs in background on app start, builds leaderboard data for Explore page
 */

import { trackerService } from './TrackerService'
import type { SymbolData, BreakdownEntry } from '@/store/useTrackerStore'

export interface ExploreWallet {
  address: string
  name?: string
  label?: string
  cohort?: string
  sizeCohort?: string
  pnl: number
  pnlPercent?: number
  equity: number
  totalNotional: number
  trades?: number
  winRate?: number
  leverage: number
  maxDrawdown?: number
  symbols: string[]
  side?: 'LONG' | 'SHORT' | 'MIXED'
  lastSeen?: Date
  // Position details for expandable view
  entry?: number
  liq?: number
  holdingTime?: number
}

export interface ExploreData {
  // Aggregated leaderboards
  topTraders: ExploreWallet[]
  smartMoney: ExploreWallet[]
  dumbMoney: ExploreWallet[]
  whales: ExploreWallet[]
  
  // By cohort (PNL tiers)
  byCohort: Record<string, ExploreWallet[]>
  
  // By equity size
  bySize: Record<string, ExploreWallet[]>
  
  // Metadata
  lastUpdate: Date | null
  symbolsProcessed: number
  isLoading: boolean
  error: string | null
}

type ExploreCallback = (data: ExploreData) => void

// Skill labels that indicate "smart money"
const SMART_LABELS = ['LEGEND', 'ELITE', 'SKILLED', 'SOLID', 'GRINDER', 'SURVIVOR']
const DUMB_LABELS = ['WEAK', 'BLEEDING', 'LOSER', 'REKT', 'WRECKED']

// Cohort groupings
const COHORT_GROUPS = {
  'extremely-profitable': ['Money Printer'],
  'very-profitable': ['Smart Money'],
  'profitable': ['Consistent Grinder'],
  'slightly-profitable': ['Humble Earner'],
  'slightly-unprofitable': ['Exit Liquidity'],
  'unprofitable': ['Semi-Rekt'],
  'very-unprofitable': ['Full Rekt'],
  'rekt': ['Giga-Rekt']
}

// Size groupings - stored lowercase for case-insensitive matching
const SIZE_GROUPS: Record<string, string[]> = {
  'kraken': ['>$2.5m'],
  'large-whale': ['$1m-$2.5m', '$500k-$1m', '$500k-$2.5m'],
  'whale': ['$250k-$500k'],
  'small-whale': ['$100k-$250k'],
  'apex-predator': ['$50k-$100k'],
  'dolphin': ['$25k-$50k', '$10k-$25k', '$10k-$50k'],
  'fish': ['$1k-$10k'],
  'shrimp': ['<$1k']
}

// Reverse lookup: API key -> our group key
const SIZE_KEY_TO_GROUP: Record<string, string> = {}
for (const [groupKey, apiKeys] of Object.entries(SIZE_GROUPS)) {
  for (const apiKey of apiKeys) {
    SIZE_KEY_TO_GROUP[apiKey.toLowerCase()] = groupKey
  }
}

// Compute size cohort from equity value
function computeSizeCohort(equity: number): string {
  if (equity >= 2500000) return '>$2.5m'
  if (equity >= 1000000) return '$1m-$2.5m'
  if (equity >= 500000) return '$500k-$1m'
  if (equity >= 250000) return '$250k-$500k'
  if (equity >= 100000) return '$100k-$250k'
  if (equity >= 50000) return '$50k-$100k'
  if (equity >= 25000) return '$25k-$50k'
  if (equity >= 10000) return '$10k-$25k'
  if (equity >= 1000) return '$1k-$10k'
  return '<$1k'
}

class ExploreService {
  private data: ExploreData = {
    topTraders: [],
    smartMoney: [],
    dumbMoney: [],
    whales: [],
    byCohort: {},
    bySize: {},
    lastUpdate: null,
    symbolsProcessed: 0,
    isLoading: false,
    error: null
  }
  
  private callbacks: Set<ExploreCallback> = new Set()
  private walletMap: Map<string, ExploreWallet> = new Map()
  private aggregateInterval: ReturnType<typeof setInterval> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private isRunning = false
  private retryCount = 0
  private maxRetries = 10
  private retryDelayMs = 5000
  private aggregateIntervalMs = 30000 // Re-aggregate every 30s
  
  constructor() {
    // Will be started by AppInitializer
  }
  
  /**
   * Start background aggregation - called on app init
   */
  start() {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[ExploreService] Starting background aggregation...')
    this.scheduleAggregate()
  }
  
  /**
   * Stop background aggregation
   */
  stop() {
    this.isRunning = false
    if (this.aggregateInterval) {
      clearInterval(this.aggregateInterval)
      this.aggregateInterval = null
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
  }
  
  /**
   * Subscribe to data updates
   */
  subscribe(callback: ExploreCallback): () => void {
    this.callbacks.add(callback)
    // Immediately send current data
    callback(this.data)
    return () => this.callbacks.delete(callback)
  }
  
  /**
   * Get current data snapshot
   */
  getData(): ExploreData {
    return { ...this.data }
  }
  
  /**
   * Schedule aggregation with retry logic
   */
  private scheduleAggregate() {
    // Initial aggregate
    this.aggregate()
    
    // Set up periodic re-aggregation
    this.aggregateInterval = setInterval(() => {
      this.aggregate()
    }, this.aggregateIntervalMs)
  }
  
  /**
   * Main aggregation logic - processes all symbols from TrackerService
   */
  private async aggregate() {
    const symbols = trackerService.getAllSymbols()
    
    if (symbols.size === 0) {
      // TrackerService not ready yet, retry
      this.retryCount++
      if (this.retryCount <= this.maxRetries) {
        console.log(`[ExploreService] No symbols yet, retry ${this.retryCount}/${this.maxRetries} in ${this.retryDelayMs/1000}s`)
        this.retryTimeout = setTimeout(() => this.aggregate(), this.retryDelayMs)
      } else {
        this.data.error = 'TrackerService not responding'
        this.notifyCallbacks()
      }
      return
    }
    
    this.retryCount = 0
    this.data.isLoading = true
    this.data.error = null
    this.notifyCallbacks()
    
    try {
      // Clear previous aggregation
      this.walletMap.clear()
      
      // Process symbols in batches to avoid blocking
      const symbolEntries = Array.from(symbols.entries())
      const batchSize = 10
      
      for (let i = 0; i < symbolEntries.length; i += batchSize) {
        const batch = symbolEntries.slice(i, i + batchSize)
        
        for (const [symbol, symbolData] of batch) {
          this.processSymbol(symbol, symbolData)
        }
        
        // Yield to event loop between batches
        if (i + batchSize < symbolEntries.length) {
          await new Promise(resolve => setTimeout(resolve, 0))
        }
      }
      
      // Build final leaderboards
      this.buildLeaderboards()
      
      this.data.symbolsProcessed = symbols.size
      this.data.lastUpdate = new Date()
      this.data.isLoading = false
      
      console.log(`[ExploreService] Aggregated ${this.walletMap.size} wallets from ${symbols.size} symbols`)
      
    } catch (error: any) {
      console.error('[ExploreService] Aggregation error:', error)
      this.data.error = error.message
      this.data.isLoading = false
    }
    
    this.notifyCallbacks()
  }
  
  /**
   * Process a single symbol's data
   */
  private processSymbol(symbol: string, data: SymbolData) {
    // Process breakdown tables (by_label, by_cohort, by_size)
    this.processBreakdown(symbol, data.by_label || data.breakdown?.by_label, 'label')
    this.processBreakdown(symbol, data.by_cohort || data.breakdown?.by_cohort, 'cohort')
    this.processBreakdown(symbol, data.by_size || data.breakdown?.by_size, 'size')
    
    // Process fragile wallets
    if (data.fragile_wallets?.wallets) {
      for (const fw of data.fragile_wallets.wallets as any[]) {
        this.upsertWallet({
          address: fw.wallet,
          label: fw.label,
          pnl: fw.total_pnl || 0,
          equity: fw.account_value || 0,
          totalNotional: fw.total_notional || 0,
          leverage: fw.account_value > 0 ? (fw.total_notional / fw.account_value) : 0,
          symbol
        })
      }
    }
    
    // Process liquidation heatmap wallets
    if (data.liquidation_heatmap) {
      const processLiqWallets = (levels: any[], side: 'LONG' | 'SHORT') => {
        for (const level of levels || []) {
          for (const w of level.top_wallets || []) {
            this.upsertWallet({
              address: w.addr,
              label: w.label,
              cohort: w.pnl_cohort,
              sizeCohort: w.size_cohort,
              pnl: w.pnl || 0,
              equity: w.balance || 0,
              totalNotional: w.value || 0,
              leverage: w.effective_leverage || 0,
              side,
              symbol
            })
          }
        }
      }
      processLiqWallets(data.liquidation_heatmap.long_liquidations, 'LONG')
      processLiqWallets(data.liquidation_heatmap.short_liquidations, 'SHORT')
    }
  }
  
  /**
   * Process breakdown table (by_label, by_cohort, or by_size)
   */
  private processBreakdown(
    symbol: string, 
    breakdown: Record<string, BreakdownEntry> | undefined,
    type: 'label' | 'cohort' | 'size'
  ) {
    if (!breakdown) return
    
    // Debug: log API keys and top_wallets presence for size breakdown
    if (type === 'size') {
      const keysWithWallets = Object.entries(breakdown)
        .filter(([_, e]) => e.top_wallets?.length)
        .map(([k, e]) => `${k}(${e.top_wallets?.length})`)
      console.log(`[ExploreService] ${symbol} by_size keys with top_wallets:`, keysWithWallets)
    }
    
    for (const [key, entry] of Object.entries(breakdown)) {
      if (!entry.top_wallets) continue
      
      for (const w of entry.top_wallets) {
        const walletData: any = {
          address: w.wallet,
          symbol
        }
        
        // Use breakdown KEY for categorization (not wallet's own fields which may differ)
        if (type === 'label') walletData.label = key
        if (type === 'cohort') walletData.cohort = key  // KEY is the cohort name e.g. "Money Printer"
        if (type === 'size') walletData.sizeCohort = key
        
        walletData.pnl = w.pnl || 0
        walletData.equity = w.balance || 0
        walletData.totalNotional = w.size || 0
        walletData.side = w.side as any
        walletData.entry = w.entry || 0
        walletData.liq = w.liq || 0
        walletData.holdingTime = w.holding_time || 0
        
        this.upsertWallet(walletData)
      }
    }
  }
  
  /**
   * Upsert wallet into aggregation map
   */
  private upsertWallet(data: {
    address: string
    label?: string
    cohort?: string
    sizeCohort?: string
    pnl: number
    equity: number
    totalNotional: number
    leverage?: number
    side?: 'LONG' | 'SHORT'
    symbol: string
    entry?: number
    liq?: number
    holdingTime?: number
  }) {
    if (!data.address || data.address.length < 10) return
    
    const existing = this.walletMap.get(data.address)
    
    if (existing) {
      // Aggregate
      existing.pnl += data.pnl
      existing.equity = Math.max(existing.equity, data.equity) // Use max equity seen
      existing.totalNotional += data.totalNotional
      existing.leverage = existing.equity > 0 ? existing.totalNotional / existing.equity : 0
      
      if (!existing.symbols.includes(data.symbol)) {
        existing.symbols.push(data.symbol)
      }
      
      // Update labels if better info
      if (data.label && !existing.label) existing.label = data.label
      if (data.cohort && !existing.cohort) existing.cohort = data.cohort
      if (data.sizeCohort && !existing.sizeCohort) existing.sizeCohort = data.sizeCohort
      // Compute sizeCohort from equity if still not set
      if (!existing.sizeCohort && existing.equity > 0) {
        existing.sizeCohort = computeSizeCohort(existing.equity)
      }
      
      // Track side
      if (data.side) {
        if (!existing.side) {
          existing.side = data.side
        } else if (existing.side !== data.side) {
          existing.side = 'MIXED'
        }
      }
      
      // Update position details if we have newer/better data
      if (data.entry && data.entry > 0) existing.entry = data.entry
      if (data.liq && data.liq > 0) existing.liq = data.liq
      if (data.holdingTime && data.holdingTime > 0) existing.holdingTime = data.holdingTime
      
      existing.lastSeen = new Date()
    } else {
      // Create new - compute sizeCohort from equity if not provided
      const sizeCohort = data.sizeCohort || (data.equity > 0 ? computeSizeCohort(data.equity) : undefined)
      this.walletMap.set(data.address, {
        address: data.address,
        label: data.label,
        cohort: data.cohort,
        sizeCohort,
        pnl: data.pnl,
        equity: data.equity,
        totalNotional: data.totalNotional,
        leverage: data.leverage || (data.equity > 0 ? data.totalNotional / data.equity : 0),
        symbols: [data.symbol],
        side: data.side,
        lastSeen: new Date(),
        entry: data.entry,
        liq: data.liq,
        holdingTime: data.holdingTime
      })
    }
  }
  
  /**
   * Build final sorted leaderboards from aggregated data
   */
  private buildLeaderboards() {
    const allWallets = Array.from(this.walletMap.values())
    
    // Top traders by PnL
    this.data.topTraders = [...allWallets]
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 100)
    
    // Smart money (by label)
    this.data.smartMoney = allWallets
      .filter(w => w.label && SMART_LABELS.includes(w.label.toUpperCase()))
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 100)
    
    // Dumb money (by label)
    this.data.dumbMoney = allWallets
      .filter(w => w.label && DUMB_LABELS.includes(w.label.toUpperCase()))
      .sort((a, b) => a.pnl - b.pnl) // Worst PnL first
      .slice(0, 100)
    
    // Whales (by equity)
    this.data.whales = [...allWallets]
      .sort((a, b) => b.equity - a.equity)
      .slice(0, 100)
    
    // By cohort groups
    this.data.byCohort = {}
    for (const [groupKey, cohortNames] of Object.entries(COHORT_GROUPS)) {
      const upperCohorts = cohortNames.map(c => c.toUpperCase())
      this.data.byCohort[groupKey] = allWallets
        .filter(w => w.cohort && upperCohorts.includes(w.cohort.toUpperCase()))
        .sort((a, b) => b.pnl - a.pnl)
        .slice(0, 50)
    }
    
    // By size groups - case-insensitive matching
    this.data.bySize = {}
    for (const [groupKey, sizeRanges] of Object.entries(SIZE_GROUPS)) {
      const lowerRanges = sizeRanges.map(r => r.toLowerCase())
      this.data.bySize[groupKey] = allWallets
        .filter(w => w.sizeCohort && lowerRanges.includes(w.sizeCohort.toLowerCase()))
        .sort((a, b) => b.equity - a.equity)
        .slice(0, 50)
    }
    
    // Debug: log cohorts found
    const cohorts = new Set(allWallets.map(w => w.cohort).filter(Boolean))
    const sizeCohorts = new Set(allWallets.map(w => w.sizeCohort).filter(Boolean))
    if (cohorts.size > 0) {
      console.log('[ExploreService] PNL cohorts found:', Array.from(cohorts))
    }
    if (sizeCohorts.size > 0) {
      console.log('[ExploreService] Size cohorts found:', Array.from(sizeCohorts))
    }
    
    // Debug: log category counts
    console.log('[ExploreService] Category counts:', {
      byCohort: Object.fromEntries(Object.entries(this.data.byCohort).map(([k, v]) => [k, v.length])),
      bySize: Object.fromEntries(Object.entries(this.data.bySize).map(([k, v]) => [k, v.length]))
    })
  }
  
  /**
   * Notify all subscribers
   */
  private notifyCallbacks() {
    const snapshot = this.getData()
    this.callbacks.forEach(cb => {
      try {
        cb(snapshot)
      } catch (e) {
        console.error('[ExploreService] Callback error:', e)
      }
    })
  }
}

export const exploreService = new ExploreService()
