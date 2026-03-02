/**
 * Signal Cache Service
 * Server-side cache for trade signals
 * 
 * Receives signals from client (browser) which has SSE connection.
 * Bot API reads from this cache - piggybacks on app's signal data.
 * 
 * Flow:
 * 1. Browser connects to SSE, receives signals
 * 2. Browser pushes signals to /api/bot/signals/sync endpoint
 * 3. Bot API reads from this cache via /api/bot/signals
 */

import type { TradeSignal } from '@/hooks/useTradeDataManager'

const MAX_SIGNALS = 100

class SignalCacheServiceClass {
  private signals: TradeSignal[] = []
  private cachedAt: Date = new Date()
  private isConnected: boolean = false
  private initialized: boolean = false
  
  /**
   * Get all cached signals
   */
  getSignals(): { signals: TradeSignal[]; cachedAt: Date } {
    return {
      signals: [...this.signals],
      cachedAt: this.cachedAt
    }
  }
  
  /**
   * Get a specific signal by ID
   */
  getSignalById(signalId: string): TradeSignal | null {
    return this.signals.find(s => s.id === signalId) || null
  }
  
  /**
   * Get signals filtered by criteria (matches app table filtering)
   */
  getFilteredSignals(filters: {
    asset?: string
    direction?: 'long' | 'short'
    signal_type?: string
    minConfidence?: number
    minRR?: number
    after?: string  // ISO timestamp - signals after this time
    before?: string // ISO timestamp - signals before this time
    sortBy?: 'asset' | 'direction' | 'confidence' | 'entry_price' | 'file_timestamp' | 'risk_reward'
    sortOrder?: 'asc' | 'desc'
    limit?: number
  }): TradeSignal[] {
    let filtered = [...this.signals]
    
    // Filter by asset
    if (filters.asset) {
      filtered = filtered.filter(s => s.asset === filters.asset)
    }
    
    // Filter by direction
    if (filters.direction) {
      filtered = filtered.filter(s => s.direction === filters.direction)
    }
    
    // Filter by signal type
    if (filters.signal_type) {
      filtered = filtered.filter(s => s.signal_type === filters.signal_type)
    }
    
    // Filter by min confidence
    if (filters.minConfidence !== undefined) {
      filtered = filtered.filter(s => (s.confidence || 0) >= filters.minConfidence!)
    }
    
    // Filter by min reward/risk ratio
    if (filters.minRR !== undefined && filters.minRR > 0) {
      filtered = filtered.filter(s => {
        const rr = this.calculateRR(s)
        return rr >= filters.minRR!
      })
    }
    
    // Filter by time range
    if (filters.after) {
      const afterTime = new Date(filters.after).getTime()
      filtered = filtered.filter(s => {
        const signalTime = new Date(s.file_timestamp || s.created_at || 0).getTime()
        return signalTime >= afterTime
      })
    }
    
    if (filters.before) {
      const beforeTime = new Date(filters.before).getTime()
      filtered = filtered.filter(s => {
        const signalTime = new Date(s.file_timestamp || s.created_at || 0).getTime()
        return signalTime <= beforeTime
      })
    }
    
    // Sort
    if (filters.sortBy) {
      const sortOrder = filters.sortOrder === 'asc' ? 1 : -1
      filtered.sort((a, b) => {
        let valueA: any, valueB: any
        
        switch (filters.sortBy) {
          case 'file_timestamp':
            valueA = new Date(a.file_timestamp || a.created_at || 0).getTime()
            valueB = new Date(b.file_timestamp || b.created_at || 0).getTime()
            break
          case 'confidence':
            valueA = a.confidence || 0
            valueB = b.confidence || 0
            break
          case 'entry_price':
            valueA = a.entry_price || 0
            valueB = b.entry_price || 0
            break
          case 'risk_reward':
            valueA = this.calculateRR(a)
            valueB = this.calculateRR(b)
            break
          default:
            valueA = a[filters.sortBy as keyof TradeSignal] || ''
            valueB = b[filters.sortBy as keyof TradeSignal] || ''
        }
        
        return (valueA > valueB ? 1 : valueA < valueB ? -1 : 0) * sortOrder
      })
    }
    
    // Limit results
    if (filters.limit) {
      filtered = filtered.slice(0, filters.limit)
    }
    
    return filtered
  }
  
  /**
   * Calculate reward/risk ratio for a signal
   */
  private calculateRR(signal: TradeSignal): number {
    const entry = signal.entry_price
    const tp = signal.target_price
    const sl = signal.stop_price
    
    if (!entry || !tp || !sl) return 0
    
    const reward = Math.abs(tp - entry)
    const risk = Math.abs(entry - sl)
    
    if (risk === 0) return 0
    return reward / risk
  }
  
  /**
   * Get unique assets from cached signals
   */
  getUniqueAssets(): string[] {
    const assets = new Set(this.signals.map(s => s.asset))
    return Array.from(assets).sort()
  }
  
  /**
   * Get newest signal for a specific asset
   */
  getNewestForAsset(asset: string): TradeSignal | null {
    const filtered = this.signals.filter(s => s.asset === asset)
    return filtered[0] || null // Already sorted newest first
  }
  
  /**
   * Get highest confidence signal (optionally filtered by asset)
   */
  getHighestConfidence(asset?: string): TradeSignal | null {
    let filtered = asset ? this.signals.filter(s => s.asset === asset) : this.signals
    if (filtered.length === 0) return null
    return filtered.reduce((best, s) => (s.confidence || 0) > (best.confidence || 0) ? s : best)
  }
  
  /**
   * Check if cache has recent data
   */
  isHealthy(): boolean {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
    return this.signals.length > 0 && this.cachedAt > fiveMinutesAgo
  }
  
  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; signalCount: number; cachedAt: string } {
    return {
      connected: this.isConnected,
      signalCount: this.signals.length,
      cachedAt: this.cachedAt.toISOString()
    }
  }
  
  /**
   * Initialize cache (no-op, cache is passive)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    console.log('[SignalCache] Cache ready - waiting for signals from client')
  }
  
  /**
   * Refresh is no-op - signals come from client push
   */
  async refreshSignals(): Promise<void> {
    // No-op - signals are pushed by client
  }
  
  /**
   * Add signals from client (main entry point)
   * Called by /api/bot/signals/sync endpoint
   */
  addSignals(newSignals: TradeSignal[]): void {
    if (!newSignals || newSignals.length === 0) {
      return
    }
    
    // Merge with existing signals
    const merged = [...newSignals, ...this.signals]
    
    // Deduplicate by ID
    const unique = merged.filter((signal, index, self) =>
      index === self.findIndex(s => s.id === signal.id)
    )
    
    // Sort by timestamp (newest first)
    const sorted = unique.sort((a, b) => {
      const timeA = new Date(a.file_timestamp || a.created_at || 0).getTime()
      const timeB = new Date(b.file_timestamp || b.created_at || 0).getTime()
      return timeB - timeA
    })
    
    // Limit to max signals
    this.signals = sorted.slice(0, MAX_SIGNALS)
    this.cachedAt = new Date()
    this.isConnected = true
    
    console.log(`[SignalCache] Updated cache: ${this.signals.length} signals`)
  }
  
  /**
   * Clear the cache
   */
  clear(): void {
    this.signals = []
    this.cachedAt = new Date()
  }
  
  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.isConnected = false
    this.initialized = false
  }
}

// Singleton instance
export const SignalCacheService = new SignalCacheServiceClass()

// Also export the class for testing
export { SignalCacheServiceClass }
