import { hyperliquid } from './hyperliquid'

type ATRData = {
    atr: number
    atrPct: number
    price: number
    timestamp: number
}

type TPSLResult = {
    tp: number
    sl: number
    atr: number | null
    atrPct: number | null
    isFallback: boolean
}

const LOG_ATR = false

const log = (...args: unknown[]) => {
    if (LOG_ATR) {
        console.log(...args)
    }
}

const logWarn = (...args: unknown[]) => {
    if (LOG_ATR) {
        console.warn(...args)
    }
}

const logError = (...args: unknown[]) => {
    if (LOG_ATR) {
        console.error(...args)
    }
}

export class ATRService {
    private cache: Map<string, ATRData>
    private TTL: number
    private period: number
    private tpMultiplier: number
    private slMultiplier: number
    private loading: Map<string, boolean>

    constructor() {
        this.cache = new Map()
        this.TTL = 60 * 60 * 1000
        this.period = 14
        this.tpMultiplier = 2.0
        this.slMultiplier = 1.5
        this.loading = new Map()
        log('[ATRService] Initialized')
    }

    async getATR(asset: string): Promise<ATRData | null> {
        if (!asset) return null

        const cached = this.cache.get(asset)
        if (cached && (Date.now() - cached.timestamp) < this.TTL) {
            return cached
        }

        if (this.loading.get(asset)) {
            await new Promise(resolve => setTimeout(resolve, 100))
            return this.cache.get(asset) || null
        }

        this.loading.set(asset, true)

        try {
            const endTime = Date.now()
            const startTime = endTime - (20 * 60 * 60 * 1000)

            const candles = await hyperliquid.getHistoricalCandles(
                asset,
                '1h',
                startTime,
                endTime
            )

            if (!candles || candles.length < this.period) {
                logWarn(`[ATRService] Insufficient candles for ${asset}: ${candles?.length || 0}`)
                return null
            }

            const atr = this.calculateATR(candles)

            const currentPrice = parseFloat(candles[candles.length - 1]?.c || candles[candles.length - 1]?.close || '0')

            if (!currentPrice || currentPrice <= 0) {
                logWarn(`[ATRService] Invalid price for ${asset}`)
                return null
            }

            const atrPct = (atr / currentPrice) * 100

            const result: ATRData = {
                atr,
                atrPct,
                price: currentPrice,
                timestamp: Date.now()
            }

            this.cache.set(asset, result)

            log(`[ATRService] ${asset}: ATR=${atr.toFixed(4)}, ATR%=${atrPct.toFixed(2)}%, Price=${currentPrice}`)

            return result

        } catch (error) {
            logError(`[ATRService] Error fetching ATR for ${asset}:`, error)
            return null
        } finally {
            this.loading.set(asset, false)
        }
    }

    calculateATR(candles: any[], period: number = this.period): number {
        if (candles.length < period) {
            return 0
        }

        const trueRanges: number[] = []

        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i]
            const high = parseFloat(candle.h || candle.high)
            const low = parseFloat(candle.l || candle.low)
            const close = parseFloat(candle.c || candle.close)

            if (i === 0) {
                trueRanges.push(high - low)
            } else {
                const prevClose = parseFloat(candles[i - 1].c || candles[i - 1].close)
                const tr = Math.max(
                    high - low,
                    Math.abs(high - prevClose),
                    Math.abs(low - prevClose)
                )
                trueRanges.push(tr)
            }
        }

        const recentTR = trueRanges.slice(-period)
        const atr = recentTR.reduce((sum, tr) => sum + tr, 0) / period

        return atr
    }

    calculateTP(entryPrice: number, atr: number, isLong: boolean): number {
        const offset = atr * this.tpMultiplier
        return isLong ? entryPrice + offset : entryPrice - offset
    }

    calculateSL(entryPrice: number, atr: number, isLong: boolean): number {
        const offset = atr * this.slMultiplier
        return isLong ? entryPrice - offset : entryPrice + offset
    }

    async getTPSL(asset: string, entryPrice: number, isLong: boolean): Promise<TPSLResult> {
        const atrData = await this.getATR(asset)

        if (!atrData || !atrData.atr) {
            console.warn(`[ATRService] Using fallback 2% for ${asset}`)
            const fallbackPct = 0.02
            return {
                tp: isLong ? entryPrice * (1 + fallbackPct) : entryPrice * (1 - fallbackPct),
                sl: isLong ? entryPrice * (1 - fallbackPct) : entryPrice * (1 + fallbackPct),
                atr: null,
                atrPct: null,
                isFallback: true
            }
        }

        const { atr, atrPct } = atrData

        return {
            tp: this.calculateTP(entryPrice, atr, isLong),
            sl: this.calculateSL(entryPrice, atr, isLong),
            atr,
            atrPct,
            isFallback: false
        }
    }

    roundPrice(price: number, referencePrice: number | null = null): number {
        const ref = referencePrice || price
        let decimals: number

        if (ref >= 10000) decimals = 1
        else if (ref >= 1000) decimals = 2
        else if (ref >= 100) decimals = 3
        else if (ref >= 10) decimals = 4
        else if (ref >= 1) decimals = 5
        else decimals = 6

        return parseFloat(price.toFixed(decimals))
    }

    async getTPSLRounded(asset: string, entryPrice: number, isLong: boolean): Promise<TPSLResult> {
        const result = await this.getTPSL(asset, entryPrice, isLong)

        return {
            ...result,
            tp: this.roundPrice(result.tp, entryPrice),
            sl: this.roundPrice(result.sl, entryPrice)
        }
    }

    getCachedATR(asset: string): ATRData | null {
        const cached = this.cache.get(asset)
        if (cached && (Date.now() - cached.timestamp) < this.TTL) {
            return cached
        }
        return null
    }

    getTPSLSync(asset: string, entryPrice: number, isLong: boolean): TPSLResult {
        const cached = this.getCachedATR(asset)

        if (cached && cached.atr) {
            const tp = this.roundPrice(this.calculateTP(entryPrice, cached.atr, isLong), entryPrice)
            const sl = this.roundPrice(this.calculateSL(entryPrice, cached.atr, isLong), entryPrice)
            return { tp, sl, atr: cached.atr, atrPct: cached.atrPct, isFallback: false }
        }

        const fallbackPct = 0.02
        const tp = isLong ? entryPrice * (1 + fallbackPct) : entryPrice * (1 - fallbackPct)
        const sl = isLong ? entryPrice * (1 - fallbackPct) : entryPrice * (1 + fallbackPct)
        return {
            tp: this.roundPrice(tp, entryPrice),
            sl: this.roundPrice(sl, entryPrice),
            atr: null,
            atrPct: null,
            isFallback: true
        }
    }

    invalidateCache(asset?: string): void {
        if (asset) {
            this.cache.delete(asset)
        } else {
            this.cache.clear()
        }
    }

    setMultipliers(tpMultiplier: number, slMultiplier: number): void {
        if (tpMultiplier > 0) this.tpMultiplier = tpMultiplier
        if (slMultiplier > 0) this.slMultiplier = slMultiplier
        console.log(`[ATRService] Multipliers updated: TP=${this.tpMultiplier}x, SL=${this.slMultiplier}x`)
    }

    getStats() {
        const stats = {
            cachedAssets: this.cache.size,
            entries: [] as Array<{ asset: string; atr: number; atrPct: number; age: string }>
        }

        for (const [asset, data] of this.cache.entries()) {
            stats.entries.push({
                asset,
                atr: data.atr,
                atrPct: data.atrPct,
                age: Math.round((Date.now() - data.timestamp) / 60000) + ' min'
            })
        }

        return stats
    }
}

export const atrService = new ATRService()
