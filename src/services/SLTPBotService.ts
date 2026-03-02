/**
 * SL/TP Bot Service (Position Defense)
 * Automatically adds stop-loss and take-profit to new positions
 * 
 * Features:
 * - Polls positions every 30 seconds
 * - Matches positions by asset AND exact size (1% tolerance)
 * - Two consecutive checks before adding missing TP/SL
 * - Classifies TP vs SL based on price relative to entry
 * - Uses CURRENT MARKET PRICE for TP/SL calculation
 */
import * as hl from '@nktkas/hyperliquid'
import { toast } from 'sonner'

interface PendingVerification {
    asset: string
    size: number
    side: 'long' | 'short'
    missingTP: boolean
    missingSL: boolean
    timestamp: number
}

interface TPSLResult {
    hasTP: boolean
    hasSL: boolean
    tp: any | null
    sl: any | null
}

class SLTPBotServiceClass {
    private enabled = false
    private autoSlEnabled = true
    private autoTpEnabled = true
    private defaultSlPct = 2.0
    private defaultTpPct = 2.0
    private monitorInterval: NodeJS.Timeout | null = null
    private checkIntervalMs = 30000 // 30 seconds (matches old codebase)
    private infoClient: hl.InfoClient
    private exchClient: hl.ExchangeClient | null = null
    private userAddress: string | null = null
    private pendingVerification = new Map<string, PendingVerification>()
    private onLog: ((message: string, type: 'info' | 'success' | 'error') => void) | null = null
    private logToConsole = false

    constructor() {
        const transport = new hl.HttpTransport({ isTestnet: false })
        this.infoClient = new hl.InfoClient({ transport })
        this.loadSettings()
    }

    setLogCallback(callback: (message: string, type: 'info' | 'success' | 'error') => void) {
        this.onLog = callback
    }

    private log(message: string, type: 'info' | 'success' | 'error' = 'info') {
        if (this.onLog) {
            this.onLog(`[SL/TP Bot] ${message}`, type)
        }
        if (this.logToConsole) {
            console.log(`[SL/TP Bot] ${message}`)
        }
    }

    initialize(exchClient: hl.ExchangeClient, userAddress: string) {
        this.exchClient = exchClient
        this.userAddress = userAddress
        this.log(`Initialized for ${userAddress.slice(0, 8)}...`)
    }

    // Receive global store data (called by BotProvider)
    private globalPositions: any[] = []
    private globalOrders: any[] = []

    updateGlobalData(data: { positions?: any[]; orders?: any[] }) {
        if (data.positions) this.globalPositions = data.positions
        if (data.orders) this.globalOrders = data.orders
    }

    enable() {
        if (this.enabled) return true
        this.enabled = true
        this.saveSettings()
        this.startMonitoring()
        this.log('Enabled', 'success')
        return true
    }

    disable() {
        if (!this.enabled) return true
        this.enabled = false
        this.saveSettings()
        this.stopMonitoring()
        this.pendingVerification.clear()
        this.log('Disabled', 'info')
        return true
    }

    isEnabled() {
        return this.enabled
    }

    updateSettings(settings: { 
        autoSlEnabled?: boolean
        autoTpEnabled?: boolean
        defaultSlPct?: number
        defaultTpPct?: number 
    }) {
        if (settings.autoSlEnabled !== undefined) this.autoSlEnabled = settings.autoSlEnabled
        if (settings.autoTpEnabled !== undefined) this.autoTpEnabled = settings.autoTpEnabled
        if (settings.defaultSlPct !== undefined) this.defaultSlPct = settings.defaultSlPct
        if (settings.defaultTpPct !== undefined) this.defaultTpPct = settings.defaultTpPct
        this.saveSettings()
        this.log(`Settings: SL=${this.autoSlEnabled ? this.defaultSlPct + '%' : 'off'}, TP=${this.autoTpEnabled ? this.defaultTpPct + '%' : 'off'}`)
    }

    private startMonitoring() {
        if (this.monitorInterval) return
        this.log('Starting position monitoring (30s interval)')
        this.checkPositions()
        this.monitorInterval = setInterval(() => this.checkPositions(), this.checkIntervalMs)
    }

    private stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval)
            this.monitorInterval = null
            this.log('Monitoring stopped')
        }
    }

    /**
     * Main check cycle - matches old codebase browser-position-defense-bot.js
     */
    private async checkPositions() {
        if (!this.enabled || !this.exchClient || !this.userAddress) return
        if (!this.autoSlEnabled && !this.autoTpEnabled) return

        try {
            // Fetch positions and orders (API-first for raw data format)
            const [clearinghouse, openOrders, allMids] = await Promise.all([
                this.infoClient.clearinghouseState({ user: this.userAddress }),
                this.infoClient.openOrders({ user: this.userAddress }),
                this.infoClient.allMids()
            ])

            if (!clearinghouse?.assetPositions) return

            // Filter to active positions (non-zero size)
            const activePositions = clearinghouse.assetPositions.filter((p: any) => {
                const size = Math.abs(parseFloat(p.position.szi))
                return size > 0
            })

            if (activePositions.length === 0) {
                this.pendingVerification.clear()
                return
            }

            // Check each position
            for (const position of activePositions) {
                try {
                    await this.checkPosition(position, openOrders, allMids)
                } catch (error) {
                    // Silent fail per position
                }
            }

            // Clean up stale pending verifications (older than 5 minutes)
            this.cleanupStaleVerifications()

        } catch (error) {
            this.log(`Error checking positions: ${(error as Error).message}`, 'error')
        }
    }

    /**
     * Check a single position for missing TP/SL
     * Matches old codebase logic exactly
     */
    private async checkPosition(position: any, openOrders: any[], allMids: Record<string, string>) {
        const asset = position.position.coin
        const positionSize = parseFloat(position.position.szi)
        const positionSizeAbs = Math.abs(positionSize)
        const isLong = positionSize > 0
        const side: 'long' | 'short' = isLong ? 'long' : 'short'
        const entryPrice = parseFloat(position.position.entryPx)

        // Get current market price
        const currentPrice = parseFloat(allMids[asset])
        if (!currentPrice || isNaN(currentPrice)) {
            return // Skip if no market price
        }

        // Find TP/SL orders for this EXACT position (by asset AND size)
        const tpslResult = this.findTPSLForPosition(position, openOrders)

        const missingTP = this.autoTpEnabled && !tpslResult.hasTP
        const missingSL = this.autoSlEnabled && !tpslResult.hasSL

        if (!missingTP && !missingSL) {
            // Has both TP and SL - clear any pending verification
            const key = this.getPositionKey(asset, positionSizeAbs)
            if (this.pendingVerification.has(key)) {
                this.pendingVerification.delete(key)
            }
            return
        }

        // Missing TP or SL - check verification status
        const key = this.getPositionKey(asset, positionSizeAbs)

        if (this.pendingVerification.has(key)) {
            // SECOND CONSECUTIVE CHECK - VERIFIED MISSING
            this.log(`Verified missing ${missingSL ? 'SL' : ''}${missingSL && missingTP ? '/' : ''}${missingTP ? 'TP' : ''} for ${asset}`)

            await this.addMissingTPSL(asset, side, positionSizeAbs, currentPrice, missingTP, missingSL)

            this.pendingVerification.delete(key)
        } else {
            // FIRST DETECTION - Mark for verification
            this.log(`Detected missing ${missingSL ? 'SL' : ''}${missingSL && missingTP ? '/' : ''}${missingTP ? 'TP' : ''} for ${asset} - verifying...`)

            this.pendingVerification.set(key, {
                asset,
                size: positionSizeAbs,
                side,
                missingTP,
                missingSL,
                timestamp: Date.now()
            })
        }
    }

    /**
     * Find TP/SL orders for a specific position
     * Matches by asset AND exact size (1% tolerance)
     * Classifies as TP or SL based on price relative to entry
     */
    private findTPSLForPosition(position: any, openOrders: any[]): TPSLResult {
        const asset = position.position.coin
        const positionSize = Math.abs(parseFloat(position.position.szi))
        const isLong = parseFloat(position.position.szi) > 0
        const entryPrice = parseFloat(position.position.entryPx)

        // Filter reduce-only orders for this asset with matching size
        const tpslOrders = openOrders.filter((order: any) => {
            // Must match asset
            if (order.coin !== asset) return false

            // Must be reduce-only
            if (!order.reduceOnly) return false

            // Size must match position (with 1% tolerance for rounding)
            const orderSize = Math.abs(parseFloat(order.sz))
            const sizeDiff = Math.abs(orderSize - positionSize)
            const tolerance = positionSize * 0.01
            if (sizeDiff > tolerance) return false

            return true
        })

        // Classify as TP or SL based on price relative to entry
        let tp: any = null
        let sl: any = null

        for (const order of tpslOrders) {
            const orderPrice = parseFloat(order.limitPx)

            // LONG: TP above entry, SL below entry
            // SHORT: TP below entry, SL above entry
            const isProfitable = isLong
                ? (orderPrice > entryPrice)
                : (orderPrice < entryPrice)

            if (isProfitable) {
                if (!tp || (isLong ? orderPrice > parseFloat(tp.limitPx) : orderPrice < parseFloat(tp.limitPx))) {
                    tp = order
                }
            } else {
                if (!sl || (isLong ? orderPrice > parseFloat(sl.limitPx) : orderPrice < parseFloat(sl.limitPx))) {
                    sl = order
                }
            }
        }

        return { hasTP: !!tp, hasSL: !!sl, tp, sl }
    }

    /**
     * Add missing TP/SL orders for a position
     * Uses CURRENT MARKET PRICE for calculation (matches old codebase)
     */
    private async addMissingTPSL(
        asset: string,
        side: 'long' | 'short',
        size: number,
        currentPrice: number,
        needsTP: boolean,
        needsSL: boolean
    ): Promise<boolean> {
        if (!this.exchClient) return false

        // Input validation (matches old codebase)
        if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
            this.log(`Invalid current price for ${asset}: ${currentPrice}`, 'error')
            return false
        }
        if (size === 0 || isNaN(size)) {
            this.log(`Invalid position size for ${asset}: ${size}`, 'error')
            return false
        }

        try {
            const isHip3 = asset.includes(':')
            const dexParam = isHip3 ? asset.split(':')[0] : ''
            const meta = await (this.infoClient as any).meta(dexParam ? { dex: dexParam } : undefined)
            const assetMeta = meta.universe.find((a: any) => a.name === asset)
            if (!assetMeta) {
                this.log(`Asset ${asset} not found in ${dexParam || 'main'} metadata`, 'error')
                return false
            }
            let assetIndex = meta.universe.indexOf(assetMeta)
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
            const szDecimals = assetMeta.szDecimals || 3
            const roundedSize = this.roundToSizeDecimals(size, szDecimals)
            if (!roundedSize || roundedSize <= 0) {
                this.log(`Invalid rounded size for ${asset}: ${roundedSize}`, 'error')
                return false
            }
            const isLong = side === 'long'
            const isBuy = !isLong // TP/SL are opposite direction

            // Calculate prices from CURRENT MARKET PRICE (not entry) - matches old codebase
            if (needsSL) {
                // SL is in loss direction: LONG SL lower, SHORT SL higher
                const slPrice = isLong
                    ? currentPrice * (1 - this.defaultSlPct / 100)
                    : currentPrice * (1 + this.defaultSlPct / 100)
                
                // Validate SL price
                if (isNaN(slPrice) || slPrice <= 0 || !isFinite(slPrice)) {
                    this.log(`Invalid SL price calculated: ${slPrice}`, 'error')
                    return false
                }
                
                const roundedSlPrice = this.roundToTickSize(slPrice, szDecimals)
                if (!roundedSlPrice || !isFinite(roundedSlPrice) || roundedSlPrice <= 0) {
                    this.log(`Invalid SL price after rounding: ${roundedSlPrice}`, 'error')
                    return false
                }

                await this.exchClient.order({
                    orders: [{
                        a: assetIndex,
                        b: isBuy,
                        p: roundedSlPrice.toString(),
                        s: roundedSize.toString(),
                        r: true,
                        t: {
                            trigger: {
                                isMarket: true,
                                triggerPx: roundedSlPrice.toString(),
                                tpsl: 'sl'
                            }
                        }
                    }],
                    grouping: 'positionTpsl',
                    builder: {
                        b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                        f: 10
                    }
                })

                this.log(`Placed SL for ${asset} @ $${roundedSlPrice.toFixed(2)} (${this.defaultSlPct}% ${isLong ? 'below' : 'above'} current)`, 'success')
                toast.info('Auto SL placed', { description: `${asset} @ $${roundedSlPrice.toFixed(2)} (${this.defaultSlPct}%)` })
            }

            if (needsTP) {
                // TP is in profit direction: LONG TP higher, SHORT TP lower
                const tpPrice = isLong
                    ? currentPrice * (1 + this.defaultTpPct / 100)
                    : currentPrice * (1 - this.defaultTpPct / 100)
                
                // Validate TP price
                if (isNaN(tpPrice) || tpPrice <= 0 || !isFinite(tpPrice)) {
                    this.log(`Invalid TP price calculated: ${tpPrice}`, 'error')
                    return false
                }
                
                const roundedTpPrice = this.roundToTickSize(tpPrice, szDecimals)
                if (!roundedTpPrice || !isFinite(roundedTpPrice) || roundedTpPrice <= 0) {
                    this.log(`Invalid TP price after rounding: ${roundedTpPrice}`, 'error')
                    return false
                }

                await this.exchClient.order({
                    orders: [{
                        a: assetIndex,
                        b: isBuy,
                        p: roundedTpPrice.toString(),
                        s: roundedSize.toString(),
                        r: true,
                        t: {
                            trigger: {
                                isMarket: false,
                                triggerPx: roundedTpPrice.toString(),
                                tpsl: 'tp'
                            }
                        }
                    }],
                    grouping: 'positionTpsl',
                    builder: {
                        b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                        f: 10
                    }
                })

                this.log(`Placed TP for ${asset} @ $${roundedTpPrice.toFixed(2)} (${this.defaultTpPct}% ${isLong ? 'above' : 'below'} current)`, 'success')
                toast.info('Auto TP placed', { description: `${asset} @ $${roundedTpPrice.toFixed(2)} (${this.defaultTpPct}%)` })
            }

            return true
        } catch (error) {
            this.log(`Error placing TP/SL for ${asset}: ${(error as Error).message}`, 'error')
            toast.error('SL/TP placement failed', { description: asset })
            return false
        }
    }

    /**
     * Generate unique key for position tracking (asset + size)
     */
    private getPositionKey(asset: string, size: number): string {
        return `${asset}_${size.toFixed(6)}`
    }

    /**
     * Clean up stale pending verifications (older than 5 minutes)
     */
    private cleanupStaleVerifications() {
        const now = Date.now()
        const staleThreshold = 5 * 60 * 1000

        for (const [key, data] of this.pendingVerification.entries()) {
            if (now - data.timestamp > staleThreshold) {
                this.pendingVerification.delete(key)
            }
        }
    }

    private roundToTickSize(price: number, szDecimals?: number): number | null {
        if (price === null || price === undefined || isNaN(price)) {
            return null
        }

        const numPrice = typeof price === 'string' ? parseFloat(price) : price
        if (isNaN(numPrice) || numPrice <= 0) {
            return null
        }

        const maxDecimals = 6
        const priceDecimals = szDecimals !== undefined ? maxDecimals - szDecimals : 2
        const significantFigures = 5
        const magnitude = Math.floor(Math.log10(Math.abs(numPrice)))
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1))
        const multiplier = Math.pow(10, maxDecimalPlaces)

        return Math.round(numPrice * multiplier) / multiplier
    }

    private roundToSizeDecimals(size: number, szDecimals?: number): number | null {
        if (size === null || size === undefined || isNaN(size)) {
            return null
        }

        const numSize = typeof size === 'string' ? parseFloat(size) : size
        if (isNaN(numSize) || numSize <= 0) {
            return null
        }

        const decimals = szDecimals !== undefined ? szDecimals : 5

        if (numSize < 1e-15) {
            return 0
        }

        if (numSize > 1e15) {
            const scientific = numSize.toExponential()
            return parseFloat(parseFloat(scientific).toFixed(decimals))
        }

        const result = parseFloat(numSize.toFixed(decimals))
        return parseFloat(result.toString())
    }

    private saveSettings() {
        if (typeof window !== 'undefined') {
            localStorage.setItem('sltpBotSettings', JSON.stringify({
                enabled: this.enabled,
                autoSlEnabled: this.autoSlEnabled,
                autoTpEnabled: this.autoTpEnabled,
                defaultSlPct: this.defaultSlPct,
                defaultTpPct: this.defaultTpPct
            }))
        }
    }

    private loadSettings() {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('sltpBotSettings')
                if (saved) {
                    const data = JSON.parse(saved)
                    this.autoSlEnabled = data.autoSlEnabled !== false
                    this.autoTpEnabled = data.autoTpEnabled !== false
                    this.defaultSlPct = data.defaultSlPct || 2.0
                    this.defaultTpPct = data.defaultTpPct || 2.0
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            autoSlEnabled: this.autoSlEnabled,
            autoTpEnabled: this.autoTpEnabled,
            defaultSlPct: this.defaultSlPct,
            defaultTpPct: this.defaultTpPct
        }
    }
}

export const SLTPBotService = new SLTPBotServiceClass()
