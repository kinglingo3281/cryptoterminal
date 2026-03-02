/**
 * Trailing SL Bot Service
 * Monitors positions and moves stop-loss to breakeven when profit threshold is reached
 */
import * as hl from '@nktkas/hyperliquid'
import { toast } from 'sonner'

interface TrackedPosition {
    asset: string
    side: 'long' | 'short'
    entryPx: number
    size: number
    lastDecisionTime?: number
    lastActionTime?: number
    lastSlPrice?: number
    moveCount?: number
    lastProgressLogTime?: number
}

class TrailingSLBotServiceClass {
    private enabled = false
    private profitTriggerPct = 2.0
    private trailingMode: 'breakeven' | 'atr' | 'percent' = 'breakeven'
    private monitorInterval: NodeJS.Timeout | null = null
    private checkIntervalMs = 3000 // Check every 3 seconds
    private progressLogIntervalMs = 30000 // Log profit progress every 30s per asset
    private infoClient: hl.InfoClient
    private exchClient: hl.ExchangeClient | null = null
    private userAddress: string | null = null
    private trackedPositions = new Map<string, TrackedPosition>()
    private onLog: ((message: string, type: 'info' | 'success' | 'error') => void) | null = null
    private logToConsole = false
    
    // Rate limiting and throttling
    private globalMoveCount = 0
    private globalMoveCountResetAt = Date.now() + 60000
    private maxMovesPerMinute = 30
    private decisionThrottleMs = 5000 // Min time between decisions per asset
    private minStepPct = 0.05 // Minimum % change to move SL
    private trailingOffsetPct = 0.2 // % offset from entry for percent mode
    private minDistanceFromPricePct = 0.5
    private cooldownMsPerAsset = 10000
    private sizeMatchTolerance = 0.0001

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
            this.onLog(`[Trailing SL] ${message}`, type)
        }
        if (this.logToConsole) {
            console.log(`[Trailing SL] ${message}`)
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
    private globalPrices: Record<string, number> = {}

    updateGlobalData(data: { positions?: any[]; orders?: any[]; prices?: Record<string, number> }) {
        if (data.positions) this.globalPositions = data.positions
        if (data.orders) this.globalOrders = data.orders
        if (data.prices) this.globalPrices = data.prices
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
        this.trackedPositions.clear()
        this.log('Disabled', 'info')
        return true
    }

    isEnabled() {
        return this.enabled
    }

    updateSettings(settings: {
        profitTriggerPct?: number
        trailingMode?: 'breakeven' | 'atr' | 'percent'
        trailingOffsetPct?: number
        minStepPct?: number
        minDistanceFromPricePct?: number
        cooldownMsPerAsset?: number
        maxMovesPerMinute?: number
        decisionThrottleMs?: number
    }) {
        if (settings.profitTriggerPct !== undefined) {
            this.profitTriggerPct = settings.profitTriggerPct
        }
        if (settings.trailingMode !== undefined) {
            this.trailingMode = settings.trailingMode
        }
        if (settings.trailingOffsetPct !== undefined) {
            this.trailingOffsetPct = settings.trailingOffsetPct
        }
        if (settings.minStepPct !== undefined) {
            this.minStepPct = settings.minStepPct
        }
        if (settings.minDistanceFromPricePct !== undefined) {
            this.minDistanceFromPricePct = settings.minDistanceFromPricePct
        }
        if (settings.cooldownMsPerAsset !== undefined) {
            this.cooldownMsPerAsset = settings.cooldownMsPerAsset
        }
        if (settings.maxMovesPerMinute !== undefined) {
            this.maxMovesPerMinute = settings.maxMovesPerMinute
        }
        if (settings.decisionThrottleMs !== undefined) {
            this.decisionThrottleMs = settings.decisionThrottleMs
        }
        this.saveSettings()
        this.log(`Settings updated: ${this.profitTriggerPct}% trigger, mode=${this.trailingMode}`)
    }

    private startMonitoring() {
        if (this.monitorInterval) return
        this.log('Starting position monitoring')
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

    private async checkPositions() {
        if (!this.enabled || !this.exchClient || !this.userAddress) return

        // Reset global rate limit counter if needed
        const now = Date.now()
        if (now >= this.globalMoveCountResetAt) {
            this.globalMoveCount = 0
            this.globalMoveCountResetAt = now + 60000
        }

        // Check global rate limit
        if (this.globalMoveCount >= this.maxMovesPerMinute) {
            this.log(`Rate limited: ${this.globalMoveCount}/${this.maxMovesPerMinute} moves this minute`)
            return
        }

        try {
            // Use global positions from store (synced by BotProvider)
            // Fall back to API fetch if no global data
            let positions: Array<{ asset: string; side: 'long' | 'short'; entryPx: number; size: number }>
            
            if (this.globalPositions.length > 0) {
                positions = this.globalPositions.map((p: any) => ({
                    asset: p.coin as string,
                    side: (p.side === 'LONG' ? 'long' : 'short') as 'long' | 'short',
                    entryPx: p.entryPrice,
                    size: Math.abs(p.size)
                }))
            } else {
                // Fallback: fetch from API
                const clearinghouse = await this.infoClient.clearinghouseState({ user: this.userAddress })
                if (!clearinghouse?.assetPositions) return
                positions = clearinghouse.assetPositions
                    .filter((p: any) => parseFloat(p.position.szi) !== 0)
                    .map((p: any) => ({
                        asset: p.position.coin as string,
                        side: (parseFloat(p.position.szi) > 0 ? 'long' : 'short') as 'long' | 'short',
                        entryPx: parseFloat(p.position.entryPx),
                        size: Math.abs(parseFloat(p.position.szi))
                    }))
            }

            // Use global prices from store, fallback to API
            let allMids: Record<string, number | string>
            if (Object.keys(this.globalPrices).length > 0) {
                allMids = this.globalPrices
            } else {
                allMids = await this.infoClient.allMids()
            }

            let openOrders = this.globalOrders
            if ((!openOrders || openOrders.length === 0) && this.userAddress) {
                try {
                    openOrders = await this.infoClient.openOrders({ user: this.userAddress })
                } catch (error) {
                    this.log(`Failed to fetch open orders: ${(error as Error).message}`, 'error')
                    openOrders = this.globalOrders
                }
            }

            for (const pos of positions) {
                const rawPrice = allMids[pos.asset]
                const currentPrice = typeof rawPrice === 'number' 
                    ? rawPrice 
                    : parseFloat(String(rawPrice) || '0')
                if (!currentPrice) continue

                const tracked = this.getOrCreateTrackedPosition(pos)

                // Per-asset decision throttling
                if (tracked.lastDecisionTime) {
                    const timeSinceLastDecision = now - tracked.lastDecisionTime
                    if (timeSinceLastDecision < this.decisionThrottleMs) {
                        continue // Skip - too soon since last decision
                    }
                }
                tracked.lastDecisionTime = now

                // Calculate profit %
                const profitPct = pos.side === 'long'
                    ? ((currentPrice - pos.entryPx) / pos.entryPx) * 100
                    : ((pos.entryPx - currentPrice) / pos.entryPx) * 100

                // Log progress when in profit but below trigger (throttled)
                if (profitPct > 0 && profitPct < this.profitTriggerPct) {
                    if (!tracked.lastProgressLogTime || (now - tracked.lastProgressLogTime) >= this.progressLogIntervalMs) {
                        const remaining = this.profitTriggerPct - profitPct
                        this.log(`${pos.asset} +${profitPct.toFixed(2)}% (needs +${remaining.toFixed(2)}% to trigger)`, 'info')
                        tracked.lastProgressLogTime = now
                    }
                }

                // Check if profit threshold reached
                if (profitPct < this.profitTriggerPct) {
                    continue
                }

                this.log(`${pos.asset} reached ${profitPct.toFixed(2)}% profit (trigger: ${this.profitTriggerPct}%)`)

                const currentSL = this.findCurrentSL(pos, openOrders)
                if (!currentSL) {
                    this.log(`${pos.asset} has no SL order to modify - skipping`, 'info')
                    continue
                }

                const newSL = this.computeNewSL(pos)
                if (newSL === null || !isFinite(newSL) || newSL <= 0) {
                    continue
                }

                const isLong = pos.side === 'long'
                if (!this.isMoreProtective(newSL, currentSL.limitPx, isLong)) {
                    continue
                }

                if (!this.hasMinDistance(newSL, currentPrice, isLong, this.minDistanceFromPricePct)) {
                    continue
                }

                if (!this.hasMinStep(newSL, currentSL.limitPx, this.minStepPct)) {
                    continue
                }

                if (!this.isCooldownElapsed(tracked, this.cooldownMsPerAsset)) {
                    continue
                }

                const success = await this.modifyStopLoss(pos, currentSL, newSL)
                if (success) {
                    this.globalMoveCount++
                    tracked.lastActionTime = now
                    tracked.lastSlPrice = newSL
                    tracked.moveCount = (tracked.moveCount || 0) + 1
                    this.log(`Modified ${pos.asset} SL to $${newSL.toFixed(2)}`, 'success')
                    toast.info('Trailing SL moved', { description: `${pos.asset} → $${newSL.toFixed(2)}` })
                }
            }

            // Clean up tracked positions that are no longer open
            const openAssets = new Set(positions.map((p: any) => p.asset))
            for (const asset of this.trackedPositions.keys()) {
                if (!openAssets.has(asset)) {
                    this.trackedPositions.delete(asset)
                }
            }

        } catch (error) {
            this.log(`Error checking positions: ${(error as Error).message}`, 'error')
        }
    }

    private async modifyStopLoss(
        position: { asset: string; side: 'long' | 'short'; entryPx: number; size: number },
        currentSL: { oid: number; limitPx: number },
        newSL: number
    ): Promise<boolean> {
        if (!this.exchClient) return false

        try {
            // Get asset index (HIP-3 aware)
            const isHip3 = position.asset.includes(':')
            const dexParam = isHip3 ? position.asset.split(':')[0] : ''
            const meta = await (this.infoClient as any).meta(dexParam ? { dex: dexParam } : undefined)
            const assetMeta = meta.universe.find((a: any) => a.name === position.asset)
            if (!assetMeta) {
                this.log(`Asset ${position.asset} not found in ${dexParam || 'main'} metadata`, 'error')
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

            const sizeStr = String(Math.abs(position.size))
            const priceStr = String(newSL)
            const isBuy = position.side === 'short'

            const exchClient = this.exchClient as any
            if (typeof exchClient.batchModify !== 'function') {
                this.log('batchModify not available on ExchangeClient', 'error')
                return false
            }

            await exchClient.batchModify({
                modifies: [{
                    oid: Number(currentSL.oid),
                    order: {
                        a: assetIndex,
                        b: isBuy,
                        p: priceStr,
                        s: sizeStr,
                        r: true,
                        t: {
                            trigger: {
                                isMarket: true,
                                triggerPx: priceStr,
                                tpsl: 'sl'
                            }
                        }
                    }
                }]
            })

            return true
        } catch (error) {
            this.log(`Error moving SL for ${position.asset}: ${(error as Error).message}`, 'error')
            toast.error('Trailing SL move failed', { description: position.asset })
            return false
        }
    }

    private getOrCreateTrackedPosition(position: { asset: string; side: 'long' | 'short'; entryPx: number; size: number }): TrackedPosition {
        const existing = this.trackedPositions.get(position.asset)
        if (existing) {
            existing.side = position.side
            existing.entryPx = position.entryPx
            existing.size = position.size
            return existing
        }

        const tracked: TrackedPosition = {
            asset: position.asset,
            side: position.side,
            entryPx: position.entryPx,
            size: position.size,
            moveCount: 0
        }
        this.trackedPositions.set(position.asset, tracked)
        return tracked
    }

    private findCurrentSL(
        position: { asset: string; side: 'long' | 'short'; entryPx: number; size: number },
        openOrders: any[]
    ): { oid: number; limitPx: number } | null {
        if (!openOrders || openOrders.length === 0) return null

        const isLong = position.side === 'long'
        const tpslOrders = openOrders.filter(order => {
            if (order.coin !== position.asset) return false
            if (!(order.reduceOnly || order.isPositionTpsl)) return false

            const orderSize = Math.abs(parseFloat(order.size ?? order.sz ?? 0))
            return this.sizesMatch(position.size, orderSize)
        })

        if (tpslOrders.length === 0) return null

        let slOrder: any = null
        for (const order of tpslOrders) {
            const orderPrice = parseFloat(order.limitPx)
            if (!orderPrice || isNaN(orderPrice)) continue

            const isProfitable = isLong ? orderPrice > position.entryPx : orderPrice < position.entryPx
            if (!isProfitable) {
                if (!slOrder) {
                    slOrder = order
                } else if (isLong ? orderPrice > slOrder.limitPx : orderPrice < slOrder.limitPx) {
                    slOrder = order
                }
            }
        }

        if (!slOrder) return null
        return { oid: Number(slOrder.oid), limitPx: parseFloat(slOrder.limitPx) }
    }

    private computeNewSL(position: { side: 'long' | 'short'; entryPx: number }): number | null {
        const isLong = position.side === 'long'
        if (this.trailingMode === 'breakeven') {
            return position.entryPx
        }

        if (this.trailingMode === 'percent') {
            const offset = position.entryPx * (this.trailingOffsetPct / 100)
            return isLong ? position.entryPx + offset : position.entryPx - offset
        }

        // ATR mode not supported in minimal parity - default to breakeven
        return position.entryPx
    }

    private sizesMatch(positionSize: number, orderSize: number): boolean {
        return Math.abs(Math.abs(positionSize) - Math.abs(orderSize)) < this.sizeMatchTolerance
    }

    private isMoreProtective(newSL: number, currentSL: number, isLong: boolean): boolean {
        if (!currentSL || isNaN(currentSL)) return true
        return isLong ? newSL >= currentSL : newSL <= currentSL
    }

    private hasMinDistance(newSL: number, currentPrice: number, isLong: boolean, minDistancePct: number): boolean {
        const minDistance = currentPrice * (minDistancePct / 100)
        return isLong ? (currentPrice - newSL) >= minDistance : (newSL - currentPrice) >= minDistance
    }

    private hasMinStep(newSL: number, currentSL: number, minStepPct: number): boolean {
        if (!currentSL || isNaN(currentSL)) return true
        const stepPct = Math.abs(newSL - currentSL) / currentSL * 100
        return stepPct >= minStepPct
    }

    private isCooldownElapsed(tracked: TrackedPosition, cooldownMs: number): boolean {
        if (!tracked.lastActionTime) return true
        return Date.now() - tracked.lastActionTime >= cooldownMs
    }

    private saveSettings() {
        if (typeof window !== 'undefined') {
            localStorage.setItem('trailingSLSettings', JSON.stringify({
                enabled: this.enabled,
                profitTriggerPct: this.profitTriggerPct,
                trailingMode: this.trailingMode,
                trailingOffsetPct: this.trailingOffsetPct,
                minStepPct: this.minStepPct,
                minDistanceFromPricePct: this.minDistanceFromPricePct,
                cooldownMsPerAsset: this.cooldownMsPerAsset,
                maxMovesPerMinute: this.maxMovesPerMinute,
                decisionThrottleMs: this.decisionThrottleMs
            }))
        }
    }

    private loadSettings() {
        if (typeof window !== 'undefined') {
            try {
                const saved = localStorage.getItem('trailingSLSettings')
                if (saved) {
                    const data = JSON.parse(saved)
                    this.profitTriggerPct = data.profitTriggerPct || 2.0
                    this.trailingMode = data.trailingMode || 'breakeven'
                    if (data.trailingOffsetPct !== undefined) this.trailingOffsetPct = data.trailingOffsetPct
                    if (data.minStepPct !== undefined) this.minStepPct = data.minStepPct
                    if (data.minDistanceFromPricePct !== undefined) this.minDistanceFromPricePct = data.minDistanceFromPricePct
                    if (data.cooldownMsPerAsset !== undefined) this.cooldownMsPerAsset = data.cooldownMsPerAsset
                    if (data.maxMovesPerMinute !== undefined) this.maxMovesPerMinute = data.maxMovesPerMinute
                    if (data.decisionThrottleMs !== undefined) this.decisionThrottleMs = data.decisionThrottleMs
                }
            } catch (e) {
                // Ignore
            }
        }
    }

    getStatus() {
        return {
            enabled: this.enabled,
            profitTriggerPct: this.profitTriggerPct,
            trailingMode: this.trailingMode,
            trailingOffsetPct: this.trailingOffsetPct,
            minStepPct: this.minStepPct,
            minDistanceFromPricePct: this.minDistanceFromPricePct,
            cooldownMsPerAsset: this.cooldownMsPerAsset,
            maxMovesPerMinute: this.maxMovesPerMinute,
            decisionThrottleMs: this.decisionThrottleMs,
            trackedPositions: this.trackedPositions.size
        }
    }
}

export const TrailingSLBotService = new TrailingSLBotServiceClass()
