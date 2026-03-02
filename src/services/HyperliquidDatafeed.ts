import { hyperliquid, CandleInterval } from './hyperliquid';

interface SymbolInfo {
    ticker: string;
    name: string;
    exchange: string;
    type?: string;
    pricePrecision?: number;
    volumePrecision?: number;
}

interface Period {
    multiplier: number;
    timespan: string;
    text: string;
}

interface KLineData {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
}

type DatafeedSubscribeCallback = (data: KLineData) => void;

export class HyperliquidDatafeed {
    private subscriptions: Map<string, any> = new Map();
    private currentSymbol: string = '';
    private currentPeriod: string = '';

    constructor() {
        console.log('[🏗️ DATAFEED] Constructor called - Datafeed instance created');
    }

    /**
     * Search symbols for symbol picker
     */
    /**
     * Calculate appropriate price precision based on price magnitude
     * For low-priced assets, we need more decimal places
     */
    private calculatePricePrecision(price: number): number {
        if (price <= 0) return 2;
        if (price < 0.0001) return 8;
        if (price < 0.001) return 7;
        if (price < 0.01) return 6;
        if (price < 0.1) return 5;
        if (price < 1) return 4;
        if (price < 10) return 3;
        if (price < 100) return 2;
        return 2;
    }

    async searchSymbols(search?: string): Promise<SymbolInfo[]> {
        console.log('[🔍 DATAFEED] searchSymbols called with:', search);
        try {
            await hyperliquid.initWebSocket();
            const assets = await hyperliquid.getAllAssets();
            
            return assets
                .filter(a => !search || 
                    a.name.toUpperCase().includes(search.toUpperCase()) ||
                    a.displayName.toUpperCase().includes(search.toUpperCase())
                )
                .map(a => ({
                    ticker: a.name,
                    name: a.displayName,
                    exchange: 'Hyperliquid',
                    type: a.category === 'equities' ? 'stock' : 'crypto',
                    pricePrecision: 4,
                    volumePrecision: 2
                }));
        } catch (error) {
            console.error('[HyperliquidDatafeed] Error searching symbols:', error);
            return [];
        }
    }

    /**
     * Get historical candle data for initial chart load
     */
    async getHistoryKLineData(
        symbol: SymbolInfo,
        period: Period,
        from: number,
        to: number
    ): Promise<KLineData[]> {
        try {
            const interval = this.convertPeriod(period);
            console.log(`[📊 DATAFEED] Fetching history for ${symbol.ticker} ${interval} (${period.text})`);
            
            // Track current symbol/period to prevent race conditions
            this.currentSymbol = symbol.ticker;
            this.currentPeriod = interval;
            
            const candles = await hyperliquid.getHistoricalCandles(
                symbol.ticker,
                interval,
                from,
                to
            );

            const klineData = candles.map(c => ({
                timestamp: c.t,
                open: parseFloat(c.o),
                high: parseFloat(c.h),
                low: parseFloat(c.l),
                close: parseFloat(c.c),
                volume: parseFloat(c.v || '0')
            }));
            
            // Dynamically set price precision based on actual price data
            if (klineData.length > 0) {
                const lastPrice = klineData[klineData.length - 1].close;
                symbol.pricePrecision = this.calculatePricePrecision(lastPrice);
                console.log(`[📊 DATAFEED] Set pricePrecision to ${symbol.pricePrecision} for price $${lastPrice}`);
            }
            
            console.log(`[✅ DATAFEED] Loaded ${klineData.length} candles for ${symbol.ticker} ${interval}`);
            return klineData;
        } catch (error) {
            console.error('[HyperliquidDatafeed] Error fetching history:', error);
            return [];
        }
    }

    /**
     * Subscribe to real-time candle updates
     */
    subscribe(
        symbol: SymbolInfo,
        period: Period,
        callback: (data: KLineData) => void
    ): void {
        try {
            const interval = this.convertPeriod(period);
            const key = `${symbol.ticker}_${interval}`;
            console.log(`[🔔 DATAFEED] Subscribing to ${symbol.ticker} ${interval} (${period.text})`);

            // Subscribe to real-time candle updates from Hyperliquid
            const unsubscribe = hyperliquid.subscribeToCandles(
                symbol.ticker,
                interval,
                (data: any) => {
                    // Prevent race condition: ignore updates if symbol/period has changed
                    if (symbol.ticker !== this.currentSymbol || interval !== this.currentPeriod) {
                        console.log(`[🚫 DATAFEED] Ignoring stale update for ${symbol.ticker} ${interval} (current: ${this.currentSymbol} ${this.currentPeriod})`);
                        return;
                    }
                    
                    callback({
                        timestamp: data.t,
                        open: parseFloat(data.o),
                        high: parseFloat(data.h),
                        low: parseFloat(data.l),
                        close: parseFloat(data.c),
                        volume: parseFloat(data.v || '0')
                    });
                }
            );

            this.subscriptions.set(key, unsubscribe);
        } catch (error) {
            console.error('[HyperliquidDatafeed] Error subscribing:', error);
        }
    }

    /**
     * Unsubscribe from real-time updates
     */
    unsubscribe(symbol: SymbolInfo, period: Period): void {
        try {
            const interval = this.convertPeriod(period);
            const key = `${symbol.ticker}_${interval}`;
            console.log(`[🔕 DATAFEED] Unsubscribing from ${symbol.ticker} ${interval} (${period.text})`);
            
            const unsubscribe = this.subscriptions.get(key);
            if (unsubscribe && typeof unsubscribe === 'function') {
                unsubscribe();
                this.subscriptions.delete(key);
            }
        } catch (error) {
            console.error('[HyperliquidDatafeed] Error unsubscribing:', error);
        }
    }

    /**
     * Convert KLineChart period format to Hyperliquid interval
     */
    private convertPeriod(period: Period): CandleInterval {
        const { multiplier, timespan } = period;
        
        const timespanStr = typeof timespan === 'string' ? timespan : 'minute';
        
        if (timespanStr === 'minute') return `${multiplier}m` as CandleInterval;
        if (timespanStr === 'hour') return `${multiplier}h` as CandleInterval;
        if (timespanStr === 'day') return `${multiplier}d` as CandleInterval;
        if (timespanStr === 'week') return `${multiplier}w` as CandleInterval;
        if (timespanStr === 'month') return `${multiplier}M` as CandleInterval;
        
        return '15m';
    }
}
