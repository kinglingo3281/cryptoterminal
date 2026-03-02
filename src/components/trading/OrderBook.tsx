"use client"

import { useState, useRef, useEffect, useMemo, memo } from "react"
import { cn } from "@/lib/utils";
import { Book, ArrowUpDown, ChevronDown } from "lucide-react";

// DEPRECATED: Price aggregation multiplier options
// const AGGREGATION_MULTIPLIERS = [
//     { value: 1, label: '1x' },
//     { value: 10, label: '10x' },
//     { value: 100, label: '100x' },
//     { value: 1000, label: '1000x' }
// ]

// Depth selector options (1-20 levels)
const DEPTH_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);
const DEFAULT_DEPTH = 10;
const DEPTH_STORAGE_KEY = 'orderbook-depth';

// Mock Data
const ASKS_DATA = [
    { price: 27.395, size: 2.05, total: 11.25 },
    { price: 27.390, size: 736.37, total: 9.20 },
    { price: 27.385, size: 327.18, total: 8.47 },
    { price: 27.380, size: 747.09, total: 8.14 },
    { price: 27.375, size: 1.22, total: 7.39 },
    { price: 27.370, size: 1.04, total: 6.17 },
    { price: 27.365, size: 1.55, total: 5.13 },
    { price: 27.360, size: 788.91, total: 3.57 },
    { price: 27.355, size: 1.33, total: 2.78 },
    { price: 27.350, size: 1.06, total: 1.46 },
    { price: 27.345, size: 332.90, total: 399.34 },
    { price: 27.340, size: 59.67, total: 66.44 },
    { price: 27.335, size: 6.77, total: 6.77 },
    { price: 27.330, size: 5.0, total: 5.0 },
    { price: 27.325, size: 10.0, total: 15.0 },
];

const BIDS_DATA = [
    { price: 27.330, size: 1.01, total: 1.01 },
    { price: 27.320, size: 755.54, total: 1.76 },
    { price: 27.315, size: 1.43, total: 3.19 },
    { price: 27.310, size: 1.41, total: 4.60 },
    { price: 27.305, size: 1.77, total: 6.37 },
    { price: 27.300, size: 1.53, total: 7.90 },
    { price: 27.295, size: 1.43, total: 9.33 },
    { price: 27.290, size: 905.65, total: 10.23 },
    { price: 27.285, size: 2.59, total: 12.82 },
    { price: 27.280, size: 1.43, total: 14.25 },
    { price: 27.275, size: 2.04, total: 16.28 },
    { price: 27.270, size: 1.11, total: 17.40 },
    { price: 27.265, size: 5.0, total: 22.4 },
    { price: 27.260, size: 10.0, total: 32.4 },
];

interface OrderBookProps {
    isExpanded: boolean;
    onToggleExpand: () => void;
    selectedAsset?: string;
    coin?: string;
    displayName?: string;
}

import { hyperliquid } from "@/services/hyperliquid";
import { useOrderbookPriceStore } from "@/store/useOrderbookPriceStore";

// Memoized OrderBook Row Component for performance
const OrderBookRow = memo<{
    price: number;
    size: number;
    total: number;
    maxTotal: number;
    type: 'ask' | 'bid';
    showInUSD: boolean;
    assetDecimals: { szDecimals: number; priceDecimals: number };
    onPriceClick?: (price: string) => void;
}>(({ price, size, total, maxTotal, type, showInUSD, assetDecimals, onPriceClick }) => {
    const displaySize = showInUSD ? (size * price) : size;
    const displayTotal = showInUSD ? (total * price) : total;
    const formattedPrice = hyperliquid.formatPriceWithSigFigs(price);
    const sizeDecimals = showInUSD ? 2 : assetDecimals.szDecimals;
    
    // Cumulative depth bar - normalized to max total in visible range
    const depthWidth = maxTotal > 0 ? Math.min((total / maxTotal) * 100, 100) : 0;
    
    return (
        <div className="grid grid-cols-3 px-3 py-[2px] hover:bg-muted/30 cursor-pointer relative group text-xs font-medium" suppressHydrationWarning onClick={() => onPriceClick?.(formattedPrice)}>
            <div 
                className={cn(
                    "absolute right-0 top-0 bottom-0 opacity-50 group-hover:opacity-70 transition-all",
                    type === 'ask' ? "bg-trade-red/25" : "bg-trade-green/25"
                )}
                style={{ width: `${depthWidth}%` }}
            />
            <span className={cn(
                "relative z-10",
                type === 'ask' ? "text-trade-red" : "text-trade-green"
            )} suppressHydrationWarning>
                ${formattedPrice}
            </span>
            <span className="text-right text-foreground/90 relative z-10" suppressHydrationWarning>
                {displaySize >= 1000 ? (displaySize / 1000).toFixed(2) + 'K' : displaySize.toFixed(sizeDecimals)}
            </span>
            <span className="text-right text-muted-foreground relative z-10" suppressHydrationWarning>
                {displayTotal >= 1000 ? (displayTotal / 1000).toFixed(2) + 'K' : displayTotal.toFixed(sizeDecimals)}
            </span>
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison: only re-render if these values changed
    return (
        prevProps.price === nextProps.price &&
        prevProps.size === nextProps.size &&
        prevProps.total === nextProps.total &&
        prevProps.maxTotal === nextProps.maxTotal &&
        prevProps.showInUSD === nextProps.showInUSD &&
        prevProps.assetDecimals.szDecimals === nextProps.assetDecimals.szDecimals &&
        prevProps.onPriceClick === nextProps.onPriceClick
    );
});

OrderBookRow.displayName = 'OrderBookRow';

export function OrderBook({ isExpanded, onToggleExpand, selectedAsset = 'HYPE', coin, displayName }: OrderBookProps) {
    // API-facing coin for subscriptions (falls back to selectedAsset for perps where they're the same)
    const apiCoin = coin || selectedAsset;
    const setSelectedPrice = useOrderbookPriceStore(s => s.setSelectedPrice);
    // Prevent hydration mismatch by only rendering after client mount
    const [isMounted, setIsMounted] = useState(false);
    
    // Initialize depth from localStorage synchronously (prevents hydration mismatch and race conditions)
    const [depth, setDepth] = useState(() => {
        if (typeof window === 'undefined') return DEFAULT_DEPTH;
        
        const storedDepth = localStorage.getItem(DEPTH_STORAGE_KEY);
        if (storedDepth) {
            const parsedDepth = parseInt(storedDepth, 10);
            if (DEPTH_OPTIONS.includes(parsedDepth)) {
                return parsedDepth;
            }
        }
        return DEFAULT_DEPTH;
    });
    
    // Track if this is initial render (prevents saving initial value back to storage)
    const isInitialRender = useRef(true);
    
    // const [aggregationMultiplier, setAggregationMultiplier] = useState(1) // DEPRECATED
    const [showDepthDropdown, setShowDepthDropdown] = useState(false)
    const [showInUSD, setShowInUSD] = useState(false)
    const depthDropdownRef = useRef<HTMLDivElement>(null)

    // View mode: orderbook or trades
    const [viewMode, setViewMode] = useState<'orderbook' | 'trades'>('orderbook')

    // Recent trades state
    const [recentTrades, setRecentTrades] = useState<{ price: string; size: string; side: string; time: number }[]>([])
    const MAX_TRADES = 50

    // Set mounted after hydration
    useEffect(() => {
        setIsMounted(true);
    }, []);

    // Batched Order Book State (reduces re-renders)
    const [orderbookState, setOrderbookState] = useState({
        asks: [] as { price: number; size: number; total: number }[],
        bids: [] as { price: number; size: number; total: number }[],
        spread: 0,
        spreadPercent: 0,
        midPrice: 0,
        bestBid: 0,
        bestAsk: 0
    })

    // Asset Metadata State
    const [assetDecimals, setAssetDecimals] = useState<{ szDecimals: number; priceDecimals: number }>({ szDecimals: 4, priceDecimals: 2 })

    // Ref to track current API coin for stale-check in callbacks
    const coinRef = useRef(apiCoin);
    useEffect(() => { coinRef.current = apiCoin; }, [apiCoin]);
    
    // RAF throttling for smoother updates (max 60fps)
    const rafRef = useRef<number | null>(null);
    const pendingUpdateRef = useRef<any>(null);

    // Load Asset Metadata on mount and asset change
    useEffect(() => {
        const loadMetadata = async () => {
            try {
                const decimals = await hyperliquid.getAssetDecimals(selectedAsset);
                setAssetDecimals(decimals);
                // console.log(`[OrderBook] Loaded decimals for ${selectedAsset}:`, decimals);
            } catch (error) {
                console.warn(`[OrderBook] Failed to load decimals for ${selectedAsset}, using defaults`);
            }
        };
        loadMetadata();
        
        // Cleanup RAF on asset change
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [selectedAsset, apiCoin]);

    // Trades WebSocket Subscription
    useEffect(() => {
        if (viewMode !== 'trades') return

        let subscription: any = null
        const startSub = async () => {
            try {
                await hyperliquid.initWebSocket()
                subscription = await hyperliquid.subscribeToTrades(apiCoin, (trades: any) => {
                    if (!Array.isArray(trades)) return
                    setRecentTrades(prev => {
                        const newTrades = trades.map((t: any) => ({
                            price: t.px,
                            size: t.sz,
                            side: t.side,
                            time: t.time
                        }))
                        const merged = [...newTrades, ...prev]
                        return merged.slice(0, MAX_TRADES)
                    })
                })
            } catch (e) {
                console.warn('[OrderBook] Failed to subscribe to trades:', e)
            }
        }
        setRecentTrades([])
        startSub()
        return () => {
            if (subscription && typeof subscription.unsubscribe === 'function') {
                subscription.unsubscribe()
            } else if (typeof subscription === 'function') {
                subscription()
            }
        }
    }, [apiCoin, viewMode])

    // Live Data Subscription (L2 orderbook)
    useEffect(() => {
        const handleData = (data: any) => {
            // Guard: Ignore data for previous assets
            if (data.coin !== coinRef.current) return;

            const levels = data.levels;
            if (!levels) return;
            
            // Store pending update
            pendingUpdateRef.current = data;
            
            // Cancel any pending RAF
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
            
            // Throttle to max 60fps using RAF
            rafRef.current = requestAnimationFrame(() => {
                const updateData = pendingUpdateRef.current;
                if (!updateData || !updateData.levels) return;
                
                const levels = updateData.levels;
                
                // Process Bids (levels[0])
                const rawBids = levels[0] || [];
                let bidTotal = 0;
                const processedBids = rawBids.map((b: any) => {
                    const size = parseFloat(b.sz);
                    const price = parseFloat(b.px);
                    bidTotal += size;
                    return { price, size, total: bidTotal };
                });

                // Process Asks (levels[1])
                const rawAsks = levels[1] || [];
                let askTotal = 0;
                const processedAsks = rawAsks.map((a: any) => {
                    const size = parseFloat(a.sz);
                    const price = parseFloat(a.px);
                    askTotal += size;
                    return { price, size, total: askTotal };
                });

                // Calculate Spread (from first bid and first ask)
                const currentBestBid = rawBids.length > 0 ? parseFloat(rawBids[0].px) : 0;
                const currentBestAsk = rawAsks.length > 0 ? parseFloat(rawAsks[0].px) : 0;
                const currentSpread = currentBestAsk && currentBestBid ? currentBestAsk - currentBestBid : 0;
                const currentSpreadPercent = currentBestBid > 0 ? (currentSpread / currentBestBid) * 100 : 0;
                const currentMidPrice = currentBestAsk && currentBestBid ? (currentBestAsk + currentBestBid) / 2 : 0;

                // Single batched state update (reduces re-renders from 7 to 1)
                // Hyperliquid API provides ~10-20 levels, cap storage at 20
                setOrderbookState({
                    bids: processedBids.slice(0, 20),
                    asks: processedAsks.slice(0, 20),
                    bestBid: currentBestBid,
                    bestAsk: currentBestAsk,
                    spread: currentSpread,
                    spreadPercent: currentSpreadPercent,
                    midPrice: currentMidPrice
                });
                
                // Reduce console spam - only log every 10th update
                if (Math.random() < 0.1) {
                    const spreadPct = ((currentSpread / currentMidPrice) * 100).toFixed(4) + '%';
                    // console.log('[OrderBook] Spread calc:', { bestBid: currentBestBid, bestAsk: currentBestAsk, spread: currentSpread, spreadPct, midPrice: currentMidPrice });
                }
                
                rafRef.current = null;
            });
        };

        const initSub = async () => {
            await hyperliquid.initWebSocket();
            await hyperliquid.subscribeToL2(apiCoin, handleData);
        };

        initSub();

        return () => {
            // Cleanup RAF on unmount
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, [apiCoin]);

    // Memoized display slicing based on depth selector
    // Depth controls row count regardless of expansion state
    const displayAsks = useMemo(() => {
        const processedAsks = orderbookState.asks;
        const maxDepth = Math.min(depth, processedAsks.length);
        return processedAsks.slice(0, maxDepth);
    }, [orderbookState.asks, depth]);

    const displayBids = useMemo(() => {
        const processedBids = orderbookState.bids;
        const maxDepth = Math.min(depth, processedBids.length);
        return processedBids.slice(0, maxDepth);
    }, [orderbookState.bids, depth]);

    // Calculate max totals for cumulative depth bars (normalized to visible range)
    const maxAskTotal = useMemo(() => {
        return displayAsks.length > 0 ? displayAsks[displayAsks.length - 1].total : 0;
    }, [displayAsks]);

    const maxBidTotal = useMemo(() => {
        return displayBids.length > 0 ? displayBids[displayBids.length - 1].total : 0;
    }, [displayBids]);

    // Mark initial render as complete after first effect run
    useEffect(() => {
        isInitialRender.current = false;
    }, []);
    
    // Persist depth to localStorage whenever it changes (skip initial render)
    useEffect(() => {
        // Skip on initial render to avoid re-saving the value we just loaded
        if (isInitialRender.current) {
            return;
        }
        
        if (typeof window !== 'undefined') {
            localStorage.setItem(DEPTH_STORAGE_KEY, depth.toString());
        }
    }, [depth]);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (depthDropdownRef.current && !depthDropdownRef.current.contains(e.target as Node)) {
                setShowDepthDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const displayUnit = showInUSD ? 'USD' : (displayName || selectedAsset)

    // Prevent hydration mismatch - only render after client mount
    if (!isMounted) {
        return null;
    }

    return (
        <div className="flex flex-col h-full bg-card text-xs font-mono relative select-none" suppressHydrationWarning>
            {/* Top Toolbar: OrderBook / Trades Toggle */}
            <div className="flex items-center justify-center px-2 py-1.5 border-b border-border">
                <div className="flex bg-secondary/50 rounded-md p-0.5 w-full">
                    <button
                        onClick={() => setViewMode('orderbook')}
                        className={cn(
                            "flex-1 p-1.5 rounded transition-colors flex items-center justify-center gap-1.5 text-[10px] font-semibold",
                            viewMode === 'orderbook' ? "bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                    >
                        <Book className="h-3.5 w-3.5" />
                        Order Book
                    </button>
                    <button
                        onClick={() => setViewMode('trades')}
                        className={cn(
                            "flex-1 p-1.5 rounded transition-colors flex items-center justify-center gap-1.5 text-[10px] font-semibold",
                            viewMode === 'trades' ? "bg-muted/50 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                    >
                        <ArrowUpDown className="h-3.5 w-3.5" />
                        Trades
                    </button>
                </div>
            </div>

            {viewMode === 'orderbook' ? (
                <>
                    {/* Depth Selector & Ticker Row */}
                    <div className="flex items-center justify-between px-3 py-2 text-muted-foreground bg-card">
                        {/* Depth Selector Dropdown (1-20) */}
                        <div className="relative" ref={depthDropdownRef}>
                            <button
                                onClick={() => setShowDepthDropdown(!showDepthDropdown)}
                                className="flex items-center gap-1 hover:text-foreground transition-colors text-xs font-medium"
                            >
                                <span suppressHydrationWarning>{depth}</span>
                                <ChevronDown className="h-3 w-3" />
                            </button>

                            {showDepthDropdown && (
                                <div className="absolute top-full left-0 mt-1 bg-popover border border-border rounded-lg shadow-xl z-50 py-1 overflow-y-auto max-h-[200px] min-w-[60px]">
                                    {DEPTH_OPTIONS.map((depthOption) => (
                                        <button
                                            key={depthOption}
                                            onClick={() => { 
                                                setDepth(depthOption); 
                                                setShowDepthDropdown(false);
                                            }}
                                            className={cn(
                                                "w-full px-3 py-1.5 text-left text-xs hover:bg-muted transition-colors",
                                                depth === depthOption ? "text-primary font-semibold" : "text-muted-foreground"
                                            )}
                                        >
                                            {depthOption}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Asset/USD Toggle */}
                        <div className="flex bg-secondary/30 rounded p-0.5 border border-white/5">
                            <button
                                onClick={() => setShowInUSD(false)}
                                className={cn(
                                    "px-2 py-0.5 text-[10px] font-bold rounded transition-colors",
                                    !showInUSD ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/70"
                                )}
                            >
                                {displayName || selectedAsset}
                            </button>
                            <button
                                onClick={() => setShowInUSD(true)}
                                className={cn(
                                    "px-2 py-0.5 text-[10px] font-bold rounded transition-colors",
                                    showInUSD ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground/70"
                                )}
                            >
                                USD
                            </button>
                        </div>
                    </div>

                    {/* Column Headers */}
                    <div className="grid grid-cols-3 px-3 py-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider mb-1">
                        <span className="text-left">Price</span>
                        <span className="text-right">Size ({displayUnit})</span>
                        <span className="text-right">Total ({displayUnit})</span>
                    </div>

                    {/* Asks (Sell Orders) - Red */}
                    <div className="flex flex-col-reverse flex-1 overflow-y-auto min-h-0" suppressHydrationWarning>
                        {displayAsks.map((ask) => (
                            <OrderBookRow
                                key={`ask-${ask.price}`}
                                price={ask.price}
                                size={ask.size}
                                total={ask.total}
                                maxTotal={maxAskTotal}
                                type="ask"
                                showInUSD={showInUSD}
                                assetDecimals={assetDecimals}
                                onPriceClick={setSelectedPrice}
                            />
                        ))}
                    </div>

                    {/* Spread Indicator */}
                    <div className="flex items-center justify-between px-3 py-2 border-y border-border/50 bg-muted/5 my-0.5 shrink-0" suppressHydrationWarning>
                        <div className="flex flex-col gap-0.5">
                            <span className="text-muted-foreground text-[11px] font-medium">Spread</span>
                            <span className="text-muted-foreground text-[10px]">Mid: ${hyperliquid.formatPriceWithSigFigs(orderbookState.midPrice)}</span>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-bold text-foreground">${hyperliquid.formatPriceWithSigFigs(orderbookState.spread)}</div>
                            <div className="text-[10px] text-muted-foreground">{orderbookState.spreadPercent.toFixed(4)}%</div>
                        </div>
                    </div>

                    {/* Bids (Buy Orders) - Green */}
                    <div className="flex flex-col flex-1 overflow-y-auto min-h-0" suppressHydrationWarning>
                        {displayBids.map((bid) => (
                            <OrderBookRow
                                key={`bid-${bid.price}`}
                                price={bid.price}
                                size={bid.size}
                                total={bid.total}
                                maxTotal={maxBidTotal}
                                type="bid"
                                showInUSD={showInUSD}
                                assetDecimals={assetDecimals}
                                onPriceClick={setSelectedPrice}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <>
                    {/* Trades View */}
                    <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider border-b border-border/50">
                        <span className="text-left">Price</span>
                        <span className="text-right">Size</span>
                        <span className="text-right">Time</span>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0">
                        {recentTrades.length === 0 ? (
                            <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                                Waiting for trades...
                            </div>
                        ) : (
                            recentTrades.map((trade, i) => {
                                const isBuy = trade.side === 'B'
                                const d = new Date(trade.time)
                                const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
                                return (
                                    <div key={`${trade.time}-${i}`} className="grid grid-cols-3 px-3 py-[2px] text-xs font-medium hover:bg-muted/30">
                                        <span className={isBuy ? "text-trade-green" : "text-trade-red"}>
                                            ${hyperliquid.formatPriceWithSigFigs(parseFloat(trade.price))}
                                        </span>
                                        <span className="text-right text-foreground/90">
                                            {parseFloat(trade.size).toFixed(assetDecimals.szDecimals)}
                                        </span>
                                        <span className="text-right text-muted-foreground">
                                            {timeStr}
                                        </span>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </>
            )}

            {/* Bottom Controls */}
            <div className="flex items-center justify-center p-0.5 border-t border-border mt-auto bg-card shrink-0 hover:bg-muted/20 transition-colors cursor-pointer" onClick={onToggleExpand}>
                <button
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center justify-center w-full py-1"
                >
                    {isExpanded ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6" /></svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    )}
                </button>
            </div>
        </div>
    )
}
