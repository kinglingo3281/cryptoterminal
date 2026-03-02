/**
 * StableCoin Market Maker Bot Service
 * Provides liquidity for stablecoin pairs with minimal fees
 */
import * as hl from '@nktkas/hyperliquid'

interface PairSettings {
    enabled: boolean
    balancePct: number | null
    fixedValue: number | null
    maxBid: number
    minAsk: number
}

interface SpotToken {
    name: string
    index: number
    tokenId?: string
    szDecimals?: number
}

interface SpotPair {
    name: string
    tokens: [number, number]
    index: number
}

interface SpotMeta {
    tokens: SpotToken[]
    universe: SpotPair[]
}

const STABLECOIN_PAIRS = [
    { symbol: '@230', name: 'USDH/USDC', baseToken: 'USDH', quoteToken: 'USDC' },
    { symbol: '@150', name: 'USDE/USDC', baseToken: 'USDE', quoteToken: 'USDC' },
    { symbol: '@166', name: 'USDT0/USDC', baseToken: 'USDT0', quoteToken: 'USDC' }
]

interface SpotBalanceData {
    coin: string
    token: number
    total: number
    hold: number
}

interface SymbolState {
    orderbook: { bids: [number, number][]; asks: [number, number][] }
    lastRebalance: number
    lastOrderbook: number
}

class MMBotServiceClass {
    private enabled = false
    private pricingMode: 'fixed' | 'evalgo' = 'fixed'
    private pairSettings: Record<string, PairSettings> = {
        '@230': { enabled: true, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 },
        '@150': { enabled: false, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 },
        '@166': { enabled: false, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 }
    }
    private monitorInterval: NodeJS.Timeout | null = null
    private infoClient: hl.InfoClient
    private exchClient: hl.ExchangeClient | null = null
    private userAddress: string | null = null
    private activeOrders = new Map<string, { bidOid?: number; askOid?: number }>()
    private spotMeta: SpotMeta | null = null
    private onLog: ((message: string, type: 'info' | 'success' | 'error') => void) | null = null
    
    // Global spot balances from store (updated by BotProvider)
    private globalSpotBalances: SpotBalanceData[] = []
    
    // Token cache: token index -> token name
    private tokenCache = new Map<number, string>()
    // Token szDecimals cache: token index -> szDecimals
    private tokenSzDecimalsCache = new Map<number, number>()
    // Pair cache: symbol -> { pairIndex, baseToken, quoteToken, szDecimals, assetIndex }
    private pairCache = new Map<string, { pairIndex: number; baseToken: string; quoteToken: string; szDecimals: number; assetIndex: number }>()
    
    // State tracking per symbol
    private state = new Map<string, SymbolState>()
    
    // WebSocket properties
    private wsTransport: hl.WebSocketTransport | null = null
    private subscriptionClient: hl.SubscriptionClient | null = null
    private subscriptions = new Map<string, any>()
    
    // Timing intervals
    private loopDelay = 5000          // 5s main loop
    private rebalanceInterval = 10000  // 10s rebalance check
    private orderbookInterval = 300000 // 5 min REST fallback
    
    // Loop control
    private loopInProgress = false
    private loopCounter = 0
    
    // Log deduplication
    private lastLogMessages = new Map<string, number>()
    private LOG_DEDUPE_MS = 5000 // Don't repeat same log within 5 seconds
    private logToConsole = false

    constructor() {
        const transport = new hl.HttpTransport({ isTestnet: false })
        this.infoClient = new hl.InfoClient({ transport })
        this.loadSettings()
    }

    setLogCallback(callback: (message: string, type: 'info' | 'success' | 'error') => void) {
        this.onLog = callback
    }

    private log(message: string, type: 'info' | 'success' | 'error' = 'info', noDedupe: boolean = false) {
        // Dedupe logs - don't repeat same message within 5 seconds (unless noDedupe)
        if (!noDedupe) {
            const now = Date.now()
            const lastTime = this.lastLogMessages.get(message)
            if (lastTime && now - lastTime < this.LOG_DEDUPE_MS) {
                return // Skip duplicate log
            }
            this.lastLogMessages.set(message, now)
            
            // Cleanup old log entries periodically
            if (this.lastLogMessages.size > 100) {
                const cutoff = now - this.LOG_DEDUPE_MS
                for (const [msg, time] of this.lastLogMessages) {
                    if (time < cutoff) this.lastLogMessages.delete(msg)
                }
            }
        }
        
        if (this.logToConsole) {
            console.log(`[MM Bot] ${message}`)
        }
        if (this.onLog) {
            this.onLog(message, type)
        }
    }

    async initialize(exchClient: hl.ExchangeClient, userAddress: string) {
        this.exchClient = exchClient
        this.userAddress = userAddress
        try {
            this.spotMeta = await this.infoClient.spotMeta() as unknown as SpotMeta
            
            // Build token cache: index -> name, index -> szDecimals
            this.tokenCache.clear()
            this.tokenSzDecimalsCache.clear()
            if (this.spotMeta?.tokens) {
                for (const token of this.spotMeta.tokens) {
                    this.tokenCache.set(token.index, token.name)
                    this.tokenSzDecimalsCache.set(token.index, token.szDecimals ?? 2)
                }
            }
            
            // Pre-resolve all configured pairs and initialize state
            this.pairCache.clear()
            this.state.clear()
            for (const pair of STABLECOIN_PAIRS) {
                const resolved = this.resolveSpotPair(pair.symbol, pair.baseToken, pair.quoteToken)
                if (resolved) {
                    this.pairCache.set(pair.symbol, resolved)
                    this.log(`Resolved ${pair.symbol}: ${resolved.baseToken}/${resolved.quoteToken} (index=${resolved.pairIndex})`)
                    
                    // Initialize state for this symbol
                    this.state.set(pair.symbol, {
                        orderbook: { bids: [], asks: [] },
                        lastRebalance: 0,
                        lastOrderbook: 0
                    })
                } else {
                    this.log(`Failed to resolve ${pair.symbol}`, 'error')
                }
            }
            
            this.log(`Initialized for ${userAddress.slice(0, 8)}... (${this.spotMeta?.universe?.length || 0} spot pairs, ${this.tokenCache.size} tokens)`)
        } catch (e) {
            this.log('Failed to load spot metadata', 'error')
        }
    }
    
    // Resolve spot pair: find tokens by name, then find pair by token indices
    private resolveSpotPair(symbol: string, baseTokenName: string, quoteTokenName: string): { pairIndex: number; baseToken: string; quoteToken: string; szDecimals: number; assetIndex: number } | null {
        if (!this.spotMeta) return null
        
        let pair: SpotPair | undefined
        
        // Method 1: @index format - find pair by index directly
        if (symbol.startsWith('@')) {
            const pairIndex = parseInt(symbol.slice(1), 10)
            if (!isNaN(pairIndex)) {
                pair = this.spotMeta.universe.find(p => p.index === pairIndex)
            }
        }
        
        // Method 2: Find tokens by name, then find pair with those token indices
        if (!pair) {
            const baseTokenObj = this.spotMeta.tokens.find(t => t.name === baseTokenName)
            const quoteTokenObj = this.spotMeta.tokens.find(t => t.name === quoteTokenName)
            
            if (baseTokenObj && quoteTokenObj) {
                pair = this.spotMeta.universe.find(p =>
                    p.tokens[0] === baseTokenObj.index && p.tokens[1] === quoteTokenObj.index
                )
            }
        }
        
        if (!pair) return null
        
        // Get token names and szDecimals from cache
        const baseToken = this.tokenCache.get(pair.tokens[0]) || baseTokenName
        const quoteToken = this.tokenCache.get(pair.tokens[1]) || quoteTokenName
        const szDecimals = this.tokenSzDecimalsCache.get(pair.tokens[0]) ?? 2
        const assetIndex = 10000 + pair.index
        
        return { pairIndex: pair.index, baseToken, quoteToken, szDecimals, assetIndex }
    }

    // Update spot balances from global store (called by BotProvider)
    updateSpotBalances(balances: SpotBalanceData[]) {
        this.globalSpotBalances = balances
    }

    enable() {
        if (this.enabled) return true
        this.enabled = true
        this.saveSettings()
        this.startMonitoring()
        this.log('Enabled', 'success')
        return true
    }

    async disable() {
        if (!this.enabled) return true
        this.enabled = false
        this.saveSettings()
        this.stopMonitoring()
        await this.cancelAllOrders()
        this.log('Disabled', 'info')
        return true
    }

    isEnabled() {
        return this.enabled
    }

    updateSettings(settings: { 
        pricingMode?: 'fixed' | 'evalgo'
        pairSettings?: Record<string, Partial<PairSettings>>
    }) {
        if (settings.pricingMode !== undefined) {
            this.pricingMode = settings.pricingMode
        }
        if (settings.pairSettings) {
            for (const [symbol, updates] of Object.entries(settings.pairSettings)) {
                if (this.pairSettings[symbol]) {
                    this.pairSettings[symbol] = { ...this.pairSettings[symbol], ...updates }
                }
            }
        }
        this.saveSettings()
        this.log(`Settings updated: mode=${this.pricingMode}`)
    }

    private startMonitoring() {
        if (this.monitorInterval) {
            this.log('startMonitoring: already monitoring', 'info', true)
            return
        }
        this.log('Starting market making', 'info', true)
        
        // Initialize WebSocket async without blocking
        this.initWebSocket().catch(err => {
            this.log(`WebSocket initialization failed: ${err.message}`, 'error', true)
        })
        
        // Run first loop immediately
        this.log('Starting initial runLoop...', 'info', true)
        this.runLoop()
        
        // Set up interval
        this.monitorInterval = setInterval(() => this.runLoop(), this.loopDelay)
        this.log(`Monitoring started - interval set to ${this.loopDelay}ms`, 'success', true)
    }

    private stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval)
            this.monitorInterval = null
        }
        this.closeWebSocket()
        this.log('Market making stopped')
    }

    /**
     * Initialize WebSocket connection for real-time orderbook updates
     */
    private async initWebSocket() {
        if (this.wsTransport && this.subscriptionClient) return
        
        try {
            this.log('[WS] Connecting to Hyperliquid WebSocket...')
            
            this.wsTransport = new hl.WebSocketTransport({
                url: 'wss://api.hyperliquid.xyz/ws',
                timeout: 10000
            })
            
            this.subscriptionClient = new hl.SubscriptionClient({
                transport: this.wsTransport
            })
            
            await this.wsTransport.ready()
            
            // Subscribe to orderbook for all enabled pairs
            for (const pair of STABLECOIN_PAIRS) {
                const settings = this.pairSettings[pair.symbol]
                if (settings?.enabled) {
                    await this.subscribeToOrderbook(pair.symbol)
                }
            }
            
            this.log('[WS] WebSocket connected and subscribed')
        } catch (error) {
            this.log(`[WS] Failed to initialize WebSocket: ${(error as Error).message}`, 'error')
        }
    }

    /**
     * Subscribe to orderbook updates for a symbol
     */
    private async subscribeToOrderbook(symbol: string) {
        if (!this.subscriptionClient) return
        
        try {
            const subscription = await this.subscriptionClient.l2Book(
                {
                    coin: symbol
                },
                (data: any) => {
                    this.handleOrderbookUpdate(symbol, data)
                }
            )
            
            this.subscriptions.set(symbol, subscription)
            this.log(`[WS] Subscribed to orderbook for ${symbol}`)
        } catch (error) {
            this.log(`[WS] Failed to subscribe to ${symbol}: ${(error as Error).message}`, 'error')
        }
    }

    /**
     * Handle orderbook update from WebSocket
     */
    private handleOrderbookUpdate(symbol: string, data: any) {
        const state = this.state.get(symbol)
        if (!state) {
            this.log(`[WS] ${symbol}: no state found for orderbook update`, 'error')
            return
        }
        
        const levels = data?.levels || [[], []]
        
        const bids: [number, number][] = (levels[0] || []).map((level: any) => [
            parseFloat(level.px),
            parseFloat(level.sz)
        ]).filter(([p, s]: [number, number]) => Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0)
        
        const asks: [number, number][] = (levels[1] || []).map((level: any) => [
            parseFloat(level.px),
            parseFloat(level.sz)
        ]).filter(([p, s]: [number, number]) => Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0)
        
        state.orderbook = { bids, asks }
        state.lastOrderbook = Date.now()
        
        // Only log every 30 seconds to avoid spam
        const now = Date.now()
        const lastLog = (state as any)._lastWsLog || 0
        if (now - lastLog >= 30000) {
            this.log(`[WS] ${symbol}: orderbook updated (bids=${bids.length}, asks=${asks.length})`)
            ;(state as any)._lastWsLog = now
        }
    }

    /**
     * Close WebSocket connection
     */
    private async closeWebSocket() {
        if (!this.wsTransport) return
        
        try {
            // Unsubscribe all
            for (const [symbol, subscription] of this.subscriptions) {
                try {
                    await subscription.unsubscribe()
                } catch (e) {
                    // Ignore
                }
            }
            this.subscriptions.clear()
            
            // Close transport
            await this.wsTransport.close()
            this.wsTransport = null
            this.subscriptionClient = null
            
            this.log('[WS] WebSocket closed')
        } catch (error) {
            this.log(`[WS] Error closing WebSocket: ${(error as Error).message}`, 'error')
        }
    }

    /**
     * Find optimal bid price based on queue ratio optimization
     */
    private findOptimalBidPrice(orderbook: { bids: [number, number][]; asks: [number, number][] }, ourSize: number, maxBid: number, maxQueueRatio: number): number {
        const bids = orderbook.bids || []
        if (!bids.length || ourSize <= 0) return maxBid
        
        for (let i = 0; i < bids.length; i++) {
            const [price, size] = bids[i]
            
            if (price > maxBid) continue
            if (size <= 0) continue
            
            const ourRatio = ourSize / (size + ourSize)
            
            if (ourRatio <= maxQueueRatio) {
                return price
            }
        }
        
        return maxBid
    }

    /**
     * Find optimal ask price based on queue ratio optimization
     */
    private findOptimalAskPrice(orderbook: { bids: [number, number][]; asks: [number, number][] }, ourSize: number, minAsk: number, maxQueueRatio: number): number {
        const asks = orderbook.asks || []
        if (!asks.length || ourSize <= 0) return minAsk
        
        for (let i = 0; i < asks.length; i++) {
            const [price, size] = asks[i]
            
            if (price < minAsk) continue
            if (size <= 0) continue
            
            const ourRatio = ourSize / (size + ourSize)
            
            if (ourRatio <= maxQueueRatio) {
                return price
            }
        }
        
        return minAsk
    }

    /**
     * Cancel a single order
     */
    private async cancelSingleOrder(symbol: string, oid: number): Promise<boolean> {
        try {
            const resolved = this.pairCache.get(symbol)
            if (!resolved || !this.exchClient) return false
            
            await this.exchClient.cancel({
                cancels: [{ a: resolved.assetIndex, o: oid }]
            })
            
            this.log(`Cancelled order ${oid}`)
            return true
        } catch (error) {
            this.log(`Failed to cancel order ${oid}: ${(error as Error).message}`, 'error')
            return false
        }
    }

    /**
     * Check if orders need rebalancing (price moved or significant new funds)
     */
    private async checkRebalance(symbol: string): Promise<boolean> {
        const settings = this.pairSettings[symbol]
        const state = this.state.get(symbol)
        const resolved = this.pairCache.get(symbol)
        
        if (!settings || !state || !resolved || !this.exchClient || !this.userAddress) return false
        
        try {
            // Get open orders
            const openOrders = await this.infoClient.openOrders({ user: this.userAddress })
            const symbolOrders = openOrders.filter((o: any) => o.coin === symbol)
            
            if (symbolOrders.length === 0) return false
            
            // Fetch fresh balances
            const spotState = await this.infoClient.spotClearinghouseState({ user: this.userAddress })
            let availableBase = 0
            let availableQuote = 0
            
            if ((spotState as any)?.balances) {
                for (const bal of (spotState as any).balances) {
                    const coin = bal.coin
                    const total = parseFloat(bal.total || '0')
                    const hold = parseFloat(bal.hold || '0')
                    const available = Math.max(0, total - hold) * 0.998
                    
                    if (coin === resolved.baseToken) availableBase = available
                    else if (coin === resolved.quoteToken) availableQuote = available
                }
            }
            
            const orderbook = state.orderbook
            if (orderbook.bids.length === 0 || orderbook.asks.length === 0) return false
            
            const maxBid = settings.maxBid
            const minAsk = settings.minAsk
            const maxQueueRatio = 0.30
            
            const PRICE_EPSILON = 0.00001
            const MIN_NEW_FUNDS_RATIO = 0.10
            
            let cancelledAny = false
            
            for (const order of symbolOrders) {
                const orderSide = order.side
                const orderSize = parseFloat(order.sz)
                const orderPrice = parseFloat(order.limitPx)
                const oid = order.oid
                
                if (orderSize <= 0 || orderPrice <= 0) continue
                
                if (orderSide === 'B') { // Buy order
                    const optimalPrice = this.findOptimalBidPrice(orderbook, orderSize, maxBid, maxQueueRatio)
                    
                    // Check if price moved
                    if (Math.abs(orderPrice - optimalPrice) > PRICE_EPSILON) {
                        this.log(`[REBALANCE] BID price stale: ${orderPrice.toFixed(5)} -> ${optimalPrice.toFixed(5)}`)
                        await this.cancelSingleOrder(symbol, oid)
                        cancelledAny = true
                        continue
                    }
                    
                    // Check if significant new funds available
                    const wouldPlaceSize = availableQuote / optimalPrice
                    if (orderSize > 0 && wouldPlaceSize > 0) {
                        const totalCapital = orderSize + wouldPlaceSize
                        const idleRatio = wouldPlaceSize / totalCapital
                        if (idleRatio > MIN_NEW_FUNDS_RATIO) {
                            this.log(`[REBALANCE] BID: ${(idleRatio * 100).toFixed(1)}% idle funds`)
                            await this.cancelSingleOrder(symbol, oid)
                            cancelledAny = true
                        }
                    }
                } else if (orderSide === 'A') { // Sell order
                    const optimalPrice = this.findOptimalAskPrice(orderbook, orderSize, minAsk, maxQueueRatio)
                    
                    if (Math.abs(orderPrice - optimalPrice) > PRICE_EPSILON) {
                        this.log(`[REBALANCE] ASK price stale: ${orderPrice.toFixed(5)} -> ${optimalPrice.toFixed(5)}`)
                        await this.cancelSingleOrder(symbol, oid)
                        cancelledAny = true
                        continue
                    }
                    
                    if (orderSize > 0 && availableBase > 0) {
                        const totalCapital = orderSize + availableBase
                        const idleRatio = availableBase / totalCapital
                        if (idleRatio > MIN_NEW_FUNDS_RATIO) {
                            this.log(`[REBALANCE] ASK: ${(idleRatio * 100).toFixed(1)}% idle funds`)
                            await this.cancelSingleOrder(symbol, oid)
                            cancelledAny = true
                        }
                    }
                }
            }
            
            return cancelledAny
        } catch (error) {
            this.log(`[REBALANCE] Error: ${(error as Error).message}`, 'error')
            return false
        }
    }

    /**
     * Main market making loop - checks conditions before acting
     */
    private async runLoop() {
        if (!this.enabled) {
            this.log('runLoop: bot not enabled')
            return
        }
        if (this.loopInProgress) {
            this.log('runLoop: loop already in progress')
            return
        }
        
        this.loopCounter++
        this.log(`runLoop #${this.loopCounter}: START`, 'info', true)
        this.loopInProgress = true
        
        try {
            if (!this.exchClient || !this.userAddress) {
                this.log('Loop skipped: exchClient or userAddress not set', 'error')
                return
            }
            
            for (const pair of STABLECOIN_PAIRS) {
                const settings = this.pairSettings[pair.symbol]
                if (!settings?.enabled) {
                    this.log(`${pair.symbol}: pair not enabled in settings`)
                    continue
                }
                
                const state = this.state.get(pair.symbol)
                const resolved = this.pairCache.get(pair.symbol)
                if (!state || !resolved) {
                    this.log(`${pair.symbol}: state or resolved not found`, 'error')
                    continue
                }
                
                const now = Date.now()
                
                // 1. Poll orderbook if stale (REST fallback - WebSocket is primary)
                const timeSinceLastBook = now - state.lastOrderbook
                const needsREST = timeSinceLastBook >= this.orderbookInterval || !state.orderbook.bids.length
                
                if (needsREST) {
                    this.log(`${pair.symbol}: fetching REST orderbook (age=${(timeSinceLastBook/1000).toFixed(0)}s, bids=${state.orderbook.bids.length})`)
                    try {
                        const l2 = await this.infoClient.l2Book({ coin: pair.symbol })
                        if (l2?.levels) {
                            const bids: [number, number][] = (l2.levels[0] || []).map((level: any) => [
                                parseFloat(level.px),
                                parseFloat(level.sz)
                            ])
                            const asks: [number, number][] = (l2.levels[1] || []).map((level: any) => [
                                parseFloat(level.px),
                                parseFloat(level.sz)
                            ])
                            state.orderbook = { bids, asks }
                            state.lastOrderbook = now
                            this.log(`${pair.symbol}: REST orderbook fetched (bids=${bids.length}, asks=${asks.length})`)
                        }
                    } catch (e) {
                        this.log(`${pair.symbol}: REST orderbook fetch failed: ${(e as Error).message}`, 'error')
                    }
                } else {
                    this.log(`${pair.symbol}: using cached orderbook (age=${(timeSinceLastBook/1000).toFixed(0)}s)`)
                }
                
                // 2. Skip if orderbook invalid
                if (!state.orderbook.bids.length || !state.orderbook.asks.length) {
                    this.log(`${pair.symbol}: orderbook invalid (bids=${state.orderbook.bids.length}, asks=${state.orderbook.asks.length})`)
                    continue
                }
                
                // 3. Check open orders
                this.log(`${pair.symbol}: checking open orders...`)
                let openOrders = await this.infoClient.openOrders({ user: this.userAddress })
                let symbolOrders = openOrders.filter((o: any) => o.coin === pair.symbol)
                let hasBid = symbolOrders.some((o: any) => o.side === 'B')
                let hasAsk = symbolOrders.some((o: any) => o.side === 'A')
                this.log(`${pair.symbol}: open orders - ${symbolOrders.length} total (hasBid=${hasBid}, hasAsk=${hasAsk})`)
                
                // 4. Periodic rebalance check (only every 10s)
                if (now - state.lastRebalance >= this.rebalanceInterval) {
                    if (symbolOrders.length > 0) {
                        const cancelled = await this.checkRebalance(pair.symbol)
                        if (cancelled) {
                            // Re-fetch orders after cancel
                            openOrders = await this.infoClient.openOrders({ user: this.userAddress })
                            symbolOrders = openOrders.filter((o: any) => o.coin === pair.symbol)
                            hasBid = symbolOrders.some((o: any) => o.side === 'B')
                            hasAsk = symbolOrders.some((o: any) => o.side === 'A')
                        }
                    }
                    state.lastRebalance = now
                }
                
                // 5. If both orders exist, skip
                if (hasBid && hasAsk) {
                    this.log(`${pair.symbol}: both orders exist, skipping`)
                    continue
                }
                
                // 6. Generate quotes for missing orders
                this.log(`${pair.symbol}: generating quotes (hasBid=${hasBid}, hasAsk=${hasAsk})`)
                const quotes = await this.generateQuotes(pair.symbol)
                
                // 7. Place missing orders
                if (!hasBid && quotes.bid) {
                    this.log(`${pair.symbol}: placing BID order`)
                    await this.placeOrder(pair.symbol, true, quotes.bid.size, quotes.bid.price)
                } else if (!hasBid) {
                    this.log(`${pair.symbol}: no BID quote generated`)
                }
                
                if (!hasAsk && quotes.ask) {
                    this.log(`${pair.symbol}: placing ASK order`)
                    await this.placeOrder(pair.symbol, false, quotes.ask.size, quotes.ask.price)
                } else if (!hasAsk) {
                    this.log(`${pair.symbol}: no ASK quote generated`)
                }
            }
        } catch (error) {
            this.log(`runLoop #${this.loopCounter} ERROR: ${(error as Error).message}`, 'error', true)
        } finally {
            this.log(`runLoop #${this.loopCounter}: END`, 'info', true)
            this.loopInProgress = false
        }
    }

    /**
     * Generate quotes for missing orders using queue ratio optimization
     */
    private async generateQuotes(symbol: string): Promise<{ bid: { price: number; size: number } | null; ask: { price: number; size: number } | null }> {
        const settings = this.pairSettings[symbol]
        const state = this.state.get(symbol)
        const resolved = this.pairCache.get(symbol)
        
        const quotes = { bid: null as { price: number; size: number } | null, ask: null as { price: number; size: number } | null }
        
        if (!settings?.enabled || !state || !resolved || !this.userAddress) {
            this.log(`${symbol}: generateQuotes early return (enabled=${settings?.enabled}, state=${!!state}, resolved=${!!resolved}, user=${!!this.userAddress})`, 'error')
            return quotes
        }
        
        try {
            // Get balances from global store (updated by BotProvider)
            let availableBase = 0
            let availableQuote = 0
            
            // Log what we're looking for (dynamic per pair)
            this.log(`${symbol}: looking for tokens - base='${resolved.baseToken}', quote='${resolved.quoteToken}' (resolved from pairCache)`, 'info', true)
            
            if (this.globalSpotBalances && this.globalSpotBalances.length > 0) {
                // Log all available tokens first
                const allTokens = this.globalSpotBalances.map(b => {
                    const tokenName = this.tokenCache.get(b.token) || `idx${b.token}`
                    return `${tokenName}:${b.total.toFixed(2)}`
                }).join(', ')
                this.log(`${symbol}: Store balances - [${allTokens}]`, 'info', true)
                
                for (const bal of this.globalSpotBalances) {
                    // Resolve token index to name
                    const tokenName = this.tokenCache.get(bal.token)
                    if (!tokenName) continue
                    
                    const total = bal.total
                    const hold = bal.hold
                    const available = Math.max(0, total - hold) * 0.998
                    
                    // Try exact match first, then case-insensitive
                    const tokenLower = tokenName.toLowerCase()
                    const baseLower = resolved.baseToken.toLowerCase()
                    const quoteLower = resolved.quoteToken.toLowerCase()
                    
                    if (tokenName === resolved.baseToken || tokenLower === baseLower) {
                        availableBase = available
                        this.log(`${symbol}: MATCHED base '${tokenName}' (idx=${bal.token}) = ${available.toFixed(2)}`, 'success', true)
                    } else if (tokenName === resolved.quoteToken || tokenLower === quoteLower) {
                        availableQuote = available
                        this.log(`${symbol}: MATCHED quote '${tokenName}' (idx=${bal.token}) = ${available.toFixed(2)}`, 'success', true)
                    }
                }
            } else {
                this.log(`${symbol}: No balances in globalSpotBalances (${this.globalSpotBalances?.length || 0} entries)`, 'error', true)
            }
            
            this.log(`${symbol}: final balances - ${resolved.baseToken}=${availableBase.toFixed(2)}, ${resolved.quoteToken}=${availableQuote.toFixed(2)}`)
            
            const orderbook = state.orderbook
            if (!orderbook.bids.length || !orderbook.asks.length) {
                this.log(`${symbol}: orderbook empty in generateQuotes`)
                return quotes
            }
            
            const bboBid = orderbook.bids[0][0]
            const bboAsk = orderbook.asks[0][0]
            
            if (bboBid <= 0 || bboAsk <= 0) {
                this.log(`${symbol}: invalid BBO (bid=${bboBid}, ask=${bboAsk})`)
                return quotes
            }
            
            const maxBid = settings.maxBid
            const minAsk = settings.minAsk
            const maxQueueRatio = 0.30
            
            // Calculate sizes for each side
            const estimatedBidPrice = Math.min(bboBid, maxBid)
            const estimatedAskPrice = Math.max(bboAsk, minAsk)
            
            // SPOT logic: BID uses % of quote token, ASK uses % of base token
            let bidUsd: number
            let askUsd: number
            
            if (settings.fixedValue) {
                // Fixed mode: use fixed value for both sides (capped by available)
                bidUsd = Math.min(availableQuote, settings.fixedValue)
                askUsd = Math.min(availableBase * estimatedAskPrice, settings.fixedValue)
                this.log(`${symbol}: fixed mode - bidUsd=$${bidUsd.toFixed(2)}, askUsd=$${askUsd.toFixed(2)}`, 'info', true)
            } else if (settings.balancePct) {
                // Percentage mode: use % of each token independently
                // Round down to nearest 0.01 to prevent insufficient balance
                bidUsd = Math.floor((availableQuote * settings.balancePct) / 100 * 100) / 100
                askUsd = Math.floor((availableBase * estimatedAskPrice * settings.balancePct) / 100 * 100) / 100
                this.log(`${symbol}: ${settings.balancePct}% mode - bidUsd=${settings.balancePct}% of $${availableQuote.toFixed(2)} = $${bidUsd.toFixed(2)}, askUsd=${settings.balancePct}% of $${(availableBase * estimatedAskPrice).toFixed(2)} = $${askUsd.toFixed(2)}`, 'info', true)
            } else {
                // No allocation: use all available
                bidUsd = availableQuote
                askUsd = availableBase * estimatedAskPrice
                this.log(`${symbol}: no allocation - using all available`, 'info', true)
            }
            
            // Calculate initial sizes for queue ratio optimization
            let bidSize = bidUsd / estimatedBidPrice
            let askSize = askUsd / estimatedAskPrice
            
            // Find optimal prices with queue ratio
            const bidPrice = this.findOptimalBidPrice(orderbook, bidSize, maxBid, maxQueueRatio)
            const askPrice = this.findOptimalAskPrice(orderbook, askSize, minAsk, maxQueueRatio)
            
            // Recalculate final sizes with optimized prices
            bidSize = bidUsd / bidPrice
            askSize = askUsd / askPrice
            
            // Place orders if above minimum
            const MIN_ORDER_VALUE = 10.5
            
            this.log(`${symbol}: final sizing - bidUsd=$${bidUsd.toFixed(2)}, askUsd=$${askUsd.toFixed(2)}, min=$${MIN_ORDER_VALUE}`, 'info', true)
            
            if (bidUsd >= MIN_ORDER_VALUE) {
                bidSize = bidUsd / bidPrice
                quotes.bid = { price: bidPrice, size: bidSize }
                this.log(`${symbol}: BID quote - $${bidUsd.toFixed(2)} (${bidSize.toFixed(4)} @ ${bidPrice.toFixed(5)})`, 'success', true)
            } else {
                this.log(`${symbol}: BID quote below minimum ($${bidUsd.toFixed(2)} < $10.5)`)
            }
            
            if (askUsd >= MIN_ORDER_VALUE) {
                askSize = askUsd / askPrice
                quotes.ask = { price: askPrice, size: askSize }
                this.log(`${symbol}: ASK quote - $${askUsd.toFixed(2)} (${askSize.toFixed(4)} @ ${askPrice.toFixed(5)})`, 'success', true)
            } else {
                this.log(`${symbol}: ASK quote below minimum ($${askUsd.toFixed(2)} < $10.5)`)
            }
            
            return quotes
        } catch (error) {
            this.log(`Error generating quotes for ${symbol}: ${(error as Error).message}`, 'error')
            return quotes
        }
    }

    /**
     * Place a single order (bid or ask)
     */
    private async placeOrder(symbol: string, isBuy: boolean, size: number, price: number): Promise<number | null> {
        const resolved = this.pairCache.get(symbol)
        if (!resolved || !this.exchClient) return null
        
        try {
            // Round size and price
            const multiplier = Math.pow(10, resolved.szDecimals)
            const roundedSize = Math.floor(size * multiplier) / multiplier
            
            const roundPrice = (px: number): string => {
                const magnitude = Math.floor(Math.log10(px))
                const pxDecimals = Math.max(0, 4 - magnitude)
                const pxMultiplier = Math.pow(10, pxDecimals)
                return (Math.round(px * pxMultiplier) / pxMultiplier).toString()
            }
            
            if (roundedSize < 10.5) return null
            
            const result = await this.exchClient.order({
                orders: [{
                    a: resolved.assetIndex,
                    b: isBuy,
                    p: roundPrice(price),
                    s: roundedSize.toString(),
                    r: false,
                    t: { limit: { tif: 'Gtc' } }
                }],
                grouping: 'na',
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            })
            
            const oid = (result as any)?.response?.data?.statuses?.[0]?.resting?.oid
            if (oid) {
                this.log(`Placed ${isBuy ? 'BID' : 'ASK'}: ${roundedSize.toFixed(4)} @ ${price.toFixed(5)}`, 'success')
                return oid
            } else {
                const err = (result as any)?.response?.data?.statuses?.[0]?.error
                if (err) this.log(`Order failed: ${err}`, 'error')
                return null
            }
        } catch (error) {
            this.log(`Error placing order: ${(error as Error).message}`, 'error')
            return null
        }
    }

    private async cancelAllOrders() {
        if (!this.exchClient) return

        for (const [symbol, orders] of this.activeOrders) {
            // Use pairCache for asset index
            const resolved = this.pairCache.get(symbol)
            if (!resolved) continue

            const cancels: Array<{ a: number; o: number }> = []
            if (orders.bidOid) cancels.push({ a: resolved.assetIndex, o: orders.bidOid })
            if (orders.askOid) cancels.push({ a: resolved.assetIndex, o: orders.askOid })

            if (cancels.length > 0) {
                try {
                    await this.exchClient.cancel({ cancels })
                } catch (e) {
                    // Ignore
                }
            }
        }

        this.activeOrders.clear()
        this.log('All orders cancelled')
    }

    private saveSettings() {
        if (typeof window !== 'undefined') {
            localStorage.setItem('mmBotSettings', JSON.stringify({
                enabled: this.enabled,
                pricingMode: this.pricingMode,
                pairSettings: this.pairSettings
            }))
        }
    }

    private loadSettings() {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('mmBotSettings')
                if (saved) {
                    const data = JSON.parse(saved)
                    this.pricingMode = data.pricingMode || 'fixed'
                    if (data.pairSettings) {
                        this.pairSettings = { ...this.pairSettings, ...data.pairSettings }
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            pricingMode: this.pricingMode,
            pairSettings: this.pairSettings,
            activeOrders: this.activeOrders.size
        }
    }
}

export const MMBotService = new MMBotServiceClass()
