/**
 * Auto Trade Bot Service
 * Processes signals and executes trades based on filters from automation store
 */
import * as hl from '@nktkas/hyperliquid'
import { useAutomationStore } from '@/store/useAutomationStore'
import { parsePositionSize } from '@/utils/positionSizeParser'
import { sseService } from '@/services/sse-service'
import { toast } from 'sonner'

interface TradeSignal {
    id: string
    asset: string
    direction: 'long' | 'short'
    entry_price: number
    target_price: number
    stop_price: number
    current_price?: number
    confidence?: number
    signal_type?: string
    file_timestamp?: string
    created_at?: string
}

interface Position {
    asset: string
    side: 'long' | 'short'
    size: number
    entryPx: number
}

interface OpenOrder {
    asset: string
    side: 'long' | 'short'
    size: number
    price: number
    oid: number
}

class AutoTradeBotServiceClass {
    private enabled = false
    private infoClient: hl.InfoClient
    private exchClient: hl.ExchangeClient | null = null
    private userAddress: string | null = null
    
    // Cross-signal deduplication - track processed signals with timestamps
    private processedSignals = new Map<string, number>() // Map<signalId, timestamp>
    private SIGNAL_CACHE_DURATION = 10 * 60 * 1000 // 10 minutes
    
    // Pending orders cache - track orders we JUST placed (prevents race conditions)
    private pendingOrders = new Map<string, { timestamp: number; signalId: string; asset: string; direction: string }>()
    private PENDING_ORDER_DURATION = 15 * 60 * 1000 // 15 minutes
    
    // Processing lock - prevent concurrent batch processing
    private isProcessingBatch = false
    
    // Batch processing state
    private currentBatch: TradeSignal[] = []
    private batchTimer: NodeJS.Timeout | null = null
    private BATCH_TIMEOUT = 30000 // 30 seconds - same as reference
    
    private currentPositions: Position[] = []
    private currentOpenOrders: OpenOrder[] = [] // Track open orders (not just positions)
    private onLog: ((message: string, type: 'info' | 'success' | 'error') => void) | null = null
    private positionCheckInterval: NodeJS.Timeout | null = null
    private logToConsole = false
    
    // Global data from store (updated by BotProvider)
    private globalAccountValue: number = 0
    private assetMetaCache: any[] = []
    private lastMetaCacheTime: number = 0
    
    // CLOID generation for order tracking
    private _cloidCounter: number = 0
    private _cloidLastMs: number = 0
    
    // Polling mechanism (matches reference implementation)
    private tradingCycleInterval: NodeJS.Timeout | null = null
    private TRADING_CYCLE_INTERVAL = 30000 // 30 seconds - same as reference
    
    // Position limit enforcement monitor (independent of batch processing)
    private positionLimitInterval: NodeJS.Timeout | null = null
    private POSITION_LIMIT_POLL_MS = 3000 // 3 seconds - catches race conditions
    private isCancellingExcess = false // Lock to prevent concurrent cancellation
    private positionLimitPollCount = 0 // Counter for periodic status logs
    private POSITION_LIMIT_STATUS_INTERVAL = 10 // Log status every 10 polls (30 seconds)
    
    // Persistent signal storage (accumulates from SSE like reference's globalIncomingTrades)
    private incomingSignals: TradeSignal[] = []
    private SIGNAL_RETENTION_DURATION = 10 * 60 * 1000 // 10 minutes
    
    // SSE subscription bound handler
    private boundHandleNewTrades: ((payload: any) => void) | null = null
    private boundHandleAllTrades: ((trades: any[]) => void) | null = null
    private sseSubscribed = false

    constructor() {
        const transport = new hl.HttpTransport({ isTestnet: false })
        this.infoClient = new hl.InfoClient({ transport })
    }

    setLogCallback(callback: (message: string, type: 'info' | 'success' | 'error') => void) {
        this.onLog = callback
    }

    private log(message: string, type: 'info' | 'success' | 'error' = 'info') {
        if (this.onLog) {
            this.onLog(message, type)
        }
        if (this.logToConsole) {
            console.log(`[Auto Trade] ${message}`)
        }
    }

    private normalizeAssetName(asset?: string | null): string {
        return String(asset ?? '').trim().toUpperCase()
    }

    private isBlacklisted(asset: string, store: any): boolean {
        if (!store.blacklistedAssets || store.blacklistedAssets.length === 0) {
            return false
        }
        const normalizedAsset = this.normalizeAssetName(asset)
        return store.blacklistedAssets.some((blocked: string) => this.normalizeAssetName(blocked) === normalizedAsset)
    }

    private applyMarketBiasAdjustments(signals: TradeSignal[], store: any): { adjustedSignals: TradeSignal[]; adjustedCount: number } {
        const longBiasActive = store.longBiasEnabled && store.longBias !== 0
        const shortBiasActive = store.shortBiasEnabled && store.shortBias !== 0

        if (!longBiasActive && !shortBiasActive) {
            return { adjustedSignals: signals, adjustedCount: 0 }
        }

        let adjustedCount = 0
        const adjustedSignals = signals.map(signal => {
            const biasPercent = signal.direction === 'long'
                ? (store.longBiasEnabled ? store.longBias : 0)
                : (store.shortBiasEnabled ? store.shortBias : 0)

            if (!biasPercent) {
                return signal
            }

            const currentPrice = signal.current_price
            const entryPrice = signal.entry_price

            if (!currentPrice || !entryPrice || isNaN(currentPrice) || isNaN(entryPrice)) {
                return signal
            }

            const distanceFromMarket = Math.abs(entryPrice - currentPrice) / currentPrice * 100
            const adjustedDistance = distanceFromMarket * (1 - biasPercent / 100)

            let newEntryPrice = signal.direction === 'long'
                ? currentPrice * (1 - adjustedDistance / 100)
                : currentPrice * (1 + adjustedDistance / 100)

            if (!Number.isFinite(newEntryPrice)) {
                return signal
            }

            newEntryPrice = parseFloat(newEntryPrice.toPrecision(6))

            if (newEntryPrice === entryPrice) {
                return signal
            }

            adjustedCount++
            return { ...signal, entry_price: newEntryPrice }
        })

        return { adjustedSignals, adjustedCount }
    }

    initialize(exchClient: hl.ExchangeClient, userAddress: string) {
        this.exchClient = exchClient
        this.userAddress = userAddress
        this.log(`Initialized for ${userAddress.slice(0, 8)}...`)
    }

    // Update positions from global store (called by BotProvider)
    updatePositions(positions: Position[]) {
        this.currentPositions = positions
    }
    
    // Update account value from global store (called by BotProvider)
    updateAccountValue(accountValue: number) {
        this.globalAccountValue = accountValue
    }
    
    /**
     * Get effective max longs/shorts based on mode
     * Store now handles risk level presets, so values are already correct
     */
    private getEffectivePositionLimits(store: any): { maxLongs: number; maxShorts: number } {
        // Store already has correct values based on mode and risk level
        // Volume mode: setRiskLevel applies preset with correct maxLongs/maxShorts
        // Advanced mode: user-entered values are used directly
        return { maxLongs: store.maxLongs, maxShorts: store.maxShorts }
    }

    enable() {
        if (this.enabled) return true
        this.enabled = true
        this.startPositionMonitoring()
        this.startPositionLimitMonitor()
        this.subscribeToSSE()
        this.startTradingCycle()
        this.log('Enabled - listening for signals with 30s polling', 'success')
        return true
    }

    disable() {
        if (!this.enabled) return true
        
        // Complete current batch before disabling
        if (this.currentBatch.length > 0) {
            this.log('Completing current batch before disabling...')
            this.completeBatch()
        }
        
        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer)
            this.batchTimer = null
        }
        
        // Stop trading cycle
        this.stopTradingCycle()
        
        // Unsubscribe from SSE
        this.unsubscribeFromSSE()
        
        this.enabled = false
        this.currentBatch = []
        this.incomingSignals = []
        this.stopPositionMonitoring()
        this.stopPositionLimitMonitor()
        this.log('Disabled')
        return true
    }

    isEnabled() {
        return this.enabled
    }

    private startPositionMonitoring() {
        if (this.positionCheckInterval) return
        this.fetchPositionsFromAPI()
        this.positionCheckInterval = setInterval(() => this.fetchPositionsFromAPI(), 5000)
    }

    private stopPositionMonitoring() {
        if (this.positionCheckInterval) {
            clearInterval(this.positionCheckInterval)
            this.positionCheckInterval = null
        }
    }
    
    /**
     * Start position limit enforcement monitor (independent of batch processing)
     * Runs every 3 seconds to catch race conditions where positions fill faster than batches
     */
    private startPositionLimitMonitor() {
        if (this.positionLimitInterval) return
        
        this.log('[Limit Monitor] Started - polling every 3s to enforce position limits')
        
        // Run initial check
        this.enforcePositionLimits()
        
        // Set up polling interval
        this.positionLimitInterval = setInterval(() => {
            this.enforcePositionLimits()
        }, this.POSITION_LIMIT_POLL_MS)
    }
    
    private stopPositionLimitMonitor() {
        if (this.positionLimitInterval) {
            clearInterval(this.positionLimitInterval)
            this.positionLimitInterval = null
            this.log('[Limit Monitor] Stopped')
        }
    }
    
    /**
     * Enforce position limits independently of batch processing
     * Cancels excess open orders when position limits are reached
     */
    private async enforcePositionLimits() {
        if (!this.enabled || !this.exchClient) return
        
        try {
            const store = useAutomationStore.getState()
            if (!store.autoTradeEnabled) return
            
            this.positionLimitPollCount++
            
            const longCount = this.currentPositions.filter(p => p.side === 'long').length
            const shortCount = this.currentPositions.filter(p => p.side === 'short').length
            const limits = this.getEffectivePositionLimits(store)
            const pendingLongOrders = this.currentOpenOrders.filter(o => o.side === 'long').length
            const pendingShortOrders = this.currentOpenOrders.filter(o => o.side === 'short').length
            
            // Periodic status log every 30 seconds (10 polls * 3s)
            if (this.positionLimitPollCount % this.POSITION_LIMIT_STATUS_INTERVAL === 0) {
                const modeStr = store.activeMode === 'volume' ? `Volume (Risk ${store.riskLevel})` : 'Advanced'
                this.log(`[Limit Monitor] ${modeStr}: ${longCount}/${limits.maxLongs} longs, ${shortCount}/${limits.maxShorts} shorts | Pending: ${pendingLongOrders}L/${pendingShortOrders}S orders`, 'info')
            }
            
            // Only take action if at limits
            const atLongLimit = longCount >= limits.maxLongs
            const atShortLimit = shortCount >= limits.maxShorts
            
            if (atLongLimit || atShortLimit) {
                // Log when limits detected and we have orders to cancel
                if (atLongLimit && pendingLongOrders > 0) {
                    this.log(`[Limit Monitor] ⚠️ At max longs (${longCount}/${limits.maxLongs}) - cancelling ${pendingLongOrders} pending LONG orders`, 'info')
                }
                if (atShortLimit && pendingShortOrders > 0) {
                    this.log(`[Limit Monitor] ⚠️ At max shorts (${shortCount}/${limits.maxShorts}) - cancelling ${pendingShortOrders} pending SHORT orders`, 'info')
                }
                await this.cancelExcessOrders(longCount, shortCount, limits)
            }
        } catch (e) {
            // Silent fail - this runs frequently
        }
    }
    
    /**
     * Subscribe to SSE service for real-time signal updates
     * This ensures we receive signals even when React state doesn't update
     */
    private subscribeToSSE() {
        if (this.sseSubscribed) return
        
        // Handler for new trades (real-time updates)
        this.boundHandleNewTrades = (payload: any) => {
            if (!this.enabled) return
            if (payload?.trades) {
                this.accumulateSignals(payload.trades)
            }
        }
        
        // Handler for all trades (initial load / reconnect)
        this.boundHandleAllTrades = (trades: any[]) => {
            if (!this.enabled) return
            if (trades && trades.length > 0) {
                this.accumulateSignals(trades)
            }
        }
        
        sseService.on('new-trades-data', this.boundHandleNewTrades)
        sseService.on('trades-data', this.boundHandleAllTrades)
        this.sseSubscribed = true
        this.log('Subscribed to SSE for real-time signals')
    }
    
    /**
     * Unsubscribe from SSE service
     */
    private unsubscribeFromSSE() {
        if (!this.sseSubscribed) return
        
        if (this.boundHandleNewTrades) {
            sseService.off('new-trades-data', this.boundHandleNewTrades)
        }
        if (this.boundHandleAllTrades) {
            sseService.off('trades-data', this.boundHandleAllTrades)
        }
        
        this.boundHandleNewTrades = null
        this.boundHandleAllTrades = null
        this.sseSubscribed = false
    }
    
    /**
     * Accumulate signals into persistent storage (like reference's globalIncomingTrades)
     */
    private accumulateSignals(trades: any[]) {
        if (!trades || trades.length === 0) return
        
        const now = Date.now()
        
        // Add new signals that aren't already in the list
        for (const trade of trades) {
            if (!trade.id) continue
            
            // Check if already exists
            const exists = this.incomingSignals.some(existing => 
                existing.id === trade.id ||
                (existing.asset === trade.asset &&
                 existing.entry_price === trade.entry_price &&
                 existing.target_price === trade.target_price &&
                 existing.stop_price === trade.stop_price &&
                 existing.direction === trade.direction)
            )
            
            if (!exists) {
                this.incomingSignals.push({
                    ...trade,
                    _accumulatedAt: now
                } as TradeSignal & { _accumulatedAt: number })
            }
        }
        
        // Cleanup old signals (older than 10 minutes)
        const cutoff = now - this.SIGNAL_RETENTION_DURATION
        this.incomingSignals = this.incomingSignals.filter(signal => {
            const signalTime = (signal as any)._accumulatedAt || 
                new Date(signal.file_timestamp || signal.created_at || 0).getTime()
            return signalTime > cutoff
        })
    }
    
    /**
     * Start trading cycle polling (matches reference's startTrading)
     */
    private startTradingCycle() {
        if (this.tradingCycleInterval) return
        
        // Set up 30-second polling interval (same as reference)
        this.tradingCycleInterval = setInterval(() => {
            this.executeTradingCycle()
        }, this.TRADING_CYCLE_INTERVAL)
        
        // Run initial cycle immediately
        this.executeTradingCycle()
    }
    
    /**
     * Stop trading cycle polling
     */
    private stopTradingCycle() {
        if (this.tradingCycleInterval) {
            clearInterval(this.tradingCycleInterval)
            this.tradingCycleInterval = null
        }
    }
    
    /**
     * Execute trading cycle (matches reference's executeTradingCycle)
     * Polls accumulated signals and processes them for batching
     */
    private async executeTradingCycle() {
        if (!this.enabled || !this.exchClient) return
        
        const store = useAutomationStore.getState()
        if (!store.autoTradeEnabled) return
        
        // Prevent new cycles while batch is executing
        if (this.isProcessingBatch) {
            return
        }
        
        try {
            // Get all accumulated signals
            const signals = this.getIncomingSignals()
            
            if (signals.length === 0) {
                return
            }
            
            // Process each signal for batching
            for (const signal of signals) {
                await this.handleNewSignal(signal)
            }
            
        } catch (error) {
            console.error('[Auto Trade] Error in trading cycle:', error)
        }
    }
    
    /**
     * Get incoming signals for processing (non-destructive, like reference)
     */
    private getIncomingSignals(): TradeSignal[] {
        return [...this.incomingSignals]
    }
    
    /**
     * Handle new signal - add to batch with cross-batch deduplication
     * (matches reference's handleNewTrade)
     */
    private async handleNewSignal(signal: TradeSignal): Promise<boolean> {
        if (!this.enabled || !signal) return false
        
        // Cleanup old caches first
        this.cleanupProcessedSignals()
        this.cleanupPendingOrders()
        
        // Check if already processed in any previous batch
        if (this.processedSignals.has(signal.id)) {
            return false
        }
        
        // Check if already in current batch
        const isDuplicate = this.currentBatch.some(existing =>
            existing.id === signal.id ||
            (existing.asset === signal.asset &&
             existing.entry_price === signal.entry_price &&
             existing.target_price === signal.target_price &&
             existing.stop_price === signal.stop_price &&
             existing.direction === signal.direction)
        )
        
        if (isDuplicate) {
            return false
        }
        
        // Add to current batch
        this.currentBatch.push({
            ...signal,
            receivedAt: Date.now()
        } as TradeSignal & { receivedAt: number })
        
        // Reset batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer)
        }
        
        // Set timer to process batch
        this.batchTimer = setTimeout(() => {
            this.completeBatch()
        }, this.BATCH_TIMEOUT)
        
        this.log(`Added ${signal.asset} ${signal.direction.toUpperCase()} to batch (${this.currentBatch.length} signals)`)
        return true
    }

    private async fetchPositionsFromAPI() {
        if (!this.userAddress) return
        try {
            // Fetch positions
            const clearinghouse = await this.infoClient.clearinghouseState({ user: this.userAddress })
            this.currentPositions = (clearinghouse?.assetPositions || [])
                .filter((p: any) => parseFloat(p.position.szi) !== 0)
                .map((p: any) => ({
                    asset: p.position.coin,
                    side: parseFloat(p.position.szi) > 0 ? 'long' : 'short',
                    size: Math.abs(parseFloat(p.position.szi)),
                    entryPx: parseFloat(p.position.entryPx)
                }))
            
            // Fetch open orders (critical for order layering check)
            const openOrders = await this.infoClient.openOrders({ user: this.userAddress })
            this.currentOpenOrders = (openOrders || [])
                .filter((o: any) => !o.reduceOnly && !o.isPositionTpsl) // Only entry orders, not TP/SL
                .map((o: any) => ({
                    asset: o.coin,
                    side: o.side === 'B' ? 'long' : 'short',
                    size: parseFloat(o.sz),
                    price: parseFloat(o.limitPx),
                    oid: o.oid
                }))
        } catch (e) {
            // Ignore
        }
    }

    // Cleanup old processed signals (called before processing)
    private cleanupProcessedSignals() {
        const now = Date.now()
        const cutoff = now - this.SIGNAL_CACHE_DURATION
        for (const [id, timestamp] of this.processedSignals) {
            if (timestamp < cutoff) {
                this.processedSignals.delete(id)
            }
        }
    }
    
    // Cleanup old pending orders
    private cleanupPendingOrders() {
        const now = Date.now()
        const cutoff = now - this.PENDING_ORDER_DURATION
        for (const [key, order] of this.pendingOrders) {
            if (order.timestamp < cutoff) {
                this.pendingOrders.delete(key)
            }
        }
    }

    /**
     * Process incoming signal - public API for external callers
     * Now delegates to handleNewSignal for consistency with internal polling
     * @deprecated Use is optional - AutoTradeBotService now handles SSE directly
     */
    async processSignal(signal: TradeSignal): Promise<boolean> {
        // Also accumulate the signal so it's available for polling cycle
        this.accumulateSignals([signal])
        return this.handleNewSignal(signal)
    }
    
    /**
     * Complete current batch - apply filters, dedupe by confidence, execute orders
     */
    private async completeBatch() {
        if (this.currentBatch.length === 0 || this.isProcessingBatch) {
            return
        }

        this.isProcessingBatch = true
        const batch = [...this.currentBatch]
        this.currentBatch = []

        try {
            const store = useAutomationStore.getState()
            
            // === BATCH START ===
            this.log(`\n═══════════════════════════════════════════`, 'info')
            this.log(`📦 [BATCH START] ${batch.length} signals received`, 'info')
            
            const assetBreakdown = batch.reduce((acc, s) => {
                const key = `${s.asset}_${s.direction.toUpperCase()}`
                acc[key] = (acc[key] || 0) + 1
                return acc
            }, {} as Record<string, number>)
            this.log(`  Signals: ${Object.entries(assetBreakdown).map(([k, v]) => `${k}(${v})`).join(', ')}`, 'info')
            
            // === MODE & SETTINGS ===
            const limits = this.getEffectivePositionLimits(store)
            if (store.activeMode === 'volume') {
                this.log(`\n⚙️ [MODE] VOLUME Mode | Risk Level: ${store.riskLevel} | Size: ${store.positionSize}`, 'info')
                this.log(`  Limits: ${limits.maxLongs} longs, ${limits.maxShorts} shorts`, 'info')
            } else {
                this.log(`\n⚙️ [MODE] ADVANCED Mode | Size: ${store.positionSize}`, 'info')
                this.log(`  Limits: ${limits.maxLongs} longs, ${limits.maxShorts} shorts`, 'info')
                this.log(`  CrossOrder: ${store.crossOrder}, Layering: ${store.orderLayering}`, 'info')
            }
            
            // Mark all batch signals as processed immediately (cross-batch deduplication)
            batch.forEach(signal => {
                this.processedSignals.set(signal.id, Date.now())
            })
            
            // Fetch current prices for all batch signals
            const signalsWithPrices = await this.fetchPricesForBatch(batch)
            
            // === APPLY FILTERS (detailed logging in applyFiltersWithStats) ===
            const filterResults = this.applyFiltersWithStats(signalsWithPrices, store)
            
            if (filterResults.passed.length === 0) {
                this.log(`=== BATCH END: No signals passed filters ===\n`, 'info')
                return
            }
            
            // === INTRA-BATCH DEDUPLICATION ===
            const dedupedSignals = this.applyIntraBatchFiltering(filterResults.passed, store)
            const dedupedCount = filterResults.passed.length - dedupedSignals.length
            const layeringStr = store.orderLayering ? 'ON' : 'OFF'
            const crossStr = store.crossOrder ? 'ON' : 'OFF'
            if (dedupedCount > 0) {
                this.log(`\n🔄 [DEDUPE] Layering=${layeringStr}, CrossOrder=${crossStr}: -${dedupedCount} duplicates (${dedupedSignals.length} remain)`, 'info')
            } else {
                this.log(`\n🔄 [DEDUPE] Layering=${layeringStr}, CrossOrder=${crossStr}: 0 duplicates removed`, 'info')
            }
            
            // === SORT BY CONFIDENCE ===
            const sortedSignals = dedupedSignals.sort((a, b) => {
                const confA = a.confidence || 0
                const confB = b.confidence || 0
                return confB - confA
            })
            this.log(`\n🚀 [EXECUTION] Placing ${sortedSignals.length} orders (sorted by confidence)...`, 'info')
            sortedSignals.forEach((s, i) => {
                const conf = ((s.confidence || 0) * 100).toFixed(0)
                const entryPx = parseFloat(String(s.entry_price)) || 0
                const tpPx = parseFloat(String(s.target_price)) || 0
                const slPx = parseFloat(String(s.stop_price)) || 0
                // Use toPrecision for proper display of small prices (e.g., $0.002 not $0.00)
                this.log(`  ${i+1}. ${s.asset} ${s.direction.toUpperCase()} @ $${this.formatPrice(entryPx)} | TP: $${this.formatPrice(tpPx)} | SL: $${this.formatPrice(slPx)} (${conf}% conf)`, 'info')
            })
            
            // Pre-populate pending orders cache BEFORE placing ANY orders (prevents race conditions)
            sortedSignals.forEach(signal => {
                const key = `${signal.asset}_${signal.direction.toUpperCase()}`
                this.pendingOrders.set(key, {
                    timestamp: Date.now(),
                    signalId: signal.id,
                    asset: signal.asset,
                    direction: signal.direction.toUpperCase()
                })
            })
            
            // Execute orders sequentially with retry mechanism
            let successCount = 0
            let failCount = 0
            const failReasons: string[] = []
            
            for (let i = 0; i < sortedSignals.length; i++) {
                const signal = sortedSignals[i]
                
                // Pre-order position limit check (prevent race conditions during batch)
                const limitCheck = await this.checkPositionLimits(signal, store)
                if (!limitCheck.allowed) {
                    this.log(`[Batch] Skipping ${signal.asset} ${signal.direction.toUpperCase()} - ${limitCheck.reason}`, 'error')
                    failCount++
                    continue
                }
                
                const result = await this.executeOrderWithRetry(signal, store)
                if (result.success) {
                    successCount++
                    this.log(`  ✅ [${i+1}/${sortedSignals.length}] ${signal.asset} ${signal.direction.toUpperCase()} placed successfully`, 'success')
                } else {
                    failCount++
                    failReasons.push(`${signal.asset}: ${result.error}`)
                    // Remove from pending on failure
                    const key = `${signal.asset}_${signal.direction.toUpperCase()}`
                    this.pendingOrders.delete(key)
                    this.log(`  ❌ [${i+1}/${sortedSignals.length}] ${signal.asset} ${signal.direction.toUpperCase()}: ${result.error}`, 'error')
                }
                
                // 5-second delay between orders (except for last order)
                if (i < sortedSignals.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 5000))
                }
            }
            
            // === BATCH SUMMARY ===
            this.log(`\n🏁 [BATCH COMPLETE] ${successCount} placed, ${failCount} failed`, successCount > 0 ? 'success' : 'info')
            if (failReasons.length > 0) {
                this.log(`  Failed: ${failReasons.join('; ')}`, 'error')
            }
            
            if (successCount > 0) {
                toast.success(`AT Batch: ${successCount} placed${failCount > 0 ? `, ${failCount} failed` : ''}`)
            } else if (failCount > 0) {
                toast.error(`AT Batch: ${failCount} failed`, { description: failReasons[0] })
            }
            
        } catch (error) {
            this.log(`Batch processing error: ${(error as Error).message}`, 'error')
        } finally {
            this.isProcessingBatch = false
            
            // Keep processedSignals cache bounded
            if (this.processedSignals.size > 1000) {
                const entries = Array.from(this.processedSignals.entries())
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, 500)
                for (const [id] of entries) {
                    this.processedSignals.delete(id)
                }
            }
        }
    }
    
    /**
     * Fetch current prices for all signals in batch
     */
    private async fetchPricesForBatch(signals: TradeSignal[]): Promise<TradeSignal[]> {
        try {
            const meta = await this.infoClient.meta()
            const allMids = await this.infoClient.allMids()
            
            return signals.map(signal => {
                if (signal.current_price) return signal
                
                const assetMeta = meta.universe.find((a: any) => a.name === signal.asset)
                if (assetMeta) {
                    const assetIndex = meta.universe.indexOf(assetMeta)
                    const price = parseFloat((allMids as any)[assetIndex] || '0')
                    return { ...signal, current_price: price }
                }
                return signal
            })
        } catch (e) {
            this.log('Failed to fetch batch prices, using entry prices', 'error')
            return signals
        }
    }
    
    /**
     * Intra-batch filtering - controls how many signals per asset pass through
     * Matches old codebase tooltip logic exactly:
     * 
     * | Layering | CrossOrder | Behavior |
     * |----------|------------|----------|
     * | OFF      | OFF        | 1 order per asset (total) |
     * | OFF      | ON         | 1 order per asset (total) |
     * | ON       | OFF        | Unlimited orders, ONE direction only (stacking) |
     * | ON       | ON         | Max 1 LONG + Max 1 SHORT per asset |
     */
    private applyIntraBatchFiltering(signals: TradeSignal[], store: any): TradeSignal[] {
        // Group signals by asset
        const byAsset: Record<string, TradeSignal[]> = {}
        for (const signal of signals) {
            if (!byAsset[signal.asset]) byAsset[signal.asset] = []
            byAsset[signal.asset].push(signal)
        }
        
        const result: TradeSignal[] = []
        
        for (const [asset, assetSignals] of Object.entries(byAsset)) {
            if (!store.orderLayering) {
                // LAYERING OFF: Only 1 order per asset total (best by confidence)
                const best = assetSignals.reduce((best, current) => 
                    (current.confidence || 0) > (best.confidence || 0) ? current : best
                )
                result.push(best)
            } else if (store.crossOrder) {
                // LAYERING ON + CROSSORDER ON: Max 1 LONG + Max 1 SHORT per asset
                const longs = assetSignals.filter(s => s.direction === 'long')
                const shorts = assetSignals.filter(s => s.direction === 'short')
                
                if (longs.length > 0) {
                    const bestLong = longs.reduce((best, current) => 
                        (current.confidence || 0) > (best.confidence || 0) ? current : best
                    )
                    result.push(bestLong)
                }
                
                if (shorts.length > 0) {
                    const bestShort = shorts.reduce((best, current) => 
                        (current.confidence || 0) > (best.confidence || 0) ? current : best
                    )
                    result.push(bestShort)
                }
            } else {
                // LAYERING ON + CROSSORDER OFF: Unlimited same-direction orders (stacking)
                // Pick all signals of the dominant direction (by count, then confidence)
                const longs = assetSignals.filter(s => s.direction === 'long')
                const shorts = assetSignals.filter(s => s.direction === 'short')
                
                // Use whichever direction has more signals, or higher avg confidence
                if (longs.length > shorts.length) {
                    result.push(...longs)
                } else if (shorts.length > longs.length) {
                    result.push(...shorts)
                } else {
                    // Equal count - pick direction with highest confidence signal
                    const bestLong = longs.length > 0 ? Math.max(...longs.map(s => s.confidence || 0)) : 0
                    const bestShort = shorts.length > 0 ? Math.max(...shorts.map(s => s.confidence || 0)) : 0
                    if (bestLong >= bestShort) {
                        result.push(...longs)
                    } else {
                        result.push(...shorts)
                    }
                }
            }
        }
        
        return result
    }
    
    /**
     * Check position limits before placing order (prevents race conditions during batch)
     */
    private async checkPositionLimits(signal: TradeSignal, store: any): Promise<{ allowed: boolean; reason?: string }> {
        try {
            // Refresh positions from API for accurate count
            await this.fetchPositionsFromAPI()
            
            const longCount = this.currentPositions.filter(p => p.side === 'long').length
            const shortCount = this.currentPositions.filter(p => p.side === 'short').length
            const limits = this.getEffectivePositionLimits(store)
            
            // Cancel excess open orders if at limits
            await this.cancelExcessOrders(longCount, shortCount, limits)
            
            if (signal.direction === 'long' && longCount >= limits.maxLongs) {
                return { allowed: false, reason: `Max longs reached (${longCount}/${limits.maxLongs})` }
            }
            if (signal.direction === 'short' && shortCount >= limits.maxShorts) {
                return { allowed: false, reason: `Max shorts reached (${shortCount}/${limits.maxShorts})` }
            }
            
            return { allowed: true }
        } catch (e) {
            // Fail-safe: allow if check fails
            return { allowed: true }
        }
    }
    
    /**
     * Cancel excess open entry orders when position limits are reached
     */
    private async cancelExcessOrders(activeLongs: number, activeShorts: number, limits: { maxLongs: number; maxShorts: number }) {
        if (!this.exchClient) return
        
        // Prevent concurrent cancellation attempts
        if (this.isCancellingExcess) return
        
        // Early exit if not at limits
        if (activeLongs < limits.maxLongs && activeShorts < limits.maxShorts) {
            return
        }
        
        this.isCancellingExcess = true
        
        try {
            // Get open entry orders (non-reduce-only)
            const longOrders = this.currentOpenOrders.filter(o => o.side === 'long')
            const shortOrders = this.currentOpenOrders.filter(o => o.side === 'short')
            
            // Early exit if no orders to cancel
            if (longOrders.length === 0 && shortOrders.length === 0) {
                return
            }
            
            const needsLongCancellation = activeLongs >= limits.maxLongs && longOrders.length > 0
            const needsShortCancellation = activeShorts >= limits.maxShorts && shortOrders.length > 0
            const { maxLongs, maxShorts } = limits
            
            if (!needsLongCancellation && !needsShortCancellation) {
                return
            }
            
            // Cancel long orders if at max
            if (needsLongCancellation) {
                this.log(`[Limit Monitor] 🗑️ Cancelling ${longOrders.length} excess LONG orders (at max ${activeLongs}/${maxLongs})`, 'info')
                for (const order of longOrders) {
                    try {
                        const idx = await this.resolveAssetIndex(order.asset)
                        if (idx === null) continue
                        
                        await this.exchClient!.cancel({
                            cancels: [{ a: idx, o: order.oid }]
                        })
                        this.log(`[Limit Monitor] ✓ Cancelled LONG order: ${order.asset} @ $${order.price}`, 'success')
                        await new Promise(resolve => setTimeout(resolve, 100))
                    } catch (e) {
                        // Ignore individual cancel errors
                    }
                }
            }
            
            // Cancel short orders if at max
            if (needsShortCancellation) {
                this.log(`[Limit Monitor] 🗑️ Cancelling ${shortOrders.length} excess SHORT orders (at max ${activeShorts}/${maxShorts})`, 'info')
                for (const order of shortOrders) {
                    try {
                        const idx = await this.resolveAssetIndex(order.asset)
                        if (idx === null) continue
                        
                        await this.exchClient!.cancel({
                            cancels: [{ a: idx, o: order.oid }]
                        })
                        this.log(`[Limit Monitor] ✓ Cancelled SHORT order: ${order.asset} @ $${order.price}`, 'success')
                        await new Promise(resolve => setTimeout(resolve, 100))
                    } catch (e) {
                        // Ignore individual cancel errors
                    }
                }
            }
        } catch (e) {
            this.log(`Error cancelling excess orders: ${(e as Error).message}`, 'error')
        } finally {
            this.isCancellingExcess = false
        }
    }
    
    /**
     * Execute order with retry mechanism (0s, 15s, 45s delays)
     */
    private async executeOrderWithRetry(signal: TradeSignal, store: any, maxRetries = 3): Promise<{ success: boolean; error?: string }> {
        const retryDelays = [0, 15000, 45000] // 0s, 15s, 45s
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 1) {
                    const delay = retryDelays[attempt - 1]
                    this.log(`Retry ${attempt}/${maxRetries} for ${signal.asset} - waiting ${delay/1000}s...`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                }
                
                // PRE-ORDER VALIDATION: Check current price right before placing
                const preOrderCheck = await this.validatePreOrder(signal)
                if (!preOrderCheck.valid) {
                    this.log(`⚠️ Pre-order check failed: ${signal.asset} - ${preOrderCheck.reason}`, 'error')
                    return { success: false, error: preOrderCheck.reason }
                }
                
                await this.executeTrade(signal, store)
                return { success: true }
                
            } catch (error) {
                const errMsg = (error as Error).message
                this.log(`Order attempt ${attempt}/${maxRetries} failed: ${errMsg}`, 'error')
                
                if (attempt === maxRetries) {
                    return { success: false, error: `Max retries exceeded: ${errMsg}` }
                }
            }
        }
        
        return { success: false, error: 'Unknown error' }
    }
    
    /**
     * Pre-order validation - fetch current price and ensure order won't instant fill
     * This runs RIGHT BEFORE each order placement to catch market movement
     */
    private async validatePreOrder(signal: TradeSignal): Promise<{ valid: boolean; reason?: string }> {
        try {
            // Fetch fresh market price - allMids is keyed by asset NAME not index
            const allMids = await this.infoClient.allMids()
            
            // Direct lookup by asset name (matches old codebase)
            const currentPrice = parseFloat((allMids as any)[signal.asset] || '0')
            
            if (!currentPrice || currentPrice <= 0) {
                return { valid: false, reason: `No market price for ${signal.asset}` }
            }
            
            // Parse prices as numbers (they may come as strings from API)
            const entryPrice = parseFloat(String(signal.entry_price)) || 0
            const stopPrice = parseFloat(String(signal.stop_price)) || 0
            const targetPrice = signal.target_price ? parseFloat(String(signal.target_price)) || 0 : 0
            
            // Validate prices are not 0/invalid (matches old codebase)
            if (!entryPrice || entryPrice <= 0 || isNaN(entryPrice)) {
                return { valid: false, reason: `Invalid entry price: ${signal.entry_price}` }
            }
            if (!stopPrice || stopPrice <= 0 || isNaN(stopPrice)) {
                return { valid: false, reason: `Invalid stop price: ${signal.stop_price}` }
            }
            if (signal.target_price && (targetPrice <= 0 || isNaN(targetPrice))) {
                return { valid: false, reason: `Invalid target price: ${signal.target_price}` }
            }
            
            const ENTRY_SAFETY_BUFFER = 0.1   // 0.1% min distance from current price
            const SL_SAFETY_BUFFER = 0.15     // 0.15% min SL distance from entry
            
            if (signal.direction === 'long') {
                // LONG: Entry must be BELOW current price (limit buy)
                if (entryPrice >= currentPrice) {
                    return { valid: false, reason: `LONG entry $${entryPrice.toFixed(6)} >= market $${currentPrice.toFixed(6)} - would instant fill` }
                }
                const distBelowMarket = ((currentPrice - entryPrice) / currentPrice) * 100
                if (distBelowMarket < ENTRY_SAFETY_BUFFER) {
                    return { valid: false, reason: `LONG entry only ${distBelowMarket.toFixed(3)}% below market - too close` }
                }
                // SL must be BELOW entry
                if (stopPrice >= entryPrice) {
                    return { valid: false, reason: `LONG SL $${stopPrice} >= entry $${entryPrice}` }
                }
                const slDist = ((entryPrice - stopPrice) / entryPrice) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    return { valid: false, reason: `LONG SL only ${slDist.toFixed(3)}% from entry - too close` }
                }
                // TP must be ABOVE entry
                if (targetPrice && targetPrice <= entryPrice) {
                    return { valid: false, reason: `LONG TP $${targetPrice} <= entry $${entryPrice}` }
                }
            } else {
                // SHORT: Entry must be ABOVE current price (limit sell)
                if (entryPrice <= currentPrice) {
                    return { valid: false, reason: `SHORT entry $${entryPrice.toFixed(6)} <= market $${currentPrice.toFixed(6)} - would instant fill` }
                }
                const distAboveMarket = ((entryPrice - currentPrice) / currentPrice) * 100
                if (distAboveMarket < ENTRY_SAFETY_BUFFER) {
                    return { valid: false, reason: `SHORT entry only ${distAboveMarket.toFixed(3)}% above market - too close` }
                }
                // SL must be ABOVE entry
                if (stopPrice <= entryPrice) {
                    return { valid: false, reason: `SHORT SL $${stopPrice} <= entry $${entryPrice}` }
                }
                const slDist = ((stopPrice - entryPrice) / entryPrice) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    return { valid: false, reason: `SHORT SL only ${slDist.toFixed(3)}% from entry - too close` }
                }
                // TP must be BELOW entry
                if (targetPrice && targetPrice >= entryPrice) {
                    return { valid: false, reason: `SHORT TP $${targetPrice} >= entry $${entryPrice}` }
                }
            }
            
            return { valid: true }
        } catch (error) {
            // On error, allow the order but log warning
            this.log(`⚠️ Pre-order validation error for ${signal.asset}: ${(error as Error).message}`, 'error')
            return { valid: true } // Fail-safe: allow order if validation fails
        }
    }

    /**
     * Get human-readable string of active filters
     */
    private getActiveFiltersString(store: any): string {
        const filters: string[] = []
        if (store.blacklistedAssets.length > 0) filters.push(`Blacklist(${store.blacklistedAssets.length})`)
        
        // Signal types
        const types: string[] = []
        if (store.rangingEnabled) types.push('Ranging')
        if (store.liquidityEnabled) types.push('Liquidity')
        if (store.enhancedEnabled) types.push('Enhanced')
        if (store.v3Enabled) types.push('V3')
        if (types.length > 0) filters.push(`Types(${types.join(',')})`)
        
        if (store.confidenceEnabled) filters.push(`Conf>=${(store.minConfidence*100).toFixed(0)}%`)
        if (store.rrEnabled) filters.push(`R:R(${store.minRR}-${store.maxRR})`)
        if (store.entryDistanceEnabled) filters.push(`Entry(${store.minEntryDistance}-${store.maxEntryDistance}%)`)
        if (store.tpDistanceEnabled) filters.push(`TP(${store.minTpDistance}-${store.maxTpDistance}%)`)
        if (store.slDistanceEnabled) filters.push(`SL(${store.minSlDistance}-${store.maxSlDistance}%)`)
        
        return filters.length > 0 ? filters.join(', ') : 'None'
    }
    
    /**
     * Count enabled filters for logging
     */
    private countEnabledFilters(store: any): number {
        let count = 0
        if (store.blacklistedAssets.length > 0) count++
        // Signal types
        const enabledTypes = [store.rangingEnabled, store.liquidityEnabled, store.enhancedEnabled, store.v3Enabled].filter(Boolean)
        if (enabledTypes.length > 0) count++
        if (store.confidenceEnabled) count++
        if (store.rrEnabled) count++
        if (store.entryDistanceEnabled) count++
        if (store.tpDistanceEnabled) count++
        if (store.slDistanceEnabled) count++
        // Position limits always active
        count++
        // Side validation always active
        count++
        return count
    }
    
    /**
     * Apply filters with step-by-step UI console logging
     */
    private applyFiltersWithStats(signals: TradeSignal[], store: any): { passed: TradeSignal[]; failed: TradeSignal[]; filterStats: Map<string, number> } {
        const filterStats = new Map<string, number>()
        let remaining = [...signals]
        const modeStr = store.activeMode === 'volume' ? `Volume (Risk ${store.riskLevel})` : 'Advanced'
        const blacklistSet = new Set(
            store.blacklistedAssets.map((asset: string) => this.normalizeAssetName(asset)).filter(Boolean)
        )
        
        this.log(`\n📊 [FILTER PIPELINE] Mode: ${modeStr} | Starting with ${remaining.length} signals`, 'info')
        
        // Step 1: Blacklist filter
        const beforeBlacklist = remaining.length
        remaining = remaining.filter(s => !blacklistSet.has(this.normalizeAssetName(s.asset)))
        const blacklistRemoved = beforeBlacklist - remaining.length
        if (blacklistRemoved > 0) {
            filterStats.set('Blacklisted', blacklistRemoved)
            this.log(`  ❌ Blacklist: -${blacklistRemoved} (${remaining.length} remain)`, 'info')
        } else {
            this.log(`  ✓ Blacklist (${store.blacklistedAssets.length} assets): 0 filtered`, 'info')
        }
        
        // Step 2: Signal type filter
        const enabledTypes: string[] = []
        if (store.rangingEnabled) enabledTypes.push('ta_range')
        if (store.liquidityEnabled) enabledTypes.push('standard')
        if (store.enhancedEnabled) enabledTypes.push('ta_based')
        if (store.v3Enabled) enabledTypes.push('v3')
        
        this.log(`  🔌 Signal Types: ${enabledTypes.length > 0 ? enabledTypes.join(', ') : 'NONE'}`, 'info')
        
        if (enabledTypes.length === 0) {
            filterStats.set('No signal types enabled', remaining.length)
            this.log(`  ❌ No signal types enabled: -${remaining.length} (0 remain)`, 'error')
            return { passed: [], failed: signals, filterStats }
        }
        
        const beforeTypes = remaining.length
        remaining = remaining.filter(s => enabledTypes.includes(s.signal_type || ''))
        const typesRemoved = beforeTypes - remaining.length
        if (typesRemoved > 0) {
            filterStats.set('Signal type disabled', typesRemoved)
            this.log(`  ❌ Signal Type: -${typesRemoved} (${remaining.length} remain)`, 'info')
        } else {
            this.log(`  ✓ Signal Type: 0 filtered`, 'info')
        }
        
        // Step 3: Confidence filter
        if (store.confidenceEnabled) {
            const beforeConf = remaining.length
            remaining = remaining.filter(s => (s.confidence || 0) >= store.minConfidence)
            const confRemoved = beforeConf - remaining.length
            if (confRemoved > 0) {
                filterStats.set('Low confidence', confRemoved)
                this.log(`  ❌ Confidence (<${store.minConfidence}): -${confRemoved} (${remaining.length} remain)`, 'info')
            } else {
                this.log(`  ✓ Confidence (>=${store.minConfidence}): 0 filtered`, 'info')
            }
        } else {
            this.log(`  ⏭️ Confidence: DISABLED`, 'info')
        }
        
        // Step 4: Market bias adjustment
        const biasStr = `Long: ${store.longBiasEnabled ? store.longBias + '%' : 'OFF'}, Short: ${store.shortBiasEnabled ? store.shortBias + '%' : 'OFF'}`
        const biasResult = this.applyMarketBiasAdjustments(remaining, store)
        remaining = biasResult.adjustedSignals
        this.log(`  🎯 Market Bias (${biasStr}): ${biasResult.adjustedCount} adjusted`, 'info')

        // Step 5: R:R filter
        if (store.rrEnabled) {
            const beforeRR = remaining.length
            remaining = remaining.filter(s => {
                const rr = this.calculateRR(s)
                return rr >= store.minRR && rr <= store.maxRR
            })
            const rrRemoved = beforeRR - remaining.length
            if (rrRemoved > 0) {
                filterStats.set('R:R out of range', rrRemoved)
                this.log(`  ❌ R:R (${store.minRR}-${store.maxRR}): -${rrRemoved} (${remaining.length} remain)`, 'info')
            } else {
                this.log(`  ✓ R:R (${store.minRR}-${store.maxRR}): 0 filtered`, 'info')
            }
        } else {
            this.log(`  ⏭️ R:R Filter: DISABLED`, 'info')
        }
        
        // Step 6: Entry distance filter
        if (store.entryDistanceEnabled) {
            const beforeEntry = remaining.length
            remaining = remaining.filter(s => {
                if (!s.current_price) return true
                const dist = this.calculateDistance(s.current_price, s.entry_price)
                return dist >= store.minEntryDistance && dist <= store.maxEntryDistance
            })
            const entryRemoved = beforeEntry - remaining.length
            if (entryRemoved > 0) {
                filterStats.set('Entry distance', entryRemoved)
                this.log(`  ❌ Entry Dist (${store.minEntryDistance}-${store.maxEntryDistance}%): -${entryRemoved} (${remaining.length} remain)`, 'info')
            } else {
                this.log(`  ✓ Entry Dist (${store.minEntryDistance}-${store.maxEntryDistance}%): 0 filtered`, 'info')
            }
        } else {
            this.log(`  ⏭️ Entry Distance: DISABLED`, 'info')
        }
        
        // Step 7: TP distance filter
        if (store.tpDistanceEnabled) {
            const beforeTP = remaining.length
            remaining = remaining.filter(s => {
                const dist = this.calculateDistance(s.entry_price, s.target_price)
                return dist >= store.minTpDistance && dist <= store.maxTpDistance
            })
            const tpRemoved = beforeTP - remaining.length
            if (tpRemoved > 0) {
                filterStats.set('TP distance', tpRemoved)
                this.log(`  ❌ TP Dist (${store.minTpDistance}-${store.maxTpDistance}%): -${tpRemoved} (${remaining.length} remain)`, 'info')
            } else {
                this.log(`  ✓ TP Dist (${store.minTpDistance}-${store.maxTpDistance}%): 0 filtered`, 'info')
            }
        } else {
            this.log(`  ⏭️ TP Distance: DISABLED`, 'info')
        }
        
        // Step 8: SL distance filter
        if (store.slDistanceEnabled) {
            const beforeSL = remaining.length
            remaining = remaining.filter(s => {
                const dist = this.calculateDistance(s.entry_price, s.stop_price)
                return dist >= store.minSlDistance && dist <= store.maxSlDistance
            })
            const slRemoved = beforeSL - remaining.length
            if (slRemoved > 0) {
                filterStats.set('SL distance', slRemoved)
                this.log(`  ❌ SL Dist (${store.minSlDistance}-${store.maxSlDistance}%): -${slRemoved} (${remaining.length} remain)`, 'info')
            } else {
                this.log(`  ✓ SL Dist (${store.minSlDistance}-${store.maxSlDistance}%): 0 filtered`, 'info')
            }
        } else {
            this.log(`  ⏭️ SL Distance: DISABLED`, 'info')
        }
        
        // Step 9: Position limits
        const longCount = this.currentPositions.filter(p => p.side === 'long').length
        const shortCount = this.currentPositions.filter(p => p.side === 'short').length
        const limits = this.getEffectivePositionLimits(store)
        
        this.log(`  📈 Position Counts: ${longCount}/${limits.maxLongs} longs, ${shortCount}/${limits.maxShorts} shorts`, 'info')
        
        const beforeLimits = remaining.length
        remaining = remaining.filter(s => {
            if (s.direction === 'long' && longCount >= limits.maxLongs) return false
            if (s.direction === 'short' && shortCount >= limits.maxShorts) return false
            return true
        })
        const limitsRemoved = beforeLimits - remaining.length
        if (limitsRemoved > 0) {
            filterStats.set('Position limit', limitsRemoved)
            this.log(`  ❌ Position Limits: -${limitsRemoved} (${remaining.length} remain)`, 'info')
        } else {
            this.log(`  ✓ Position Limits: 0 filtered`, 'info')
        }
        
        // Step 10: Side-aware validation (instant fill, SL/TP placement, invalid prices)
        // Hidden safety checks - universal for both Volume and Advanced mode
        const beforeValidation = remaining.length
        const ENTRY_SAFETY_BUFFER = 0.1   // 0.1% min distance from current price
        const SL_SAFETY_BUFFER = 0.15     // 0.15% min SL distance from entry
        
        remaining = remaining.filter(s => {
            // Reject invalid/zero prices (matches old codebase)
            if (!s.entry_price || s.entry_price <= 0 || isNaN(s.entry_price)) return false
            if (!s.stop_price || s.stop_price <= 0 || isNaN(s.stop_price)) return false
            // TP is optional but if provided must be valid
            if (s.target_price && (s.target_price <= 0 || isNaN(s.target_price))) return false
            
            if (!s.current_price) return true
            
            if (s.direction === 'long') {
                // Entry must be BELOW current price (limit buy)
                if (s.entry_price >= s.current_price) return false
                const distBelowMarket = ((s.current_price - s.entry_price) / s.current_price) * 100
                if (distBelowMarket < ENTRY_SAFETY_BUFFER) return false
                // SL must be BELOW entry
                if (s.stop_price >= s.entry_price) return false
                const slDist = ((s.entry_price - s.stop_price) / s.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) return false
                // TP must be ABOVE entry
                if (s.target_price && s.target_price <= s.entry_price) return false
            } else {
                // Entry must be ABOVE current price (limit sell)
                if (s.entry_price <= s.current_price) return false
                const distAboveMarket = ((s.entry_price - s.current_price) / s.current_price) * 100
                if (distAboveMarket < ENTRY_SAFETY_BUFFER) return false
                // SL must be ABOVE entry
                if (s.stop_price <= s.entry_price) return false
                const slDist = ((s.stop_price - s.entry_price) / s.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) return false
                // TP must be BELOW entry
                if (s.target_price && s.target_price >= s.entry_price) return false
            }
            return true
        })
        const validationRemoved = beforeValidation - remaining.length
        if (validationRemoved > 0) {
            filterStats.set('Side validation', validationRemoved)
            this.log(`  ❌ Side Validation: -${validationRemoved} (${remaining.length} remain)`, 'info')
        } else {
            this.log(`  ✓ Side Validation: 0 filtered`, 'info')
        }
        
        // Step 11: Order Layering filter (checks existing positions/orders)
        const beforeLayering = remaining.length
        remaining = remaining.filter(s => {
            const existingPosition = this.currentPositions.find(p => p.asset === s.asset)
            const existingOrders = this.currentOpenOrders.filter(o => o.asset === s.asset)
            const hasLongOrders = existingOrders.some(o => o.side === 'long') || 
                this.pendingOrders.has(`${s.asset}_LONG`)
            const hasShortOrders = existingOrders.some(o => o.side === 'short') || 
                this.pendingOrders.has(`${s.asset}_SHORT`)
            
            if (store.orderLayering) {
                // Order layering ENABLED
                if (store.crossOrder) {
                    // Cross orders enabled: Allow 1 long + 1 short per asset
                    if (existingPosition && existingPosition.side === s.direction) return false
                    if (s.direction === 'long' && hasLongOrders) return false
                    if (s.direction === 'short' && hasShortOrders) return false
                } else {
                    // Cross orders disabled: Block opposite direction
                    if (existingPosition && existingPosition.side !== s.direction) return false
                    if ((s.direction === 'long' && hasShortOrders) || 
                        (s.direction === 'short' && hasLongOrders)) return false
                }
            } else {
                // Order layering DISABLED - no additional orders if ANY exposure exists
                if (existingPosition || existingOrders.length > 0 || hasLongOrders || hasShortOrders) return false
            }
            return true
        })
        const layeringRemoved = beforeLayering - remaining.length
        const layeringStr = `Layering=${store.orderLayering ? 'ON' : 'OFF'}, CrossOrder=${store.crossOrder ? 'ON' : 'OFF'}`
        if (layeringRemoved > 0) {
            filterStats.set('Order layering', layeringRemoved)
            this.log(`  ❌ Order Layering (${layeringStr}): -${layeringRemoved} (${remaining.length} remain)`, 'info')
        } else {
            this.log(`  ✓ Order Layering (${layeringStr}): 0 filtered`, 'info')
        }
        
        // Final summary
        const totalRemoved = signals.length - remaining.length
        const passRate = signals.length > 0 ? ((remaining.length / signals.length) * 100).toFixed(1) : '0'
        this.log(`\n✅ [FILTER RESULT] ${remaining.length}/${signals.length} passed (${passRate}%), ${totalRemoved} filtered out`, 'info')
        
        // Build failed list
        const passedSet = new Set(remaining.map(s => s.id))
        const failed = signals.filter(s => !passedSet.has(s.id))
        
        return { passed: remaining, failed, filterStats }
    }
    
    /**
     * Apply filters with detailed rejection reasons
     */
    private applyFiltersDetailed(signal: TradeSignal, store: any): { passed: boolean; reason?: string } {
        // Blacklist filter
        if (this.isBlacklisted(signal.asset, store)) {
            return { passed: false, reason: 'Blacklisted' }
        }

        // Signal type filters
        const signalType = signal.signal_type || ''
        const enabledTypes: string[] = []
        if (store.rangingEnabled) enabledTypes.push('ta_range')
        if (store.liquidityEnabled) enabledTypes.push('standard')
        if (store.enhancedEnabled) enabledTypes.push('ta_based')
        if (store.v3Enabled) enabledTypes.push('v3')
        
        if (enabledTypes.length === 0) {
            return { passed: false, reason: 'No signal types enabled' }
        }
        
        if (!enabledTypes.includes(signalType)) {
            return { passed: false, reason: `Signal type '${signalType}' disabled` }
        }

        // Confidence filter
        if (store.confidenceEnabled) {
            const confidence = signal.confidence || 0
            if (confidence < store.minConfidence) {
                return { passed: false, reason: 'Low confidence' }
            }
        }

        // Reward/Risk filter
        if (store.rrEnabled) {
            const rr = this.calculateRR(signal)
            if (rr < store.minRR || rr > store.maxRR) {
                return { passed: false, reason: 'R:R out of range' }
            }
        }

        // Entry distance filter
        if (store.entryDistanceEnabled && signal.current_price) {
            const entryDist = this.calculateDistance(signal.current_price, signal.entry_price)
            if (entryDist < store.minEntryDistance || entryDist > store.maxEntryDistance) {
                return { passed: false, reason: 'Entry distance' }
            }
        }

        // TP Distance filter
        if (store.tpDistanceEnabled) {
            const tpDist = this.calculateDistance(signal.entry_price, signal.target_price)
            if (tpDist < store.minTpDistance || tpDist > store.maxTpDistance) {
                return { passed: false, reason: 'TP distance' }
            }
        }

        // SL Distance filter
        if (store.slDistanceEnabled) {
            const slDist = this.calculateDistance(signal.entry_price, signal.stop_price)
            if (slDist < store.minSlDistance || slDist > store.maxSlDistance) {
                return { passed: false, reason: 'SL distance' }
            }
        }

        // Position limits (use effective limits based on mode)
        const longCount = this.currentPositions.filter(p => p.side === 'long').length
        const shortCount = this.currentPositions.filter(p => p.side === 'short').length
        const limits = this.getEffectivePositionLimits(store)

        if (signal.direction === 'long' && longCount >= limits.maxLongs) {
            return { passed: false, reason: 'Max longs reached' }
        }
        if (signal.direction === 'short' && shortCount >= limits.maxShorts) {
            return { passed: false, reason: 'Max shorts reached' }
        }

        // Side-aware validation
        const ENTRY_SAFETY_BUFFER = 0.1
        const SL_SAFETY_BUFFER = 0.15
        
        if (signal.current_price) {
            if (signal.direction === 'long') {
                if (signal.entry_price >= signal.current_price) {
                    return { passed: false, reason: 'LONG entry would instant fill' }
                }
                const distBelowMarket = ((signal.current_price - signal.entry_price) / signal.current_price) * 100
                if (distBelowMarket < ENTRY_SAFETY_BUFFER) {
                    return { passed: false, reason: 'LONG entry too close to market' }
                }
                if (signal.stop_price >= signal.entry_price) {
                    return { passed: false, reason: 'LONG SL above entry' }
                }
                const slDist = ((signal.entry_price - signal.stop_price) / signal.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    return { passed: false, reason: 'LONG SL too close' }
                }
            } else {
                if (signal.entry_price <= signal.current_price) {
                    return { passed: false, reason: 'SHORT entry would instant fill' }
                }
                const distAboveMarket = ((signal.entry_price - signal.current_price) / signal.current_price) * 100
                if (distAboveMarket < ENTRY_SAFETY_BUFFER) {
                    return { passed: false, reason: 'SHORT entry too close to market' }
                }
                if (signal.stop_price <= signal.entry_price) {
                    return { passed: false, reason: 'SHORT SL below entry' }
                }
                const slDist = ((signal.stop_price - signal.entry_price) / signal.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    return { passed: false, reason: 'SHORT SL too close' }
                }
            }
        }
        
        return { passed: true }
    }

    private applyFilters(signal: TradeSignal, store: any): boolean {
        // Blacklist filter
        if (this.isBlacklisted(signal.asset, store)) {
            this.log(`[Filter] ${signal.asset} blacklisted`)
            return false
        }

        // Signal type filters - use exact matching
        // Map: rangingEnabled -> 'ta_range', liquidityEnabled -> 'standard', enhancedEnabled -> 'ta_based', v3Enabled -> 'v3'
        const signalType = signal.signal_type || ''
        const enabledTypes: string[] = []
        if (store.rangingEnabled) enabledTypes.push('ta_range')
        if (store.liquidityEnabled) enabledTypes.push('standard')
        if (store.enhancedEnabled) enabledTypes.push('ta_based')
        if (store.v3Enabled) enabledTypes.push('v3')
        
        if (enabledTypes.length === 0) {
            this.log(`[Filter] ${signal.asset} no signal types enabled`)
            return false
        }
        
        if (!enabledTypes.includes(signalType)) {
            this.log(`[Filter] ${signal.asset} signal type '${signalType}' not in enabled types`)
            return false
        }

        // Confidence filter
        if (store.confidenceEnabled) {
            const confidence = signal.confidence || 0
            if (confidence < store.minConfidence) {
                this.log(`[Filter] ${signal.asset} confidence ${(confidence*100).toFixed(0)}% < ${(store.minConfidence*100).toFixed(0)}%`)
                return false
            }
        }

        // Reward/Risk filter
        if (store.rrEnabled) {
            const rr = this.calculateRR(signal)
            if (rr < store.minRR || rr > store.maxRR) {
                this.log(`[Filter] ${signal.asset} R:R ${rr.toFixed(2)} not in ${store.minRR}-${store.maxRR}`)
                return false
            }
        }

        // Entry distance filter (distance from current price to entry)
        if (store.entryDistanceEnabled && signal.current_price) {
            const entryDist = this.calculateDistance(signal.current_price, signal.entry_price)
            if (entryDist < store.minEntryDistance || entryDist > store.maxEntryDistance) {
                this.log(`[Filter] ${signal.asset} entry distance ${entryDist.toFixed(2)}% not in ${store.minEntryDistance}-${store.maxEntryDistance}%`)
                return false
            }
        }

        // TP Distance filter
        if (store.tpDistanceEnabled) {
            const tpDist = this.calculateDistance(signal.entry_price, signal.target_price)
            if (tpDist < store.minTpDistance || tpDist > store.maxTpDistance) {
                this.log(`[Filter] ${signal.asset} TP distance ${tpDist.toFixed(2)}% not in ${store.minTpDistance}-${store.maxTpDistance}%`)
                return false
            }
        }

        // SL Distance filter
        if (store.slDistanceEnabled) {
            const slDist = this.calculateDistance(signal.entry_price, signal.stop_price)
            if (slDist < store.minSlDistance || slDist > store.maxSlDistance) {
                this.log(`[Filter] ${signal.asset} SL distance ${slDist.toFixed(2)}% not in ${store.minSlDistance}-${store.maxSlDistance}%`)
                return false
            }
        }

        // Position limits (use effective limits based on mode)
        const longCount = this.currentPositions.filter(p => p.side === 'long').length
        const shortCount = this.currentPositions.filter(p => p.side === 'short').length
        const limits = this.getEffectivePositionLimits(store)

        if (signal.direction === 'long' && longCount >= limits.maxLongs) {
            this.log(`[Filter] ${signal.asset} max longs reached (${longCount}/${limits.maxLongs})`)
            return false
        }
        if (signal.direction === 'short' && shortCount >= limits.maxShorts) {
            this.log(`[Filter] ${signal.asset} max shorts reached (${shortCount}/${limits.maxShorts})`)
            return false
        }

        // Side-aware validation - entry and SL must be on correct sides
        const ENTRY_SAFETY_BUFFER = 0.1  // 0.1% minimum distance from market
        const SL_SAFETY_BUFFER = 0.15    // 0.15% minimum SL distance from entry
        
        if (signal.current_price) {
            if (signal.direction === 'long') {
                // LONG: Entry must be BELOW current price (limit buy)
                if (signal.entry_price >= signal.current_price) {
                    this.log(`[Filter] ${signal.asset} LONG entry $${signal.entry_price} >= market $${signal.current_price} - would instant fill`)
                    return false
                }
                const distBelowMarket = ((signal.current_price - signal.entry_price) / signal.current_price) * 100
                if (distBelowMarket < ENTRY_SAFETY_BUFFER) {
                    this.log(`[Filter] ${signal.asset} LONG entry only ${distBelowMarket.toFixed(2)}% below market - too close`)
                    return false
                }
                // SL must be BELOW entry for longs
                if (signal.stop_price >= signal.entry_price) {
                    this.log(`[Filter] ${signal.asset} LONG SL $${signal.stop_price} not below entry $${signal.entry_price}`)
                    return false
                }
                const slDist = ((signal.entry_price - signal.stop_price) / signal.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    this.log(`[Filter] ${signal.asset} LONG SL too close (${slDist.toFixed(2)}% < ${SL_SAFETY_BUFFER}%)`)
                    return false
                }
            } else {
                // SHORT: Entry must be ABOVE current price (limit sell)
                if (signal.entry_price <= signal.current_price) {
                    this.log(`[Filter] ${signal.asset} SHORT entry $${signal.entry_price} <= market $${signal.current_price} - would instant fill`)
                    return false
                }
                const distAboveMarket = ((signal.entry_price - signal.current_price) / signal.current_price) * 100
                if (distAboveMarket < ENTRY_SAFETY_BUFFER) {
                    this.log(`[Filter] ${signal.asset} SHORT entry only ${distAboveMarket.toFixed(2)}% above market - too close`)
                    return false
                }
                // SL must be ABOVE entry for shorts
                if (signal.stop_price <= signal.entry_price) {
                    this.log(`[Filter] ${signal.asset} SHORT SL $${signal.stop_price} not above entry $${signal.entry_price}`)
                    return false
                }
                const slDist = ((signal.stop_price - signal.entry_price) / signal.entry_price) * 100
                if (slDist < SL_SAFETY_BUFFER) {
                    this.log(`[Filter] ${signal.asset} SHORT SL too close (${slDist.toFixed(2)}% < ${SL_SAFETY_BUFFER}%)`)
                    return false
                }
            }
            
            // TP validation (side-aware)
            if (signal.target_price) {
                if (signal.direction === 'long' && signal.target_price <= signal.entry_price) {
                    this.log(`[Filter] ${signal.asset} LONG TP $${signal.target_price} not above entry $${signal.entry_price}`)
                    return false
                }
                if (signal.direction === 'short' && signal.target_price >= signal.entry_price) {
                    this.log(`[Filter] ${signal.asset} SHORT TP $${signal.target_price} not below entry $${signal.entry_price}`)
                    return false
                }
            }
        }

        // Order layering check
        // Check BOTH positions AND open orders (critical safety feature)
        const existingPosition = this.currentPositions.find(p => p.asset === signal.asset)
        const existingOrders = this.currentOpenOrders.filter(o => o.asset === signal.asset)
        const hasLongOrders = existingOrders.some(o => o.side === 'long') || 
            this.pendingOrders.has(`${signal.asset}_LONG`)
        const hasShortOrders = existingOrders.some(o => o.side === 'short') || 
            this.pendingOrders.has(`${signal.asset}_SHORT`)
        
        if (store.orderLayering) {
            // Order layering ENABLED
            if (store.crossOrder) {
                // Cross orders enabled: Allow 1 long + 1 short per asset
                // Block if same direction position exists
                if (existingPosition && existingPosition.side === signal.direction) {
                    this.log(`[Filter] ${signal.asset} already has ${signal.direction} position`)
                    return false
                }
                // Block if same direction order exists
                if (signal.direction === 'long' && hasLongOrders) {
                    this.log(`[Filter] ${signal.asset} already has LONG order pending`)
                    return false
                }
                if (signal.direction === 'short' && hasShortOrders) {
                    this.log(`[Filter] ${signal.asset} already has SHORT order pending`)
                    return false
                }
            } else {
                // Cross orders disabled: Block opposite direction
                if (existingPosition && existingPosition.side !== signal.direction) {
                    this.log(`[Filter] ${signal.asset} has ${existingPosition.side} position, blocking ${signal.direction}`)
                    return false
                }
                if ((signal.direction === 'long' && hasShortOrders) || 
                    (signal.direction === 'short' && hasLongOrders)) {
                    this.log(`[Filter] ${signal.asset} has opposite direction order pending`)
                    return false
                }
            }
        } else {
            // Order layering DISABLED - no additional orders if ANY exposure exists
            if (existingPosition || existingOrders.length > 0 || hasLongOrders || hasShortOrders) {
                this.log(`[Filter] ${signal.asset} already has exposure (layering disabled)`)
                return false
            }
        }

        this.log(`[Filter] ${signal.asset} ${signal.direction.toUpperCase()} PASSED all filters`, 'success')
        return true
    }

    private calculateRR(signal: TradeSignal): number {
        const entry = signal.entry_price
        const tp = signal.target_price
        const sl = signal.stop_price
        if (!entry || !tp || !sl) return 0
        const reward = Math.abs(tp - entry)
        const risk = Math.abs(entry - sl)
        return risk === 0 ? 0 : reward / risk
    }

    private calculateDistance(price1: number, price2: number): number {
        if (!price1 || !price2) return 0
        return Math.abs((price2 - price1) / price1) * 100
    }

    private async executeTrade(signal: TradeSignal, store: any) {
        if (!this.exchClient) throw new Error('Not initialized')

        // Get asset metadata (HIP-3 aware)
        const isHip3 = signal.asset.includes(':')
        const dexParam = isHip3 ? signal.asset.split(':')[0] : ''
        const meta = await (this.infoClient as any).meta(dexParam ? { dex: dexParam } : undefined)
        const assetMeta = meta.universe.find((a: any) => a.name === signal.asset)
        if (!assetMeta) throw new Error(`Asset ${signal.asset} not found in ${dexParam || 'main'} DEX`)
        let assetIndex = meta.universe.indexOf(assetMeta)

        // Compute absolute index for HIP-3 assets
        if (isHip3) {
            const allDexs = await (this.infoClient as any).perpDexs()
            let dexPosition = -1
            for (let i = 0; i < allDexs.length; i++) {
                if (allDexs[i] !== null && allDexs[i]?.name === dexParam) {
                    dexPosition = allDexs.slice(0, i).filter((d: any) => d !== null).length
                    break
                }
            }
            if (dexPosition >= 0) {
                assetIndex = assetIndex + 110000 + (dexPosition * 10000)
            }
        }

        // Calculate position size
        const size = await this.calculatePositionSize(signal, store, assetMeta)
        if (size <= 0) throw new Error('Invalid position size')

        const isBuy = signal.direction === 'long'
        const roundedSize = this.roundSize(size, assetMeta)
        
        // Generate unique CLOID for order tracking
        const cloid = this.generateCLOID()
        
        // Build orders array - entry + optional TP/SL bundled together
        const orders: any[] = []
        const hasTPSL = signal.target_price || signal.stop_price
        
        // Entry order - use GTC limit at entry price
        orders.push({
            a: assetIndex,
            b: isBuy,
            p: this.roundPrice(signal.entry_price, assetMeta),
            s: roundedSize,
            r: false,
            t: { limit: { tif: 'Gtc' } },
            c: cloid
        })
        
        // Add TP order if target price provided
        if (signal.target_price) {
            orders.push({
                a: assetIndex,
                b: !isBuy, // Opposite side to close
                p: this.roundPrice(signal.target_price, assetMeta),
                s: roundedSize,
                r: true, // Reduce only
                t: {
                    trigger: {
                        isMarket: false, // Limit for better fill
                        triggerPx: this.roundPrice(signal.target_price, assetMeta),
                        tpsl: 'tp'
                    }
                },
                c: cloid
            })
        }
        
        // Add SL order if stop price provided
        if (signal.stop_price) {
            orders.push({
                a: assetIndex,
                b: !isBuy, // Opposite side to close
                p: this.roundPrice(signal.stop_price, assetMeta),
                s: roundedSize,
                r: true, // Reduce only
                t: {
                    trigger: {
                        isMarket: true, // Market for guaranteed execution
                        triggerPx: this.roundPrice(signal.stop_price, assetMeta),
                        tpsl: 'sl'
                    }
                },
                c: cloid
            })
        }

        // Use normalTpsl grouping when bundling entry with TP/SL
        const grouping = hasTPSL ? 'normalTpsl' : 'na'
        
        const orderResult = await this.exchClient.order({
            orders,
            grouping,
            builder: {
                b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                f: 10
            }
        })

        this.log(`${signal.direction.toUpperCase()} ${signal.asset} @ $${signal.entry_price} size=${roundedSize}${hasTPSL ? ' +TP/SL' : ''}`, 'success')

        return orderResult
    }
    
    private async resolveAssetIndex(assetSymbol: string): Promise<number | null> {
        try {
            const isHip3 = assetSymbol.includes(':')
            const dexParam = isHip3 ? assetSymbol.split(':')[0] : ''
            const meta = await (this.infoClient as any).meta(dexParam ? { dex: dexParam } : undefined)
            const relativeIndex = meta.universe.findIndex((a: any) => a.name === assetSymbol)
            if (relativeIndex === -1) return null

            let assetIndex = relativeIndex
            if (isHip3) {
                const allDexs = await (this.infoClient as any).perpDexs()
                let dexPosition = -1
                for (let i = 0; i < allDexs.length; i++) {
                    if (allDexs[i] !== null && allDexs[i]?.name === dexParam) {
                        dexPosition = allDexs.slice(0, i).filter((d: any) => d !== null).length
                        break
                    }
                }
                if (dexPosition >= 0) {
                    assetIndex = relativeIndex + 110000 + (dexPosition * 10000)
                }
            }
            return assetIndex
        } catch {
            return null
        }
    }

    // Generate unique CLOID for order tracking
    private generateCLOID(): string {
        let now = Date.now()
        
        if (now !== this._cloidLastMs) {
            this._cloidCounter = 0
            this._cloidLastMs = now
        } else {
            this._cloidCounter++
            if (this._cloidCounter > 0xFFFF) {
                while (Date.now() === this._cloidLastMs) { /* spin */ }
                now = Date.now()
                this._cloidCounter = 0
                this._cloidLastMs = now
            }
        }
        
        const timestampHex = now.toString(16)
        const counterHex = this._cloidCounter.toString(16).padStart(4, '0')
        return '0x' + (timestampHex + counterHex).padStart(32, '0')
    }
    
    /**
     * Round price to proper tick size based on asset's szDecimals + 5 sig figs rule
     * Matches BrowserHyperliquidClient.roundToTickSize()
     */
    private roundPrice(price: number, assetMeta: any): string {
        if (!price || price <= 0 || isNaN(price)) {
            return '0'
        }
        
        const szDecimals = assetMeta.szDecimals ?? 3
        const maxDecimals = 6 // MAX_DECIMALS for perps
        const priceDecimals = maxDecimals - szDecimals
        
        // Apply Hyperliquid's 5 significant figures rule
        const significantFigures = 5
        const magnitude = Math.floor(Math.log10(Math.abs(price)))
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1))
        
        // Round to the calculated decimal places
        const multiplier = Math.pow(10, maxDecimalPlaces)
        const result = Math.round(price * multiplier) / multiplier
        
        return result.toString()
    }
    
    /**
     * Round size to asset's szDecimals
     * Matches BrowserHyperliquidClient.roundToSizeDecimals() EXACTLY
     */
    private roundSize(size: number, assetMeta: any): string {
        if (size === null || size === undefined || isNaN(size)) {
            return '0'
        }
        
        const numSize = typeof size === 'string' ? parseFloat(size) : size
        
        if (isNaN(numSize) || numSize <= 0) {
            return '0'
        }
        
        // Use szDecimals from asset metadata, with safe fallback (old codebase uses 5)
        const decimals = assetMeta?.szDecimals !== undefined ? assetMeta.szDecimals : 5
        
        // Handle edge cases for very small or very large numbers (from old codebase)
        if (numSize < 1e-15) {
            return '0'
        }
        
        if (numSize > 1e15) {
            const scientific = numSize.toExponential()
            const rounded = parseFloat(parseFloat(scientific).toFixed(decimals))
            return rounded.toString()
        }
        
        // Standard rounding for normal range numbers
        const result = parseFloat(numSize.toFixed(decimals))
        
        // Remove trailing zeros by converting back to number then string
        const finalResult = parseFloat(result.toString())
        
        return finalResult.toString()
    }
    
    /**
     * Format price for display - handles small prices properly
     * Uses toPrecision for small prices, toFixed for larger ones
     */
    private formatPrice(price: number): string {
        if (!price || price <= 0 || isNaN(price)) {
            return '0'
        }
        // For very small prices (< 0.01), use toPrecision to show meaningful digits
        if (price < 0.01) {
            return price.toPrecision(4)
        }
        // For small prices (< 1), show 4 decimal places
        if (price < 1) {
            return price.toFixed(4)
        }
        // For normal prices, show 2 decimal places
        return price.toFixed(2)
    }

    private async calculatePositionSize(signal: TradeSignal, store: any, assetMeta: any): Promise<number> {
        const positionSizeStr = store.positionSize || '2.5%'
        const entryPrice = signal.entry_price
        
        // Validate entry price
        if (!entryPrice || entryPrice <= 0 || isNaN(entryPrice)) {
            this.log(`Invalid entry price for ${signal.asset}: ${entryPrice}`, 'error')
            return 0
        }
        
        // Use global account value from store, fallback to API if needed
        let accountValue = this.globalAccountValue
        if (accountValue <= 0) {
            try {
                const clearinghouse = await this.infoClient.clearinghouseState({ user: this.userAddress! })
                accountValue = parseFloat(clearinghouse?.marginSummary?.accountValue || '0')
            } catch (e) {
                this.log('Failed to fetch account value', 'error')
                return 0
            }
        }
        
        if (accountValue <= 0) {
            this.log('Account value is 0', 'error')
            return 0
        }
        
        // Parse position size (supports % and $ formats)
        const parsed = parsePositionSize(positionSizeStr)
        
        // STEP 1: Calculate MARGIN amount (what user is risking)
        let marginAmount: number
        
        if (parsed.type === 'percentage') {
            // Percentage of account
            marginAmount = (accountValue * parsed.value) / 100
        } else {
            // Fixed USD margin
            marginAmount = parsed.value
            // Cap at 95% of account
            if (marginAmount > accountValue) {
                marginAmount = accountValue * 0.95
            }
        }
        
        // STEP 2: Get asset's max leverage
        let maxLeverage = assetMeta?.maxLeverage || 20
        if (maxLeverage < 3) maxLeverage = 20
        
        // STEP 3: Calculate NOTIONAL value (margin × leverage)
        let notionalAmount = marginAmount * maxLeverage
        
        // STEP 4: Scale up if enabled and notional < $10 minimum
        if (store.scaleUpSize && notionalAmount < 10) {
            notionalAmount = 13 // $13 buffer for $10 minimum
        }
        
        // Ensure minimum notional
        if (notionalAmount < 10) {
            this.log(`Notional $${notionalAmount.toFixed(2)} below $10 minimum (scale up disabled)`, 'error')
            return 0
        }
        
        // STEP 5: Convert notional to asset quantity
        const assetSize = notionalAmount / entryPrice
        
        this.log(`Size calc: $${marginAmount.toFixed(0)} margin × ${maxLeverage}x = $${notionalAmount.toFixed(0)} notional → ${assetSize.toPrecision(4)} ${signal.asset}`)
        
        return assetSize
    }

    getStatus() {
        return {
            enabled: this.enabled,
            processedCount: this.processedSignals.size,
            currentPositions: this.currentPositions.length,
            currentBatchSize: this.currentBatch.length,
            isProcessingBatch: this.isProcessingBatch,
            incomingSignalsCount: this.incomingSignals.length,
            sseSubscribed: this.sseSubscribed,
            tradingCycleActive: this.tradingCycleInterval !== null
        }
    }
}

export const AutoTradeBotService = new AutoTradeBotServiceClass()
