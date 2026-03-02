import { InfoClient, HttpTransport, WebSocketTransport, ExchangeClient, SubscriptionClient } from '@nktkas/hyperliquid';
import { ethers } from 'ethers';
import { DualNodeClient } from './DualNodeClient';

export type CandleInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

export class HyperliquidUtils {
    static roundToTickSize(price: number, szDecimals: number = 4): number {
        if (!price) return 0;
        const maxDecimals = 6;
        const priceDecimals = maxDecimals - szDecimals;
        const significantFigures = 5;
        const magnitude = Math.floor(Math.log10(Math.abs(price)));
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1));
        const multiplier = Math.pow(10, maxDecimalPlaces);
        return Math.round(price * multiplier) / multiplier;
    }

    static roundToSizeDecimals(size: number, szDecimals: number = 4): number {
        if (!size) return 0;
        return parseFloat(size.toFixed(szDecimals));
    }
}

export class HyperliquidServiceV2 {
    private static instance: HyperliquidServiceV2;
    private dualNodeClient: DualNodeClient;
    private exchangeClient: ExchangeClient | null = null;
    private subscriptionClient: SubscriptionClient | null = null;
    private wsTransport: WebSocketTransport | null = null;
    private meta: any = null;
    private assetMap: Map<string, number> = new Map();
    private assetMetadataCache: Map<string, { szDecimals: number; priceDecimals: number }> = new Map();
    private statusListeners: Array<(isUsingFallback: boolean) => void> = [];

    private constructor() {
        this.dualNodeClient = DualNodeClient.getInstance();
        
        // Initialize with default nodes (can be overridden with initialize())
        this.initialize([
            { url: process.env.NEXT_PUBLIC_PRIVATE_NODE_URL || 'http://localhost:3001', isPrivate: true },
            { url: process.env.NEXT_PUBLIC_PUBLIC_NODE_URL || 'https://api.hyperliquid.xyz', isPrivate: false }
        ]);
    }

    public static getInstance(): HyperliquidServiceV2 {
        if (!HyperliquidServiceV2.instance) {
            HyperliquidServiceV2.instance = new HyperliquidServiceV2();
        }
        return HyperliquidServiceV2.instance;
    }

    public async initialize(nodes: Array<{ url: string; isPrivate: boolean }>) {
        await this.dualNodeClient.initialize(nodes);
        
        // Set up status change listener
        this.dualNodeClient.onStatusChange((isUsingFallback) => {
            console.log(`[HyperliquidService] Node status changed: ${isUsingFallback ? 'Using fallback' : 'Using primary'}`);
            this.statusListeners.forEach(listener => listener(isUsingFallback));
        });
        
        // Initial metadata load
        await this.loadMetadata();
    }

    public onStatusChange(listener: (isUsingFallback: boolean) => void) {
        this.statusListeners.push(listener);
        return () => {
            this.statusListeners = this.statusListeners.filter(l => l !== listener);
        };
    }

    public isUsingFallback(): boolean {
        const activeNode = this.dualNodeClient.getActiveNode();
        return activeNode ? !activeNode.config.isPrivate : true;
    }

    public async connect(privateKey: string) {
        try {
            this.exchangeClient = await this.dualNodeClient.getExchangeClient(privateKey);
            this.subscriptionClient = await this.dualNodeClient.getSubscriptionClient();
            await this.loadMetadata();
            return true;
        } catch (e) {
            console.error("Failed to connect:", e);
            return false;
        }
    }

    public async loadMetadata() {
        try {
            const infoClient = await this.dualNodeClient.getInfoClient();
            this.meta = await infoClient.meta();
            
            this.meta.universe.forEach((asset: any, index: number) => {
                this.assetMap.set(asset.name, index);
                const szDecimals = parseInt(asset.szDecimals) || 4;
                this.assetMetadataCache.set(asset.name, {
                    szDecimals,
                    priceDecimals: 6 - szDecimals
                });
            });
            
            console.log(`[HyperliquidService] Loaded metadata for ${this.meta.universe.length} assets`);
            return this.meta;
        } catch (error) {
            console.error("[HyperliquidService] Failed to load metadata:", error);
            throw error;
        }
    }

    // ... [Previous methods like getMarketData, getAssetMetadata, etc.]
    
    public async getMarketData() {
        const infoClient = await this.dualNodeClient.getInfoClient();
        return infoClient.allMids();
    }

    public async getAssetMetadata() {
        if (!this.meta) {
            await this.loadMetadata();
        }
        
        const mids = await this.getMarketData();
        
        return this.meta.universe.map((asset: any, index: number) => {
            const price = parseFloat(mids[index]);
            const szDecimals = parseInt(asset.szDecimals) || 4;
            
            return {
                name: asset.name,
                price,
                priceChange24h: 0, // Not available directly, would need historical data
                volume24h: 0,     // Not available directly
                isDelisted: asset.isDelisted || false,
                szDecimals,
                priceDecimals: 6 - szDecimals
            };
        });
    }

    public async getHistoricalCandles(
        symbol: string,
        interval: CandleInterval,
        startTime?: number,
        endTime?: number,
        limit: number = 1000
    ) {
        const infoClient = await this.dualNodeClient.getInfoClient();
        
        // Ensure interval is valid candleSnapshot format
        const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M'];
        const candleInterval = validIntervals.includes(interval) ? interval : '1m';
        
        try {
            const candles = await infoClient.candleSnapshot({
                coin: symbol,
                interval: candleInterval as any,
                startTime: startTime || Date.now() - 86400000,
                endTime: endTime
            });

            return candles.map((candle: any) => ({
                time: candle.t * 1000, // Convert to milliseconds
                open: parseFloat(candle.o),
                high: parseFloat(candle.h),
                low: parseFloat(candle.l),
                close: parseFloat(candle.c),
                volume: parseFloat(candle.v)
            }));
        } catch (error) {
            console.error(`[HyperliquidService] Error fetching candles for ${symbol}:`, error);
            throw error;
        }
    }

    public async getAssetDecimals(symbol: string) {
        if (this.assetMetadataCache.has(symbol)) {
            return this.assetMetadataCache.get(symbol)!;
        }
        
        // If not in cache, load metadata and try again
        await this.loadMetadata();
        return this.assetMetadataCache.get(symbol) || { szDecimals: 4, priceDecimals: 2 };
    }

    public async formatPrice(price: number, symbol: string): Promise<string> {
        const { priceDecimals } = await this.getAssetDecimals(symbol);
        const rounded = HyperliquidUtils.roundToTickSize(price, 6 - priceDecimals);
        
        // Apply 5 significant figures rule
        const significantFigures = 5;
        const magnitude = Math.floor(Math.log10(Math.abs(rounded)));
        const maxDecimalPlaces = Math.max(0, significantFigures - magnitude - 1);
        
        return rounded.toFixed(Math.min(priceDecimals, maxDecimalPlaces));
    }

    public async formatSize(size: number, symbol: string): Promise<string> {
        const { szDecimals } = await this.getAssetDecimals(symbol);
        const rounded = HyperliquidUtils.roundToSizeDecimals(size, szDecimals);
        return rounded.toFixed(szDecimals);
    }
}

export const hyperliquidV2 = HyperliquidServiceV2.getInstance();
