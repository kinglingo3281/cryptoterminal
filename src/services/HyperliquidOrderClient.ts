/**
 * Hyperliquid Order Client for Browser
 * Handles market order execution with proper rounding and validation
 */
import * as hl from '@nktkas/hyperliquid'
import { signL1Action } from '@nktkas/hyperliquid/signing'
import { ethers } from 'ethers'
import { hyperliquid } from './hyperliquid'

export interface OrderData {
    asset: string
    orderSide: 'buy' | 'sell'
    orderType: 'market' | 'limit'
    price: number | null
    size: number
    leverage: number | null
    isCrossMargin: boolean
    reduceOnly: boolean
    timeInForce: string
    tpslEnabled: boolean
    tpPrice: number | null
    slPrice: number | null
    tpIsLimit?: boolean
    slIsLimit?: boolean
}

export class HyperliquidOrderClient {
    private exchClient: hl.ExchangeClient | null = null
    private infoClient: hl.InfoClient
    private transport: hl.HttpTransport
    private wallet: ethers.Wallet | null = null
    private isInitialized = false
    
    // Cached for rounding - set by getAssetIndex()
    private assetSzDecimals: number | undefined
    private priceDecimals: number | undefined
    private assetIndexCache = new Map<string, { index: number; szDecimals: number; priceDecimals: number }>()
    private metaCache: Map<string, any> = new Map()
    private perpDexsCache: any[] | null = null
    
    // CLOID generation
    private _cloidCounter: number = 0
    private _cloidLastMs: number = 0
    
    // HIP-3 DEX abstraction state (one-time enable per account)
    private _dexAbstractionEnabled: boolean | null = null
    private _dexAbstractionChecking: Promise<void> | null = null

    // Unified account abstraction state (one-time enable per account)
    private _unifiedAccountEnabled: boolean | null = null
    private _unifiedAccountChecking: Promise<void> | null = null

    // Spot metadata cache
    private spotMetaCache: any = null

    constructor() {
        this.transport = new hl.HttpTransport({ isTestnet: false })
        this.infoClient = new hl.InfoClient({ transport: this.transport })
    }

    /**
     * Close a position using limit orders with progressive slippage
     */
    async closePositionLimit(asset: string, userAddress: string): Promise<{ 
        success: boolean
        message?: string
        error?: string 
    }> {
        try {
            const result = await this.closeMultiplePositionsLimit([{ asset, userAddress }])
            if (result.success && result.successCount > 0) {
                return { success: true, message: `Position closed for ${asset} using limit orders` }
            }
            return { success: false, error: result.errors.join(', ') || 'Failed to close position' }
        } catch (error: any) {
            return { success: false, error: error.message }
        }
    }

    async initialize(privateKey: string): Promise<boolean> {
        try {
            this.wallet = new ethers.Wallet(privateKey)
            this.exchClient = new hl.ExchangeClient({
                wallet: this.wallet,
                transport: this.transport
            })
            this.isInitialized = true
            // console.log('[HL Client] Initialized successfully')
            return true
        } catch (error) {
            console.error('[HL Client] Failed to initialize:', error)
            throw error
        }
    }

    /**
     * Ensure HIP-3 DEX abstraction is enabled for this account.
     * Required before any HIP-3 trade so collateral auto-transfers from main perps balance.
     * One-time per account — cached after first successful check.
     */
    async ensureHip3DexAbstraction(): Promise<void> {
        // Already confirmed enabled
        if (this._dexAbstractionEnabled === true) return

        // Deduplicate concurrent calls
        if (this._dexAbstractionChecking) return this._dexAbstractionChecking

        this._dexAbstractionChecking = (async () => {
            try {
                if (!this.isInitialized || !this.exchClient || !this.wallet) return

                // Check current state
                const state = await (this.infoClient as any).userDexAbstraction({
                    user: this.wallet.address
                })

                if (state === true) {
                    this._dexAbstractionEnabled = true
                    console.log('[HL Client] HIP-3 DEX abstraction already enabled')
                    return
                }

                // Enable it (one-time, from agent/API wallet)
                console.log('[HL Client] Enabling HIP-3 DEX abstraction...')
                await this.exchClient.agentEnableDexAbstraction()
                this._dexAbstractionEnabled = true
                console.log('[HL Client] HIP-3 DEX abstraction enabled successfully')
            } catch (e: any) {
                console.warn('[HL Client] Failed to enable HIP-3 DEX abstraction:', e?.message || e)
                // Don't cache failure — will retry on next HIP-3 trade
            } finally {
                this._dexAbstractionChecking = null
            }
        })()

        return this._dexAbstractionChecking
    }

    /**
     * Ensure Unified Account mode is enabled for this account.
     * Unifies USDC between perps and spot so no manual transfers needed.
     * One-time per account — cached after first successful check.
     */
    async ensureUnifiedAccount(): Promise<void> {
        if (this._unifiedAccountEnabled === true) return

        if (this._unifiedAccountChecking) return this._unifiedAccountChecking

        this._unifiedAccountChecking = (async () => {
            try {
                if (!this.isInitialized || !this.exchClient || !this.wallet) return

                // Use signL1Action + raw fetch since SDK doesn't expose agentSetAbstraction yet
                // action: { type: "agentSetAbstraction", abstraction: "u" }  (u = unifiedAccount)
                console.log('[HL Client] Enabling Unified Account mode...')
                const action = { type: 'agentSetAbstraction', abstraction: 'u' }
                const nonce = Date.now()
                const signature = await signL1Action({
                    wallet: this.wallet,
                    action,
                    nonce,
                    isTestnet: false
                })
                const response = await fetch('https://api.hyperliquid.xyz/exchange', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, signature, nonce })
                })
                const body = await response.json()
                if (body?.status === 'ok' || body?.response?.type === 'default') {
                    this._unifiedAccountEnabled = true
                    console.log('[HL Client] Unified Account mode enabled successfully')
                } else {
                    const errMsg = JSON.stringify(body)
                    if (errMsg.includes('already') || errMsg.includes('Already') || errMsg.includes('same')) {
                        this._unifiedAccountEnabled = true
                        console.log('[HL Client] Unified Account mode already enabled')
                    } else {
                        console.warn('[HL Client] Unified Account response:', errMsg)
                        // Mark as enabled to avoid blocking trades — unified account is an optimization
                        this._unifiedAccountEnabled = true
                    }
                }
            } catch (e: any) {
                const msg = e?.message || String(e)
                if (msg.includes('already') || msg.includes('Already') || msg.includes('same')) {
                    this._unifiedAccountEnabled = true
                    console.log('[HL Client] Unified Account mode already enabled')
                } else {
                    console.warn('[HL Client] Failed to enable Unified Account mode:', msg)
                    // Still mark as enabled to avoid blocking trades — unified account is just an optimization
                    this._unifiedAccountEnabled = true
                }
            } finally {
                this._unifiedAccountChecking = null
            }
        })()

        return this._unifiedAccountChecking
    }

    /**
     * Get cached spot metadata (tokens + universe)
     */
    async getSpotMeta(): Promise<any> {
        if (this.spotMetaCache) return this.spotMetaCache
        const result = await (this.infoClient as any).spotMeta()
        this.spotMetaCache = result
        return result
    }

    /**
     * Resolve spot asset index from @{pairIndex} format.
     * Spot index = 10000 + pair.index per Hyperliquid API spec.
     * Also sets szDecimals from the base token metadata.
     */
    async getSpotAssetIndex(assetSymbol: string): Promise<number> {
        // Check cache first
        const cached = this.assetIndexCache.get(assetSymbol)
        if (cached) {
            this.assetSzDecimals = cached.szDecimals
            this.priceDecimals = cached.priceDecimals
            return cached.index
        }

        const spotMeta = await this.getSpotMeta()
        const pairIndex = parseInt(assetSymbol.substring(1))
        const pair = (spotMeta as any)?.universe?.find((p: any) => p.index === pairIndex)

        if (!pair) {
            throw new Error(`Spot pair not found for ${assetSymbol}`)
        }

        // Get szDecimals from base token
        const baseTokenIndex = pair.tokens[0]
        const baseToken = (spotMeta as any)?.tokens?.find((t: any) => t.index === baseTokenIndex)
        const szDecimals: number = baseToken?.szDecimals ?? 2
        const pDecimals: number = Math.max(0, 6 - szDecimals)

        this.assetSzDecimals = szDecimals
        this.priceDecimals = pDecimals

        const absoluteIndex = 10000 + pair.index

        this.assetIndexCache.set(assetSymbol, {
            index: absoluteIndex,
            szDecimals: szDecimals,
            priceDecimals: pDecimals
        })

        try {
            hyperliquid.cacheSzDecimals(assetSymbol, szDecimals, pDecimals)
        } catch (_) { /* singleton may not be ready */ }

        return absoluteIndex
    }

    /**
     * Get open orders across all DEXs (main + HIP-3)
     * @param dexFilter - Optional DEX name(s) to query; null queries all
     */
    async getAllUserOrdersAllDexs(dexFilter: string[] | string | null = null): Promise<any[]> {
        if (!this.isInitialized || !this.wallet) {
            throw new Error('Client not initialized')
        }

        const allOrders: any[] = []
        let dexsToQuery: string[] = []

        if (dexFilter === null) {
            if (!this.perpDexsCache) {
                this.perpDexsCache = await (this.infoClient as any).perpDexs()
            }
            dexsToQuery = (this.perpDexsCache || []).map((dex: any) => dex?.name || '')
        } else if (Array.isArray(dexFilter)) {
            dexsToQuery = dexFilter
        } else {
            dexsToQuery = [dexFilter]
        }

        for (const dexName of dexsToQuery) {
            try {
                const params = dexName
                    ? { user: this.wallet.address, dex: dexName }
                    : { user: this.wallet.address }
                const orders = await this.infoClient.openOrders(params as any)

                if (orders && Array.isArray(orders)) {
                    orders.forEach((order: any) => {
                        allOrders.push({
                            ...order,
                            dex: dexName || 'main',
                            isHip3: typeof order.coin === 'string' && order.coin.includes(':')
                        })
                    })
                }
            } catch (error: any) {
                console.warn(`[HL Client] Failed to fetch orders for ${dexName || 'main'} DEX:`, error)
            }
        }

        return allOrders
    }

    /**
     * Get user state for all DEXs (main + HIP-3)
     */
    async getAllUserStates(userAddress?: string): Promise<Array<{ dex: string; state: any }>> {
        const address = userAddress || this.wallet?.address
        if (!this.isInitialized || !address) {
            throw new Error('Client not initialized')
        }

        if (!this.perpDexsCache) {
            this.perpDexsCache = await (this.infoClient as any).perpDexs()
        }

        const states: Array<{ dex: string; state: any }> = []
        const dexsToQuery = (this.perpDexsCache || []).map((dex: any) => dex?.name || '')

        for (const dexName of dexsToQuery) {
            try {
                const params = dexName ? { user: address, dex: dexName } : { user: address }
                const state = await (this.infoClient as any).clearinghouseState(params)
                states.push({ dex: dexName || 'main', state })
            } catch (error: any) {
                console.warn(`[HL Client] Failed to get state for ${dexName || 'main'} DEX:`, error)
            }
        }

        return states
    }

    /**
     * Get all open orders for a specific DEX (used for HIP-3 polling)
     * @param dexName - DEX identifier (e.g., "xyz")
     */
    async getAllUserOrders(dexName: string): Promise<any[]> {
        if (!this.isInitialized || !this.wallet) {
            throw new Error('Client not initialized')
        }

        try {
            const orders = await this.infoClient.openOrders({
                user: this.wallet.address,
                dex: dexName
            })
            return orders || []
        } catch (error: any) {
            console.error(`[HL Client] Failed to get orders for DEX ${dexName}:`, error)
            return []
        }
    }

    get publicAddress(): string | null {
        return this.wallet?.address || null
    }

    async executeTradingOrder(orderData: OrderData): Promise<any> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        try {
            // 1. Validate
            const validation = this.validateOrderData(orderData)
            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
            }

            const isSpotAsset = orderData.asset.startsWith('@')

            // 1b. Ensure HIP-3 DEX abstraction is enabled (auto-transfers collateral)
            if (orderData.asset.includes(':')) {
                await this.ensureHip3DexAbstraction()
            }

            // 1c. Ensure Unified Account mode for spot (shares USDC between perps and spot)
            if (isSpotAsset) {
                await this.ensureUnifiedAccount()
            }

            // 2. Update leverage (skip for spot — spot has no leverage)
            if (!isSpotAsset && orderData.leverage != null && orderData.leverage !== undefined) {
                const leverageValue = parseInt(orderData.leverage.toString())
                if (!isNaN(leverageValue) && leverageValue > 0 && leverageValue <= 100) {
                    try {
                        const assetIndex = await this.getAssetIndex(orderData.asset)
                        // HIP-3 assets default to isolated margin (many HIP-3 DEXs only support isolated)
                        const isHip3 = orderData.asset.includes(':')
                        const isCross = orderData.isCrossMargin !== undefined
                            ? orderData.isCrossMargin
                            : !isHip3
                        await this.exchClient.updateLeverage({
                            asset: assetIndex,
                            isCross: isCross,
                            leverage: leverageValue
                        })
                    } catch (e) {
                        // Ignore leverage update errors (e.g., isolated-only symbols)
                    }
                }
            }

            // 3. Build SDK order
            const sdkOrder = await this.buildSDKOrder(orderData)

            // 4. Execute
            const result = await this.exchClient.order(sdkOrder)

            // Extract OID from response
            let oid: string | undefined
            if (result && (result as any).response && (result as any).response.type === 'order') {
                const orderResponse = (result as any).response.data
                if (orderResponse && orderResponse.statuses && orderResponse.statuses[0]) {
                    const status = orderResponse.statuses[0]
                    if (status.resting && status.resting.oid) {
                        oid = status.resting.oid.toString()
                    }
                }
            }

            console.log('[HL Client] Order result:', result)
            console.log('[HL Client] Extracted OID:', oid)

            return {
                success: true,
                result: result,
                oid: oid,
                cloid: sdkOrder.orders[0].c,
                orderCount: sdkOrder.orders.length,
                timestamp: Date.now()
            }
        } catch (error: any) {
            console.error('[HL Client] Order failed:', error)
            console.error('[HL Client] Error type:', typeof error)
            console.error('[HL Client] Error message:', error?.message)
            console.error('[HL Client] Error response:', error?.response)
            console.error('[HL Client] Full error object:', JSON.stringify(error, null, 2))
            return {
                success: false,
                error: error?.message || error?.toString() || 'Unknown error',
                timestamp: Date.now()
            }
        }
    }

    /**
     * Get all open orders for the authenticated user
     * Handles HIP-3 assets by querying all DEXes
     * @returns Promise with array of open orders
     */
    async getUserOpenOrders(): Promise<any[]> {
        if (!this.isInitialized || !this.wallet) {
            console.error('[HL Client] getUserOpenOrders FAILED - Not initialized')
            console.error('  isInitialized:', this.isInitialized)
            console.error('  wallet:', !!this.wallet)
            throw new Error('Client not initialized')
        }

        try {
            console.log('[HL Client] Fetching open orders for:', this.wallet.address)
            
            // Get main DEX orders
            const mainOrders = await this.infoClient.openOrders({ 
                user: this.wallet.address 
            })
            
            console.log('[HL Client] API returned:', mainOrders?.length || 0, 'orders')
            
            if (mainOrders && mainOrders.length > 0) {
                console.log('[HL Client] First order sample:', {
                    oid: mainOrders[0].oid,
                    coin: mainOrders[0].coin,
                    side: mainOrders[0].side,
                    size: mainOrders[0].sz
                })
            }

            // TODO: For complete HIP-3 support, would need to query all known DEXes
            // For now, returning main DEX orders
            // HIP-3 orders will be queried per-asset in chase operations
            return mainOrders || []
        } catch (error: any) {
            console.error('[HL Client] Failed to get open orders:', error)
            console.error('[HL Client] Error details:', error.message, error.stack)
            return []
        }
    }

    /**
     * Get open orders for a specific asset (handles HIP-3)
     * @param asset - Asset symbol (e.g., "BTC" or "lighter:BTC")
     * @returns Promise with array of open orders for that asset
     */
    async getAssetOpenOrders(asset: string): Promise<any[]> {
        if (!this.isInitialized || !this.wallet) {
            throw new Error('Client not initialized')
        }

        try {
            const isHip3 = asset.includes(':')
            
            if (isHip3) {
                // For HIP-3, query specific DEX
                const dexName = asset.split(':')[0]
                const orders = await this.infoClient.openOrders({
                    user: this.wallet.address,
                    dex: dexName
                })
                return orders || []
            } else {
                // For regular assets, query main DEX
                const orders = await this.infoClient.openOrders({
                    user: this.wallet.address
                })
                return orders || []
            }
        } catch (error: any) {
            console.error(`[HL Client] Failed to get orders for ${asset}:`, error)
            return []
        }
    }

    /**
     * Get current market mid price with HIP-3 orderbook fallback
     */
    async getCurrentMarketPrice(asset: string): Promise<number> {
        const { mid } = await this.getBestBidAsk(asset)
        return mid
    }

    /**
     * Get position entry data for a specific asset (fresh API)
     */
    async getPositionEntry(
        asset: string,
        userAddress: string
    ): Promise<{ entryPrice: number; size: number; side: 'LONG' | 'SHORT' } | null> {
        if (!this.isInitialized) {
            throw new Error('Client not initialized')
        }

        try {
            const dexName = asset.includes(':') ? asset.split(':')[0] : ''
            const userState = await (this.infoClient as any).clearinghouseState({
                user: userAddress,
                dex: dexName
            })

            const position = userState?.assetPositions?.find((p: any) => p.position?.coin === asset)
            if (!position?.position) return null

            const size = parseFloat(position.position.szi || '0')
            const entryPrice = parseFloat(position.position.entryPx || '0')

            if (!entryPrice || !size) return null

            return {
                entryPrice,
                size: Math.abs(size),
                side: size > 0 ? 'LONG' : 'SHORT'
            }
        } catch (error: any) {
            console.error(`[HL Client] Failed to get position entry for ${asset}:`, error)
            return null
        }
    }

    /**
     * Cancel an open order by OID or CLOID
     * @param orderId - Order ID (number) or CLOID (hex string starting with 0x)
     * @param asset - Asset symbol (e.g., "BTC", "ETH")
     * @returns Promise with success status and message/error
     */
    async cancelOrder(orderId: string | number, asset: string): Promise<{ 
        success: boolean
        message?: string
        error?: string 
    }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        try {
            // Convert orderId to string for type checking
            const orderIdStr = String(orderId)
            
            // Detect if this is a spot order (asset starts with @)
            const isSpotOrder = asset.startsWith('@')
            
            let result
            
            if (isSpotOrder) {
                // For spot orders: index = 10000 + pair index (per Hyperliquid API spec)
                const spotIndex = 10000 + parseInt(asset.substring(1))
                
                // Check if CLOID or OID
                if (orderIdStr.startsWith('0x')) {
                    result = await this.exchClient.cancelByCloid({
                        cancels: [{
                            asset: spotIndex,
                            cloid: orderIdStr
                        }]
                    })
                } else {
                    result = await this.exchClient.cancel({
                        cancels: [{
                            a: spotIndex,
                            o: parseInt(orderIdStr)
                        }]
                    })
                }
            } else {
                // For perp orders, get asset index from metadata
                const assetIndex = await this.getAssetIndex(asset)
                
                // Check if CLOID (hex string starting with 0x) or regular OID (number)
                if (orderIdStr.startsWith('0x')) {
                    // Cancel by CLOID (hex identifier)
                    result = await this.exchClient.cancelByCloid({
                        cancels: [{
                            asset: assetIndex,
                            cloid: orderIdStr
                        }]
                    })
                } else {
                    // Cancel by regular OID (numeric identifier)
                    result = await this.exchClient.cancel({
                        cancels: [{
                            a: assetIndex,
                            o: parseInt(orderIdStr)
                        }]
                    })
                }
            }
            
            // Check success from SDK response
            const success = result?.response?.data?.statuses?.[0] === 'success'
            
            return {
                success: success,
                message: success ? `Order ${orderId} cancelled successfully` : 'Order cancellation failed'
            }
        } catch (error: any) {
            console.error('[HL Client] Cancel order failed:', error)
            return {
                success: false,
                error: error.message
            }
        }
    }

    /**
     * Close a position using market order (10% slippage for guaranteed execution)
     * @param asset - Asset symbol (e.g., "BTC", "ETH")
     * @param userAddress - User wallet address (from Privy auth)
     * @returns Promise with success status and message/error
     */
    async closePosition(asset: string, userAddress: string): Promise<{ 
        success: boolean
        message?: string
        error?: string 
    }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        try {
            // 0. Ensure HIP-3 DEX abstraction for HIP-3 assets
            if (asset.includes(':')) {
                await this.ensureHip3DexAbstraction()
            }

            // 1. Get current position from API
            // For HIP-3 assets, extract DEX name (e.g., "lighter:BTC" -> "lighter")
            // For regular assets, use empty string for main DEX
            const dexName = asset.includes(':') ? asset.split(':')[0] : ''
            
            const userState = await (this.infoClient as any).clearinghouseState({ 
                user: userAddress,
                dex: dexName
            })
            
            console.log('[HL Client] User state:', userState)
            console.log('[HL Client] Asset positions:', userState?.assetPositions)
            console.log('[HL Client] Looking for asset:', asset)
            console.log('[HL Client] DEX name:', dexName)
            
            // Log all position coins for debugging
            if (userState?.assetPositions) {
                userState.assetPositions.forEach((assetPos: any, idx: number) => {
                    console.log(`[HL Client] Position ${idx}:`, {
                        coin: assetPos?.position?.coin,
                        szi: assetPos?.position?.szi,
                        fullPosition: assetPos?.position
                    })
                })
            }
            
            const position = userState.assetPositions.find(
                (p: any) => p.position.coin === asset
            )
            
            console.log('[HL Client] Found position:', position)
            
            if (!position) {
                throw new Error(`No position found for ${asset}`)
            }

            // 2. Parse position details
            const positionSize = parseFloat(position.position.szi)
            const isLong = positionSize > 0
            
            // 3. Get asset metadata (caches szDecimals for rounding)
            const assetIndex = await this.getAssetIndex(asset)
            
            // 4. Get current market price (HIP-3 safe)
            const marketPrice = await this.getCurrentMarketPrice(asset)
            
            if (!marketPrice) {
                throw new Error(`Could not get market price for ${asset}`)
            }
            
            // 5. Calculate order parameters
            const orderSide = !isLong  // Opposite of position (sell to close long, buy to close short)
            const orderSize = Math.abs(positionSize)
            
            // Use 10% slippage for aggressive market execution (guaranteed fill)
            const slippage = 0.10
            const aggressivePrice = orderSide
                ? marketPrice * (1 + slippage)  // Buy 10% higher
                : marketPrice * (1 - slippage)  // Sell 10% lower
            
            // 6. Round to proper precision
            const roundedPrice = this.roundToTickSize(aggressivePrice)
            const roundedSize = this.roundToSizeDecimals(orderSize)
            
            if (roundedPrice === null || roundedSize === null) {
                throw new Error('Failed to round price or size')
            }
            
            // 7. Place IOC reduce-only order
            const result = await this.exchClient.order({
                orders: [{
                    a: assetIndex,
                    b: orderSide,
                    p: String(roundedPrice),
                    s: String(roundedSize),
                    r: true,  // reduce-only flag
                    t: { limit: { tif: 'Ioc' } }  // Immediate-or-cancel
                }],
                grouping: 'na',
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            })
            
            console.log('[HL Client] Close position result:', result)
            
            return {
                success: true,
                message: `Position closed for ${asset} at ~$${marketPrice.toFixed(2)}`
            }
        } catch (error: any) {
            console.error('[HL Client] Close position failed:', error)
            return {
                success: false,
                error: error.message
            }
        }
    }

    /**
     * Place a chase modification order - NO leverage update (matches reference chase-orderbook-live.js)
     * This places orders directly like the reference codebase does for chase modifications
     */
    async placeChaseOrder(params: {
        asset: string
        side: 'buy' | 'sell'
        price: number
        size: number
        reduceOnly?: boolean
    }): Promise<{
        success: boolean
        oid?: string
        error?: string
        filledImmediately?: boolean
    }> {
        if (!this.isInitialized || !this.exchClient) {
            return { success: false, error: 'Client not initialized' }
        }

        try {
            // Ensure HIP-3 DEX abstraction for HIP-3 assets
            if (params.asset.includes(':')) {
                await this.ensureHip3DexAbstraction()
            }

            const assetIndex = await this.getAssetIndex(params.asset)
            const cloid = this.generateCLOID()
            
            const roundedPrice = this.roundToTickSize(params.price)
            const roundedSize = this.roundToSizeDecimals(params.size)
            
            if (roundedPrice === null || roundedSize === null) {
                return { success: false, error: 'Failed to round price or size' }
            }
            
            console.log(`[HL Client] Chase order: ${params.side} ${roundedSize} ${params.asset} @ $${roundedPrice}`)
            
            // Place order directly - NO leverage update (like reference code)
            const result = await this.exchClient.order({
                orders: [{
                    a: assetIndex,
                    b: params.side === 'buy',
                    p: String(roundedPrice),
                    s: String(roundedSize),
                    r: Boolean(params.reduceOnly),
                    t: { limit: { tif: 'Gtc' as const } },
                    c: cloid
                }],
                grouping: 'na' as const,
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            })
            
            // Extract OID (check both resting and filled - order may fill immediately)
            let oid: string | undefined
            let filledImmediately = false
            if (result && (result as any).response?.type === 'order') {
                const status = (result as any).response.data?.statuses?.[0]
                if (status?.resting?.oid) {
                    oid = status.resting.oid.toString()
                } else if (status?.filled?.oid) {
                    oid = status.filled.oid.toString()
                    filledImmediately = true
                }
            }
            
            console.log('[HL Client] Chase order result:', result)
            console.log('[HL Client] Chase order OID:', oid)
            
            return { success: true, oid, filledImmediately }
        } catch (error: any) {
            console.error('[HL Client] Chase order failed:', error)
            return { success: false, error: error.message, filledImmediately: false }
        }
    }

    /**
     * Modify an existing order (cancel + replace with new params + optional TP/SL)
     */
    async modifyOrder(params: {
        asset: string
        price: number
        size: number
        side: 'BUY' | 'SELL'
        userAddress: string
        tp?: { price: number, isMarket: boolean }
        sl?: { price: number, isMarket: boolean }
    }): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        try {
            // Ensure HIP-3 DEX abstraction for HIP-3 assets
            if (params.asset.includes(':')) {
                await this.ensureHip3DexAbstraction()
            }

            const assetIndex = await this.getAssetIndex(params.asset)
            const cloid = this.generateCLOID()
            const orders: any[] = []

            const roundedSize = this.roundToSizeDecimals(params.size)
            const roundedPrice = this.roundToTickSize(params.price)

            if (!roundedSize || !roundedPrice) {
                throw new Error('Failed to round order parameters')
            }

            // Entry order
            orders.push({
                a: assetIndex,
                b: params.side === 'BUY',
                p: String(roundedPrice),
                s: String(roundedSize),
                r: false,
                t: { limit: { tif: 'Gtc' } },
                c: cloid
            })

            // TP order
            if (params.tp) {
                const roundedTP = this.roundToTickSize(params.tp.price)
                if (!roundedTP) throw new Error('Invalid TP price')

                orders.push({
                    a: assetIndex,
                    b: params.side !== 'BUY',
                    p: String(roundedTP),
                    s: String(roundedSize),
                    r: true,
                    t: {
                        trigger: {
                            isMarket: params.tp.isMarket,
                            triggerPx: String(roundedTP),
                            tpsl: 'tp'
                        }
                    },
                    c: cloid
                })
            }

            // SL order
            if (params.sl) {
                const roundedSL = this.roundToTickSize(params.sl.price)
                if (!roundedSL) throw new Error('Invalid SL price')

                orders.push({
                    a: assetIndex,
                    b: params.side !== 'BUY',
                    p: String(roundedSL),
                    s: String(roundedSize),
                    r: true,
                    t: {
                        trigger: {
                            isMarket: params.sl.isMarket,
                            triggerPx: String(roundedSL),
                            tpsl: 'sl'
                        }
                    },
                    c: cloid
                })
            }

            const grouping = (params.tp || params.sl) ? 'normalTpsl' : 'na'

            const result = await this.exchClient.order({
                orders,
                grouping,
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            })

            console.log('[HL Client] Modify order result:', result)

            return {
                success: true,
                message: `Order modified for ${params.asset}`
            }
        } catch (error: any) {
            console.error('[HL Client] Modify order failed:', error)
            return {
                success: false,
                error: error.message
            }
        }
    }

    /**
     * Set TP/SL orders on an active position
     */
    async setTPSL(params: {
        asset: string
        positionSize: number
        side: 'LONG' | 'SHORT'
        userAddress: string
        tp?: { price: number, isMarket: boolean }
        sl?: { price: number, isMarket: boolean }
    }): Promise<{ success: boolean; message?: string; error?: string }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        try {
            const assetIndex = await this.getAssetIndex(params.asset)
            const cloid = this.generateCLOID()
            const isBuy = params.side !== 'LONG'

            const roundedSize = this.roundToSizeDecimals(params.positionSize)
            if (!roundedSize) throw new Error('Invalid position size')

            const orders: any[] = []

            // TP order
            if (params.tp) {
                const roundedTP = this.roundToTickSize(params.tp.price)
                if (!roundedTP) throw new Error('Invalid TP price')

                orders.push({
                    a: assetIndex,
                    b: isBuy,
                    p: String(roundedTP),
                    s: String(roundedSize),
                    r: true,
                    t: {
                        trigger: {
                            isMarket: params.tp.isMarket,
                            triggerPx: String(roundedTP),
                            tpsl: 'tp'
                        }
                    },
                    c: cloid
                })
            }

            // SL order
            if (params.sl) {
                const roundedSL = this.roundToTickSize(params.sl.price)
                if (!roundedSL) throw new Error('Invalid SL price')

                orders.push({
                    a: assetIndex,
                    b: isBuy,
                    p: String(roundedSL),
                    s: String(roundedSize),
                    r: true,
                    t: {
                        trigger: {
                            isMarket: params.sl.isMarket,
                            triggerPx: String(roundedSL),
                            tpsl: 'sl'
                        }
                    },
                    c: cloid
                })
            }

            const result = await this.exchClient.order({
                orders,
                grouping: 'na',
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            })

            console.log('[HL Client] Set TP/SL result:', result)

            return {
                success: true,
                message: `TP/SL set for ${params.asset}`
            }
        } catch (error: any) {
            console.error('[HL Client] Set TP/SL failed:', error)
            return {
                success: false,
                error: error.message
            }
        }
    }

    private validateOrderData(orderData: OrderData): { isValid: boolean; errors: string[] } {
        const errors: string[] = []

        if (!orderData.asset) errors.push('Asset is required')
        if (!orderData.orderSide || !['buy', 'sell'].includes(orderData.orderSide)) {
            errors.push('Valid order side (buy/sell) is required')
        }
        if (!orderData.size || orderData.size <= 0) {
            errors.push('Valid order size is required')
        }
        if (!orderData.orderType || !['market', 'limit'].includes(orderData.orderType)) {
            errors.push('Valid order type is required')
        }

        // Price validation for limit orders
        if (orderData.orderType === 'limit') {
            const hasValidPrice = orderData.price && !isNaN(orderData.price) && orderData.price > 0
            const hasTpSlOrders = orderData.tpslEnabled && (orderData.tpPrice || orderData.slPrice)
            
            if (!hasValidPrice && !hasTpSlOrders) {
                errors.push('Price required for limit orders')
            }
        }

        // TP/SL validation
        if (orderData.tpslEnabled) {
            if (orderData.tpPrice && orderData.tpPrice <= 0) {
                errors.push('Take profit price must be positive')
            }
            if (orderData.slPrice && orderData.slPrice <= 0) {
                errors.push('Stop loss price must be positive')
            }
            if (!orderData.tpPrice && !orderData.slPrice) {
                errors.push('At least one TP or SL price required when TP/SL enabled')
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        }
    }

    private async buildSDKOrder(orderData: OrderData): Promise<any> {
        // Get asset index (caches szDecimals)
        const assetIndex = await this.getAssetIndex(orderData.asset)
        const cloid = this.generateCLOID()
        const orders: any[] = []
        const isSpotAsset = orderData.asset.startsWith('@')

        // Build entry order
        const hasValidPrice = orderData.price && !isNaN(orderData.price) && orderData.price > 0
        const isMarketOrder = orderData.orderType === 'market'

        if (isMarketOrder || hasValidPrice) {
            const entryOrder = await this.buildEntryOrder(orderData, assetIndex, cloid)
            orders.push(entryOrder)
        }

        // Add TP/SL orders (perps only — spot doesn't support TP/SL grouping)
        if (!isSpotAsset && orderData.tpslEnabled) {
            if (orderData.tpPrice) {
                const tpOrder = await this.buildTPOrder(orderData, assetIndex, cloid)
                orders.push(tpOrder)
            }
            if (orderData.slPrice) {
                const slOrder = await this.buildSLOrder(orderData, assetIndex, cloid)
                orders.push(slOrder)
            }
        }

        // Spot: grouping always 'na', builder fee on both sides
        // Perps: normal grouping with builder fee on both sides
        if (isSpotAsset) {
            return {
                orders: orders,
                grouping: 'na',
                builder: {
                    b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                    f: 10
                }
            }
        }

        return {
            orders: orders,
            grouping: orderData.tpslEnabled ? 'normalTpsl' : 'na',
            builder: {
                b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                f: 10
            }
        }
    }

    private async buildEntryOrder(orderData: OrderData, assetIndex: number, cloid: string): Promise<any> {
        const roundedSize = this.roundToSizeDecimals(orderData.size)
        if (roundedSize === null) {
            throw new Error('Invalid order size')
        }

        const isSpot = orderData.asset.startsWith('@')

        const baseOrder: any = {
            a: assetIndex,
            b: orderData.orderSide === 'buy',
            s: String(roundedSize),
            // Spot buy: never reduceOnly. Spot sell: can be reduceOnly. Perps: as specified.
            r: isSpot ? (orderData.orderSide === 'sell' ? Boolean(orderData.reduceOnly) : false) : Boolean(orderData.reduceOnly),
            c: cloid
        }

        // Market order
        if (orderData.orderType === 'market') {
            const bidAsk = await this.getBestBidAsk(orderData.asset)
            
            // Spot uses tighter slippage (3%) vs perps (10%)
            const slippageBuffer = isSpot ? 0.03 : 0.10
            const basePrice = orderData.orderSide === 'buy' 
                ? bidAsk.bestAsk
                : bidAsk.bestBid
            
            const priceWithSlippage = orderData.orderSide === 'buy' 
                ? basePrice * (1 + slippageBuffer)
                : basePrice * (1 - slippageBuffer)
            
            baseOrder.p = String(this.roundToTickSize(priceWithSlippage))
            // Spot market orders use Ioc (Immediate-or-Cancel), perps use Gtc
            baseOrder.t = { limit: { tif: isSpot ? 'Ioc' : 'Gtc' } }
        }
        // Limit order
        else if (orderData.orderType === 'limit' && orderData.price) {
            const roundedPrice = this.roundToTickSize(orderData.price)
            if (roundedPrice === null) {
                throw new Error('Invalid price for limit order')
            }
            baseOrder.p = String(roundedPrice)
            baseOrder.t = { limit: { tif: 'Gtc' } }
        }

        return baseOrder
    }

    private async buildTPOrder(orderData: OrderData, assetIndex: number, cloid: string): Promise<any> {
        const tpPrice = parseFloat(orderData.tpPrice as any)
        const roundedSize = this.roundToSizeDecimals(orderData.size)
        if (roundedSize === null) {
            throw new Error('Failed to round order size')
        }

        const tpOrder = {
            a: assetIndex,
            b: orderData.orderSide !== 'buy',
            p: String(this.roundToTickSize(tpPrice)),
            s: String(roundedSize),
            r: true,
            t: {
                trigger: {
                    isMarket: orderData.tpIsLimit === false,
                    triggerPx: String(this.roundToTickSize(tpPrice)),
                    tpsl: 'tp'
                }
            },
            c: cloid
        }
        return tpOrder
    }

    private async buildSLOrder(orderData: OrderData, assetIndex: number, cloid: string): Promise<any> {
        const slPrice = parseFloat(orderData.slPrice as any)
        const roundedSize = this.roundToSizeDecimals(orderData.size)
        if (roundedSize === null) {
            throw new Error('Failed to round order size')
        }

        const slOrder = {
            a: assetIndex,
            b: orderData.orderSide !== 'buy',
            p: String(this.roundToTickSize(slPrice)),
            s: String(roundedSize),
            r: true,
            t: {
                trigger: {
                    isMarket: orderData.slIsLimit === false,
                    triggerPx: String(this.roundToTickSize(slPrice)),
                    tpsl: 'sl'
                }
            },
            c: cloid
        }
        return slOrder
    }

    private async getAssetIndex(assetSymbol: string): Promise<number> {
        // Check cache (use original assetSymbol as key)
        const cached = this.assetIndexCache.get(assetSymbol)
        if (cached) {
            this.assetSzDecimals = cached.szDecimals
            this.priceDecimals = cached.priceDecimals
            return cached.index
        }

        // Spot assets use @{pairIndex} format — delegate to spot-specific handler
        if (assetSymbol.startsWith('@')) {
            return this.getSpotAssetIndex(assetSymbol)
        }

        // Detect DEX from HIP-3 symbol
        let dexParam = ''
        let isHip3 = false
        if (assetSymbol.includes(':')) {
            dexParam = assetSymbol.split(':')[0]
            isHip3 = true
        }

        // Fetch meta for DEX (cache per dexParam)
        let meta = this.metaCache.get(dexParam)
        if (!meta) {
            meta = await this.infoClient.meta(dexParam ? { dex: dexParam } : undefined)
            this.metaCache.set(dexParam, meta)
        }

        const relativeIndex = meta.universe.findIndex((a: any) => a.name === assetSymbol)
        if (relativeIndex === -1) {
            throw new Error(`Asset ${assetSymbol} not found in ${dexParam || 'main'} DEX universe`)
        }

        const asset = meta.universe[relativeIndex]
        this.assetSzDecimals = parseInt(asset.szDecimals)
        this.priceDecimals = 6 - this.assetSzDecimals

        let absoluteIndex = relativeIndex
        if (isHip3) {
            if (!this.perpDexsCache) {
                this.perpDexsCache = await (this.infoClient as any).perpDexs()
            }

            const allDexs = this.perpDexsCache || []
            let dexPosition = -1
            for (let i = 0; i < allDexs.length; i++) {
                const dex = allDexs[i]
                if (dex && typeof dex.name === 'string' && dex.name === dexParam) {
                    dexPosition = allDexs.slice(0, i).filter((d: any) => d !== null).length
                    break
                }
            }

            if (dexPosition === -1) {
                throw new Error(`DEX ${dexParam} not found in perpDexs list`)
            }

            const offset = 110000 + (dexPosition * 10000)
            absoluteIndex = relativeIndex + offset
        }

        this.assetIndexCache.set(assetSymbol, {
            index: absoluteIndex,
            szDecimals: this.assetSzDecimals,
            priceDecimals: this.priceDecimals
        })

        // Cross-populate HyperliquidService singleton cache for UI display (getSzDecimalsSync)
        try {
            hyperliquid.cacheSzDecimals(assetSymbol, this.assetSzDecimals, this.priceDecimals)
        } catch (_) { /* singleton may not be ready */ }

        return absoluteIndex
    }

    async getBestBidAsk(asset: string): Promise<{ bestBid: number; bestAsk: number; mid: number }> {
        await this.getAssetIndex(asset)

        // Spot and HIP-3 assets need L2 book (not in allMids)
        if (asset.includes(':') || asset.startsWith('@')) {
            try {
                const l2 = await (this.infoClient as any).l2Book({ coin: asset })
                const bids = l2?.levels?.[0] || []
                const asks = l2?.levels?.[1] || []

                if (bids.length > 0 && asks.length > 0) {
                    const bestBid = this.roundToTickSize(parseFloat(bids[0].px))
                    const bestAsk = this.roundToTickSize(parseFloat(asks[0].px))
                    const midRaw = (parseFloat(bids[0].px) + parseFloat(asks[0].px)) / 2
                    const mid = this.roundToTickSize(midRaw)

                    if (bestBid === null || bestAsk === null || mid === null) {
                        throw new Error(`Failed to calculate bid/ask for ${asset}`)
                    }

                    return { bestBid, bestAsk, mid }
                }
            } catch (error) {
                console.error(`[HL Client] Failed to get orderbook for ${asset}:`, error)
            }
        }

        const allMids = await this.infoClient.allMids()

        if (allMids[asset]) {
            const midPrice = parseFloat(allMids[asset])
            const bestBid = this.roundToTickSize(midPrice * 0.9999)
            const bestAsk = this.roundToTickSize(midPrice * 1.0001)
            const mid = this.roundToTickSize(midPrice)

            if (bestBid === null || bestAsk === null || mid === null) {
                throw new Error(`Failed to calculate bid/ask for ${asset}`)
            }

            return { bestBid, bestAsk, mid }
        }

        throw new Error(`Market price not found for ${asset}`)
    }

    private roundToSizeDecimals(size: number): number | null {
        const numSize = typeof size === 'string' ? parseFloat(size as any) : size
        if (isNaN(numSize) || numSize <= 0) return null
        
        const decimals = this.assetSzDecimals !== undefined ? this.assetSzDecimals : 5
        const result = parseFloat(numSize.toFixed(decimals))
        return parseFloat(result.toString())
    }

    private roundToTickSize(price: number): number | null {
        const numPrice = typeof price === 'string' ? parseFloat(price as any) : price
        if (isNaN(numPrice) || numPrice <= 0) return null
        
        const maxDecimals = 6
        const priceDecimals = this.assetSzDecimals !== undefined 
            ? maxDecimals - this.assetSzDecimals 
            : 2
        
        const significantFigures = 5
        const magnitude = Math.floor(Math.log10(Math.abs(numPrice)))
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1))
        
        const multiplier = Math.pow(10, maxDecimalPlaces)
        return Math.round(numPrice * multiplier) / multiplier
    }

    private generateCLOID(): string {
        let now = Date.now()

        if (now !== this._cloidLastMs) {
            this._cloidCounter = 0
            this._cloidLastMs = now
        } else {
            this._cloidCounter++
            if (this._cloidCounter > 0xFFFF) {
                while (Date.now() === this._cloidLastMs) {
                    // Wait
                }
                now = Date.now()
                this._cloidCounter = 0
                this._cloidLastMs = now
            }
        }

        const timestampHex = now.toString(16)
        const counterHex = this._cloidCounter.toString(16).padStart(4, '0')
        return '0x' + (timestampHex + counterHex).padStart(32, '0')
    }

    private roundPrice(price: number, szDecimals: number): number {
        const maxDecimals = 6
        const priceDecimals = maxDecimals - szDecimals
        const significantFigures = 5
        const magnitude = Math.floor(Math.log10(Math.abs(price)))
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1))
        const multiplier = Math.pow(10, maxDecimalPlaces)
        return Math.round(price * multiplier) / multiplier
    }

    private roundSize(size: number, szDecimals: number): number {
        return parseFloat(size.toFixed(szDecimals))
    }

    /**
     * Cancel multiple orders in batch
     * Strategy: Cancel entry orders first (auto-cancels their TP/SL), then clean up orphaned reduce-only orders
     */
    async cancelMultipleOrders(orders: { orderId: string, asset: string, reduceOnly?: boolean }[]): Promise<{
        success: boolean
        successCount: number
        totalOrders: number
        errors: string[]
    }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        const errors: string[] = []
        let successCount = 0

        // Separate into entry orders vs TP/SL orders
        const entryOrders = orders.filter(o => !o.reduceOnly)
        const tpslOrders = orders.filter(o => o.reduceOnly)

        console.log(`[HL Client] Cancelling ${orders.length} orders (${entryOrders.length} entry, ${tpslOrders.length} TP/SL)`)

        // Cancel entry orders first (this auto-cancels their TP/SL orders)
        for (const order of entryOrders) {
            try {
                const result = await this.cancelOrder(order.orderId, order.asset)
                if (result.success) {
                    successCount++
                } else {
                    errors.push(`${order.asset}: ${result.error || 'Failed'}`)
                }
            } catch (error: any) {
                errors.push(`${order.asset}: ${error.message}`)
            }
        }

        // Cancel remaining TP/SL orders (orphaned ones)
        for (const order of tpslOrders) {
            try {
                const result = await this.cancelOrder(order.orderId, order.asset)
                if (result.success) {
                    successCount++
                } else {
                    errors.push(`${order.asset} TP/SL: ${result.error || 'Failed'}`)
                }
            } catch (error: any) {
                errors.push(`${order.asset} TP/SL: ${error.message}`)
            }
        }

        return {
            success: successCount > 0,
            successCount,
            totalOrders: orders.length,
            errors
        }
    }

    /**
     * Close multiple positions using market orders (10% slippage)
     */
    async closeMultiplePositions(positions: { asset: string, userAddress: string }[]): Promise<{
        success: boolean
        successCount: number
        totalPositions: number
        errors: string[]
    }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        const errors: string[] = []
        let successCount = 0

        console.log(`[HL Client] Closing ${positions.length} positions with market orders`)

        for (const position of positions) {
            try {
                const result = await this.closePosition(position.asset, position.userAddress)
                if (result.success) {
                    successCount++
                } else {
                    errors.push(`${position.asset}: ${result.error || 'Failed'}`)
                }
            } catch (error: any) {
                errors.push(`${position.asset}: ${error.message}`)
            }
        }

        return {
            success: successCount > 0,
            successCount,
            totalPositions: positions.length,
            errors
        }
    }

    /**
     * Close multiple positions using limit orders with progressive slippage
     * Strategy: 0.1% -> wait 3s -> 0.5% -> wait 3s -> 10% (market fallback)
     */
    async closeMultiplePositionsLimit(positions: { asset: string, userAddress: string }[]): Promise<{
        success: boolean
        successCount: number
        totalPositions: number
        errors: string[]
    }> {
        if (!this.isInitialized || !this.exchClient) {
            throw new Error('Client not initialized')
        }

        // Ensure HIP-3 DEX abstraction if any position is HIP-3
        if (positions.some(p => p.asset.includes(':'))) {
            await this.ensureHip3DexAbstraction()
        }

        const errors: string[] = []
        let successCount = 0

        console.log(`[HL Client] Closing ${positions.length} positions with progressive limit orders`)

        for (const position of positions) {
            try {
                // Get user state to determine position details
                const dexName = position.asset.includes(':') ? position.asset.split(':')[0] : ''
                const userState = await (this.infoClient as any).clearinghouseState({ 
                    user: position.userAddress,
                    dex: dexName
                })
                const positionData = userState.assetPositions?.find((p: any) => p.position.coin === position.asset)

                if (!positionData) {
                    errors.push(`${position.asset}: Position not found`)
                    continue
                }

                const positionSize = parseFloat(positionData.position.szi)
                const isLong = positionSize > 0
                const size = Math.abs(positionSize)

                // Get asset index and rounding precision
                const assetIndex = await this.getAssetIndex(position.asset)
                const szDecimals = this.assetSzDecimals ?? 5

                // Get current mark price (HIP-3 safe)
                const currentPrice = await this.getCurrentMarketPrice(position.asset)

                if (!currentPrice || currentPrice <= 0) {
                    errors.push(`${position.asset}: Invalid price`)
                    continue
                }

                // Tier 1: 0.1% slippage
                const slippage1 = isLong ? -0.001 : 0.001
                const price1 = currentPrice * (1 + slippage1)
                const roundedPrice1 = this.roundPrice(price1, szDecimals)
                const roundedSize = this.roundSize(size, szDecimals)

                let orderResult = await this.exchClient.order({
                    orders: [{
                        a: assetIndex,
                        b: !isLong,
                        p: roundedPrice1.toString(),
                        s: roundedSize.toString(),
                        r: true,
                        t: { limit: { tif: 'Ioc' } }
                    }],
                    grouping: 'na',
                    builder: {
                        b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                        f: 10
                    }
                })

                // Wait 3s
                await new Promise(resolve => setTimeout(resolve, 3000))

                // Check if filled
                const userStateAfter1 = await (this.infoClient as any).clearinghouseState({ 
                    user: position.userAddress,
                    dex: dexName
                })
                const stillOpen1 = userStateAfter1.assetPositions?.find((p: any) => 
                    p.position.coin === position.asset && Math.abs(parseFloat(p.position.szi)) > 0
                )

                if (!stillOpen1) {
                    successCount++
                    continue
                }

                // Tier 2: 0.5% slippage
                const slippage2 = isLong ? -0.005 : 0.005
                const price2 = currentPrice * (1 + slippage2)
                const roundedPrice2 = this.roundPrice(price2, szDecimals)

                orderResult = await this.exchClient.order({
                    orders: [{
                        a: assetIndex,
                        b: !isLong,
                        p: roundedPrice2.toString(),
                        s: roundedSize.toString(),
                        r: true,
                        t: { limit: { tif: 'Ioc' } }
                    }],
                    grouping: 'na',
                    builder: {
                        b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                        f: 10
                    }
                })

                // Wait 3s
                await new Promise(resolve => setTimeout(resolve, 3000))

                // Check if filled
                const userStateAfter2 = await (this.infoClient as any).clearinghouseState({ 
                    user: position.userAddress,
                    dex: dexName
                })
                const stillOpen2 = userStateAfter2.assetPositions?.find((p: any) => 
                    p.position.coin === position.asset && Math.abs(parseFloat(p.position.szi)) > 0
                )

                if (!stillOpen2) {
                    successCount++
                    continue
                }

                // Tier 3: 10% slippage (market fallback)
                const closeResult = await this.closePosition(position.asset, position.userAddress)
                if (closeResult.success) {
                    successCount++
                } else {
                    errors.push(`${position.asset}: ${closeResult.error || 'Failed after all tiers'}`)
                }

            } catch (error: any) {
                errors.push(`${position.asset}: ${error.message}`)
            }
        }

        return {
            success: successCount > 0,
            successCount,
            totalPositions: positions.length,
            errors
        }
    }
}
