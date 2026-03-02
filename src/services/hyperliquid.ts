import * as hl from '@nktkas/hyperliquid';
import { ethers } from 'ethers';

// Valid candle intervals for Hyperliquid
export type CandleInterval = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';

// Hardcoded szDecimals for common assets (avoids wrong fallback before metadata loads)
const KNOWN_SZ_DECIMALS: Record<string, number> = {
    'BTC': 5, 'ETH': 4, 'SOL': 2, 'DOGE': 0,
    'XRP': 1, 'ADA': 0, 'AVAX': 2, 'DOT': 1,
    'LINK': 2, 'MATIC': 0, 'UNI': 2, 'AAVE': 3,
    'ARB': 1, 'OP': 1, 'SUI': 1, 'APT': 2,
    'NEAR': 1, 'FTM': 0, 'ATOM': 2, 'INJ': 2,
    'TIA': 1, 'SEI': 0, 'WIF': 1, 'PEPE': 0,
    'BONK': 0, 'RENDER': 1, 'FET': 0, 'JUP': 0,
    'WLD': 1, 'STX': 0, 'IMX': 0, 'MANTA': 0,
};

// Helper for tick/size rounding (from legacy code)
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

export interface UnifiedAsset {
    name: string           // Internal symbol: "BTC" | "xyz:AAPL" | "@230"
    coin: string           // API-facing symbol for subscriptions: "BTC" | "xyz:AAPL" | "@230" | "PURR/USDC"
    displayName: string    // Display: "BTC" | "AAPL" | "USDH/USDC"
    category: 'perps' | 'equities' | 'spot'
    price: number
    change24h: number
    volume24h: number
    openInterest: number
    maxLeverage: number
    szDecimals: number
    quoteToken?: string    // Spot only: quote token name (e.g., "USDC", "USDH")
    baseToken?: string     // Spot only: base token name (e.g., "HYPE", "SILVER")
}

export class HyperliquidService {
    private transport: hl.HttpTransport;
    private infoClient: hl.InfoClient;
    private exchClient: hl.ExchangeClient | null = null;
    private wsTransport: hl.WebSocketTransport | null = null;
    private subClient: hl.SubscriptionClient | null = null;

    // Cache
    private meta: any = null;
    private assetMap: Map<string, number> = new Map(); // Symbol -> Index
    private assetMetadataCache: Map<string, { szDecimals: number; priceDecimals: number }> = new Map();

    // getAllAssets cache (24h TTL)
    private allAssetsCache: UnifiedAsset[] | null = null;
    private allAssetsCacheTime: number = 0;
    private allAssetsFetching: Promise<UnifiedAsset[]> | null = null;
    private readonly ALL_ASSETS_TTL = 24 * 60 * 60 * 1000; // 24 hours

    constructor() {
        this.transport = new hl.HttpTransport({ isTestnet: false });
        this.infoClient = new hl.InfoClient({ transport: this.transport });
    }

    async connect(privateKey: string) {
        try {
            const wallet = new ethers.Wallet(privateKey);
            this.exchClient = new hl.ExchangeClient({
                wallet: wallet,
                transport: this.transport
            });

            // Init WebSocket
            this.wsTransport = new hl.WebSocketTransport({ isTestnet: false });
            this.subClient = new hl.SubscriptionClient({ transport: this.wsTransport });

            await this.loadMetadata();
            return true;
        } catch (e) {
            console.error("Failed to connect:", e);
            return false;
        }
    }

    async loadMetadata() {
        this.meta = await this.infoClient.meta();
        this.meta.universe.forEach((asset: any, index: number) => {
            this.assetMap.set(asset.name, index);
            // Cache szDecimals for formatting
            const szDecimals = parseInt(asset.szDecimals) || 4;
            this.assetMetadataCache.set(asset.name, {
                szDecimals: szDecimals,
                priceDecimals: 6 - szDecimals // Hyperliquid uses MAX_DECIMALS = 6 for perps
            });
        });
        console.log(`[HL Service] Cached ${this.meta.universe.length} main DEX assets`);
        
        // Also load HIP-3 DEX metadata
        try {
            const dexs = await (this.infoClient as any).perpDexs();
            const hip3Dexs = (dexs || []).filter((d: any) => d !== null && d?.name);
            for (const dex of hip3Dexs) {
                try {
                    const dexMeta = await this.infoClient.meta({ dex: dex.name } as any);
                    if (dexMeta?.universe) {
                        dexMeta.universe.forEach((asset: any, index: number) => {
                            const fullName = asset.name.includes(':') ? asset.name : `${dex.name}:${asset.name}`;
                            this.assetMap.set(fullName, index);
                            const szDecimals = parseInt(asset.szDecimals) || 4;
                            this.assetMetadataCache.set(fullName, {
                                szDecimals: szDecimals,
                                priceDecimals: 6 - szDecimals
                            });
                        });
                        console.log(`[HL Service] Cached ${dexMeta.universe.length} ${dex.name} HIP-3 assets`);
                    }
                } catch (dexErr) {
                    console.warn(`[HL Service] Failed to load ${dex.name} HIP-3 meta:`, dexErr);
                }
            }
        } catch (e) {
            console.warn('[HL Service] Failed to load HIP-3 DEX list:', e);
        }
    }

    // Initialize WebSocket for read-only subscriptions (no private key needed)
    async initWebSocket() {
        if (this.subClient) return; // Already initialized
        try {
            this.wsTransport = new hl.WebSocketTransport({ isTestnet: false });
            this.subClient = new hl.SubscriptionClient({ transport: this.wsTransport });
            console.log("[Hyperliquid] WebSocket initialized");
        } catch (e) {
            console.error("[Hyperliquid] Failed to init WebSocket:", e);
        }
    }

    async getMarketData() {
        return await this.infoClient.allMids();
    }

    /**
     * Get all tradable assets with live price data
     * Combines meta() for asset info and allMids() for current prices
     */
    async getAssetMetadata(): Promise<{
        name: string;
        price: number;
        maxLeverage: number;
        szDecimals: number;
        isDelisted: boolean;
    }[]> {
        try {
            // Fetch metadata and prices in parallel
            const [meta, allMids] = await Promise.all([
                this.infoClient.meta(),
                this.infoClient.allMids()
            ]);

            // Cache metadata
            this.meta = meta;
            this.meta.universe.forEach((asset: any, index: number) => {
                this.assetMap.set(asset.name, index);
                // Cache szDecimals for formatting
                const szDecimals = parseInt(asset.szDecimals) || 4;
                this.assetMetadataCache.set(asset.name, {
                    szDecimals: szDecimals,
                    priceDecimals: 6 - szDecimals
                });
            });

            // Combine metadata with prices
            const assets = meta.universe
                .filter((asset: any) => !asset.isDelisted)
                .map((asset: any) => ({
                    name: asset.name,
                    price: parseFloat(allMids[asset.name]) || 0,
                    maxLeverage: asset.maxLeverage || 20,
                    szDecimals: asset.szDecimals || 4,
                    isDelisted: asset.isDelisted || false
                }));

            console.log(`[Hyperliquid] Loaded ${assets.length} assets`);
            return assets;
        } catch (error) {
            console.error("[Hyperliquid] Failed to get asset metadata:", error);
            throw error;
        }
    }

    /**
     * Look up display name from cached assets (sync — returns clean fallback if not cached yet)
     */
    getAssetDisplayName(assetName: string): string {
        if (this.allAssetsCache) {
            const found = this.allAssetsCache.find(a => a.name === assetName)
            if (found) return found.displayName
        }
        // Don't return raw @230 — provide a clean fallback
        if (assetName.startsWith('@')) return `Spot #${assetName.substring(1)}`
        if (assetName.includes(':')) return assetName.split(':')[1] || assetName
        return assetName
    }

    /**
     * Async version that ensures cache is warm before resolving
     */
    async getAssetDisplayNameAsync(assetName: string): Promise<string> {
        if (!this.allAssetsCache) {
            try { await this.getAllAssets() } catch (_) {}
        }
        return this.getAssetDisplayName(assetName)
    }

    /**
     * Look up API-facing coin symbol from cached assets (for subscriptions: L2, candles, trades)
     */
    getAssetCoin(assetName: string): string {
        if (this.allAssetsCache) {
            const found = this.allAssetsCache.find(a => a.name === assetName)
            if (found) return found.coin
        }
        // Fallback: for perps/HIP-3 the coin is the same as the name
        return assetName
    }

    /**
     * Prefetch asset list on app init so modal opens instantly
     */
    prefetchAssets(): void {
        this.getAllAssets().catch(() => {})
    }

    /**
     * Get ALL tradable assets: perps + HIP-3 equities + spot
     * Uses metaAndAssetCtxs for real market data (price, volume, OI, 24h change)
     * Results are cached for 24h. Subsequent calls return instantly from cache.
     */
    async getAllAssets(): Promise<UnifiedAsset[]> {
        // Return from cache if fresh
        if (this.allAssetsCache && (Date.now() - this.allAssetsCacheTime) < this.ALL_ASSETS_TTL) {
            return this.allAssetsCache
        }

        // Deduplicate concurrent fetches
        if (this.allAssetsFetching) {
            return this.allAssetsFetching
        }

        this.allAssetsFetching = this._fetchAllAssets()
        try {
            const result = await this.allAssetsFetching
            this.allAssetsCache = result
            this.allAssetsCacheTime = Date.now()
            return result
        } finally {
            this.allAssetsFetching = null
        }
    }

    private async _fetchAllAssets(): Promise<UnifiedAsset[]> {
        try {
            const allAssets: UnifiedAsset[] = []

            // 1. Get all DEXs (null = main, others = HIP-3)
            const dexs: any[] = await (this.infoClient as any).perpDexs()

            // 2. Fetch metaAndAssetCtxs for each DEX in parallel
            const dexPromises = dexs.map(async (dex: any) => {
                const dexName = dex === null ? '' : dex.name
                try {
                    const result = await (this.infoClient as any).metaAndAssetCtxs(
                        dexName ? { dex: dexName } : undefined
                    )
                    return { dexName, meta: result[0], ctxs: result[1] }
                } catch (e) {
                    console.warn(`[Hyperliquid] Failed to fetch DEX ${dexName || 'main'}:`, e)
                    return null
                }
            })

            const dexResults = (await Promise.all(dexPromises)).filter(Boolean) as any[]

            for (const { dexName, meta, ctxs } of dexResults) {
                const isMainDex = !dexName

                // Cache main DEX metadata
                if (isMainDex) {
                    this.meta = meta
                    meta.universe.forEach((asset: any, index: number) => {
                        this.assetMap.set(asset.name, index)
                        const szDecimals = parseInt(asset.szDecimals) || 4
                        this.assetMetadataCache.set(asset.name, {
                            szDecimals,
                            priceDecimals: 6 - szDecimals
                        })
                    })
                }

                meta.universe.forEach((asset: any, i: number) => {
                    if (asset.isDelisted) return
                    const ctx = ctxs[i]
                    if (!ctx) return

                    const markPx = parseFloat(ctx.markPx) || 0
                    const prevDayPx = parseFloat(ctx.prevDayPx) || 0
                    const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0
                    const isHip3 = asset.name.includes(':')

                    allAssets.push({
                        name: asset.name,
                        coin: asset.name,
                        displayName: isHip3 ? asset.name.split(':')[1] || asset.name : asset.name,
                        category: isHip3 ? 'equities' : 'perps',
                        price: markPx,
                        change24h,
                        volume24h: parseFloat(ctx.dayNtlVlm) || 0,
                        openInterest: (parseFloat(ctx.openInterest) || 0) * markPx,
                        maxLeverage: asset.maxLeverage || 20,
                        szDecimals: parseInt(asset.szDecimals) || 4
                    })
                })
            }

            // 3. Fetch spot assets
            try {
                const spotResult = await (this.infoClient as any).spotMetaAndAssetCtxs()
                const spotMeta = spotResult[0]
                const spotCtxs = spotResult[1]

                const tokenMap = new Map<number, string>()
                if (spotMeta.tokens) {
                    for (const token of spotMeta.tokens) {
                        tokenMap.set(token.index, token.name)
                    }
                }

                console.log(`[Hyperliquid] Spot token map: ${tokenMap.size} tokens`)

                if (spotMeta.universe) {
                    spotMeta.universe.forEach((pair: any, i: number) => {
                        const ctx = spotCtxs[i]
                        if (!ctx) return

                        const markPx = parseFloat(ctx.markPx) || 0
                        const prevDayPx = parseFloat(ctx.prevDayPx) || 0
                        const change24h = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0

                        // Build display name from tokens (most reliable)
                        const baseToken = tokenMap.get(pair.tokens[0])
                        const quoteToken = tokenMap.get(pair.tokens[1])
                        let spotDisplayName: string
                        if (baseToken && quoteToken) {
                            spotDisplayName = `${baseToken}/${quoteToken}`
                        } else if (pair.name && pair.name.includes('/')) {
                            spotDisplayName = pair.name
                        } else if (ctx.coin && !ctx.coin.startsWith('@')) {
                            spotDisplayName = ctx.coin
                        } else {
                            spotDisplayName = pair.name || `Spot #${pair.index}`
                        }

                        // Use ctx.coin as canonical identifier (what the API uses for candle/subscription lookups)
                        const spotCoin = ctx.coin || pair.name

                        // Log first few + any suspicious prices for debugging
                        if (i < 3 || markPx > 10000) {
                            console.log(`[Hyperliquid] Spot[${i}]: index=${pair.index}, name="${pair.name}", ctx.coin="${ctx.coin}", tokens=[${pair.tokens}], base=${baseToken}, quote=${quoteToken}, markPx=${markPx}, display="${spotDisplayName}"`)
                        }

                        // Get szDecimals from base token metadata
                        const baseTokenMeta = spotMeta.tokens?.find((t: any) => t.index === pair.tokens[0])
                        const spotSzDecimals = baseTokenMeta?.szDecimals ?? 2

                        allAssets.push({
                            name: `@${pair.index}`,
                            coin: spotCoin,
                            displayName: spotDisplayName,
                            category: 'spot',
                            price: markPx,
                            change24h,
                            volume24h: parseFloat(ctx.dayNtlVlm) || 0,
                            openInterest: 0,
                            maxLeverage: 0,
                            szDecimals: spotSzDecimals,
                            baseToken: baseToken || undefined,
                            quoteToken: quoteToken || undefined
                        })
                    })
                }
            } catch (e) {
                console.warn('[Hyperliquid] Failed to fetch spot assets:', e)
            }

            const perpCount = allAssets.filter(a => a.category === 'perps').length
            const eqCount = allAssets.filter(a => a.category === 'equities').length
            const spotCount = allAssets.filter(a => a.category === 'spot').length
            console.log(`[Hyperliquid] Loaded ${allAssets.length} total assets (${perpCount} perps, ${eqCount} equities, ${spotCount} spot)`)

            return allAssets
        } catch (error) {
            console.error('[Hyperliquid] Failed to get all assets:', error)
            throw error
        }
    }

    async getCurrentMidPrice(symbol: string): Promise<number> {
        try {
            const allMids = await this.infoClient.allMids();
            const midPrice = parseFloat(allMids[symbol]);
            
            if (!midPrice || midPrice <= 0 || isNaN(midPrice)) {
                throw new Error(`Invalid mid price for ${symbol}: ${allMids[symbol]}`);
            }
            
            return midPrice;
        } catch (error) {
            console.error(`[Hyperliquid] Failed to get mid price for ${symbol}:`, error);
            throw error;
        }
    }

    async placeOrder(symbol: string, side: 'long' | 'short', price: number, size: number) {
        if (!this.exchClient) throw new Error("Not connected");

        const assetIndex = this.assetMap.get(symbol);
        if (assetIndex === undefined) throw new Error("Asset not found");

        const isBuy = side === 'long';
        // Note: Real rounding logic should use actual asset szDecimals from meta
        // Simplified for this phase

        const order = {
            a: assetIndex,
            b: isBuy,
            p: String(price),
            s: String(size),
            r: false,
            t: { limit: { tif: 'Gtc' as const } } as const
        };

        return await this.exchClient.order({
            orders: [order],
            grouping: 'na',
            builder: {
                b: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
                f: 10
            }
        });
    }

    // Direct subscription passthrough with dynamic interval
    subscribeToCandles(symbol: string, interval: CandleInterval, callback: (data: any) => void) {
        if (!this.subClient) return;
        return this.subClient.candle({ coin: symbol, interval: interval }, callback);
    }

    subscribeToL2(symbol: string, callback: (data: any) => void) {
        if (!this.subClient) return;
        return this.subClient.l2Book({ coin: symbol }, callback);
    }

    subscribeToTrades(symbol: string, callback: (data: any) => void) {
        if (!this.subClient) return;
        return this.subClient.trades({ coin: symbol }, callback);
    }

    /**
     * Fetch historical candle data for charts
     * Hyperliquid API limit: 5000 most recent candles
     * @param symbol - Asset symbol (e.g., 'ETH', 'BTC')
     * @param interval - Candle interval ('1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '8h', '12h', '1d', '3d', '1w', '1M')
     * @param startTime - Start timestamp in milliseconds (optional)
     * @param endTime - End timestamp in milliseconds (optional)
     * @returns Array of candle data with { t, o, h, l, c, v } format (max 5000 candles)
     */
    async getHistoricalCandles(
        symbol: string,
        interval: CandleInterval = '15m',
        startTime?: number,
        endTime?: number
    ): Promise<any[]> {
        try {
            const now = Date.now();
            const end = endTime || now;
            
            // Calculate optimal time range based on interval to get max useful data
            // Hyperliquid returns max 5000 most recent candles
            // Historical ranges for optimal chart coverage
            let historicalDays: number;
            switch (interval) {
                case '1m':
                    historicalDays = 1;      // 1 day
                    break;
                case '3m':
                    historicalDays = 2;      // 2 days
                    break;
                case '5m':
                    historicalDays = 7;      // 1 week
                    break;
                case '15m':
                    historicalDays = 14;     // 2 weeks
                    break;
                case '30m':
                    historicalDays = 30;     // 1 month
                    break;
                case '1h':
                    historicalDays = 60;     // 2 months
                    break;
                case '2h':
                    historicalDays = 90;     // 3 months
                    break;
                case '4h':
                    historicalDays = 180;    // 6 months
                    break;
                case '8h':
                    historicalDays = 270;    // 9 months
                    break;
                case '12h':
                    historicalDays = 365;    // 1 year
                    break;
                case '1d':
                    historicalDays = 365;    // 1 year
                    break;
                case '3d':
                    historicalDays = 730;    // 2 years
                    break;
                case '1w':
                    historicalDays = 1095;   // 3 years
                    break;
                case '1M':
                    historicalDays = 1825;   // 5 years
                    break;
                default:
                    historicalDays = 14;     // Default to 2 weeks
            }
            
            const start = startTime || (now - (historicalDays * 24 * 60 * 60 * 1000));

            console.log(`[🕯️ HL API] Requesting ${symbol} ${interval} candles from ${new Date(start).toISOString()} to ${new Date(end).toISOString()}`);
            
            const candles = await this.infoClient.candleSnapshot({
                coin: symbol,
                interval: interval,
                startTime: start,
                endTime: end
            });

            console.log(`[✅ HL API] Received ${candles?.length || 0} candles for ${symbol} ${interval}`);
            
            return candles || [];
        } catch (error) {
            console.error(`[Hyperliquid] Error fetching candles for ${symbol}:`, error);
            return [];
        }
    }

    /**
     * Get asset decimals for formatting
     * Returns cached metadata or fetches if not available
     */
    getSzDecimalsSync(symbol: string): number {
        // Exact match first
        const cached = this.assetMetadataCache.get(symbol);
        if (cached) return cached.szDecimals;

        // HIP-3 fallback: strip prefix and try base asset from main DEX
        // e.g. "lighter:BTC" → try "BTC" (szDecimals is typically the same across DEXs)
        if (symbol.includes(':')) {
            const baseName = symbol.split(':').slice(1).join(':');
            const baseCached = this.assetMetadataCache.get(baseName);
            if (baseCached) return baseCached.szDecimals;
        }

        // Hardcoded fallback for common assets (from Hyperliquid meta)
        const baseForLookup = symbol.includes(':') ? symbol.split(':').slice(1).join(':') : symbol;
        if (KNOWN_SZ_DECIMALS[baseForLookup] !== undefined) {
            return KNOWN_SZ_DECIMALS[baseForLookup];
        }

        return 4;
    }

    cacheSzDecimals(symbol: string, szDecimals: number, priceDecimals: number): void {
        this.assetMetadataCache.set(symbol, { szDecimals, priceDecimals });
    }

    async getAssetDecimals(symbol: string): Promise<{ szDecimals: number; priceDecimals: number }> {
        // Check cache first
        const cached = this.assetMetadataCache.get(symbol);
        if (cached) return cached;

        // Spot assets: resolve from spotMeta
        if (symbol.startsWith('@')) {
            try {
                const spotMeta = await (this.infoClient as any).spotMeta()
                const pairIndex = parseInt(symbol.substring(1))
                const pair = spotMeta?.universe?.find((p: any) => p.index === pairIndex)
                if (pair) {
                    const baseTokenIndex = pair.tokens[0]
                    const baseToken = spotMeta.tokens?.find((t: any) => t.index === baseTokenIndex)
                    const szDecimals = baseToken?.szDecimals ?? 2
                    const priceDecimals = Math.max(0, 6 - szDecimals)
                    this.assetMetadataCache.set(symbol, { szDecimals, priceDecimals })
                    return { szDecimals, priceDecimals }
                }
            } catch (e) {
                console.warn(`[Hyperliquid] Failed to get spot metadata for ${symbol}`)
            }
        }

        // Load metadata if not cached (perps + HIP-3)
        if (!this.meta) {
            await this.loadMetadata();
        }

        // Try cache again after loading
        const afterLoad = this.assetMetadataCache.get(symbol);
        if (afterLoad) return afterLoad;

        // Fallback to defaults
        console.warn(`[Hyperliquid] No metadata found for ${symbol}, using defaults`);
        return { szDecimals: 4, priceDecimals: 2 };
    }

    /**
     * Calculate tick size for a given price (Hyperliquid's 5 sig figs rule)
     * @param price - The price to calculate tick size for
     * @returns The tick size (minimum price increment)
     */
    calculateTickSize(price: number): number {
        if (!price || price <= 0) return 1;
        
        // Hyperliquid uses 5 significant figures
        const significantFigures = 5;
        const magnitude = Math.floor(Math.log10(Math.abs(price)));
        const maxDecimalPlaces = Math.max(0, significantFigures - magnitude - 1);
        
        // Tick size is the smallest increment for this price level
        return Math.pow(10, -maxDecimalPlaces);
    }

    /**
     * Format price using 5 significant figures rule dynamically
     * Removes trailing zeros after 6 decimals for cleaner display
     * @param price - Price to format
     * @returns Formatted price string with appropriate decimals
     */
    formatPriceWithSigFigs(price: number): string {
        if (!price || price === 0) return '0.00';
        
        const num = Math.abs(price);
        const significantFigures = 5;
        const magnitude = Math.floor(Math.log10(num));
        const maxDecimalPlaces = Math.max(0, significantFigures - magnitude - 1);
        
        // Ensure at least 2 decimal places for consistency
        const decimalPlaces = Math.max(2, Math.min(8, maxDecimalPlaces));
        
        let formatted = price.toFixed(decimalPlaces);
        
        // Remove trailing zeros after 6 decimals (e.g., $0.00007000 -> $0.00007)
        // But keep at least 2 decimal places
        if (formatted.includes('.')) {
            const parts = formatted.split('.');
            const intPart = parts[0];
            let decPart = parts[1];
            
            // If more than 6 decimals, remove trailing zeros from position 6 onward
            if (decPart.length > 6) {
                const first6 = decPart.slice(0, 6);
                const rest = decPart.slice(6).replace(/0+$/, ''); // Remove trailing zeros
                decPart = first6 + rest;
            }
            
            // Remove all trailing zeros but keep at least 2 decimals
            decPart = decPart.replace(/0+$/, '');
            if (decPart.length < 2) {
                decPart = decPart.padEnd(2, '0');
            }
            
            formatted = intPart + '.' + decPart;
        }
        
        return formatted;
    }

    /**
     * Format price using asset's dynamic decimals and 5 sig figs rule
     */
    async formatPrice(price: number, symbol: string): Promise<string> {
        const { priceDecimals } = await this.getAssetDecimals(symbol);
        const rounded = HyperliquidUtils.roundToTickSize(price, 6 - priceDecimals);
        
        // Apply 5 significant figures rule
        const significantFigures = 5;
        const magnitude = Math.floor(Math.log10(Math.abs(rounded)));
        const maxDecimalPlaces = Math.max(0, Math.min(priceDecimals, significantFigures - magnitude - 1));
        
        return rounded.toFixed(maxDecimalPlaces);
    }

    /**
     * Format size using asset's szDecimals
     */
    async formatSize(size: number, symbol: string): Promise<string> {
        const { szDecimals } = await this.getAssetDecimals(symbol);
        const rounded = HyperliquidUtils.roundToSizeDecimals(size, szDecimals);
        return rounded.toFixed(szDecimals);
    }

    /**
     * Get user portfolio (PnL history, account value history, volume) by time period
     */
    async getPortfolio(userAddress: string): Promise<any> {
        return await (this.infoClient as any).portfolio({ user: userAddress });
    }

    /**
     * Get perps clearinghouse state (account equity, margin, positions)
     */
    async getClearinghouseState(userAddress: string): Promise<any> {
        return await (this.infoClient as any).clearinghouseState({ user: userAddress });
    }

    /**
     * Get spot clearinghouse state (token balances)
     */
    async getSpotClearinghouseState(userAddress: string): Promise<any> {
        return await (this.infoClient as any).spotClearinghouseState({ user: userAddress });
    }

    /**
     * Get user fees (fee rates, daily volume, fee schedule)
     */
    async getUserFees(userAddress: string): Promise<any> {
        return await (this.infoClient as any).userFees({ user: userAddress });
    }
}

export const hyperliquid = new HyperliquidService();
