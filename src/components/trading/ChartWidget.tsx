"use client"

import React, { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from 'framer-motion';
import '@klinecharts/pro/dist/klinecharts-pro.css';
import { init as klinechartsInit, LineType } from 'klinecharts';
import { HyperliquidDatafeed } from '@/services/HyperliquidDatafeed';
import { hyperliquid } from '@/services/hyperliquid';
import { usePositionsStore } from '@/store/usePositionsStore';
import { useQuickTrade } from '@/hooks/useQuickTrade';
import { useTradingReadiness } from '@/hooks/useTradingReadiness';
import { ChevronDown, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChartWidgetProps {
    symbol?: string;
    coin?: string;
    showQuickTrade?: boolean;
    onHideQuickTrade?: () => void;
}

const chartStyles: any = {
    candle: {
        type: 'candle_solid',
        bar: {
            upColor: '#2DBD85',
            downColor: '#E05252',
            upBorderColor: '#2DBD85',
            downBorderColor: '#E05252',
            upWickColor: '#2DBD85',
            downWickColor: '#E05252'
        },
        priceMark: {
            high: {
                color: '#2DBD85',
                textColor: '#FAFAFA'
            },
            low: {
                color: '#E05252',
                textColor: '#FAFAFA'
            },
            last: {
                upColor: '#2DBD85',
                downColor: '#E05252',
                line: {
                    style: 'dashed',
                    size: 1
                }
            }
        }
    },
    grid: {
        horizontal: {
            color: 'rgba(42, 46, 57, 0.4)',
            size: 1,
            style: 'solid'
        },
        vertical: {
            color: 'rgba(42, 46, 57, 0.4)',
            size: 1,
            style: 'solid'
        }
    },
    xAxis: {
        axisLine: {
            color: 'rgba(42, 46, 57, 1)',
            size: 1
        },
        tickLine: {
            show: false
        },
        tickText: {
            color: '#787B86',
            family: 'SF Mono, Roboto Mono, Consolas, monospace',
            size: 11,
            weight: 500,
            marginStart: 4,
            marginEnd: 4
        }
    },
    yAxis: {
        type: 'normal',
        axisLine: {
            show: false
        },
        tickLine: {
            show: false
        },
        tickText: {
            color: '#787B86',
            family: 'SF Mono, Roboto Mono, Consolas, monospace',
            size: 11,
            weight: 500,
            paddingLeft: 8,
            paddingRight: 8
        }
    },
    crosshair: {
        horizontal: {
            line: {
                color: '#787B86',
                style: 'dashed',
                size: 1,
                dashedValue: [4, 4]
            },
            text: {
                backgroundColor: '#1E222D',
                color: '#D1D4DC',
                family: 'SF Mono, Roboto Mono, Consolas, monospace',
                size: 11,
                weight: 500,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 2
            }
        },
        vertical: {
            line: {
                color: '#787B86',
                style: 'dashed',
                size: 1,
                dashedValue: [4, 4]
            },
            text: {
                backgroundColor: '#1E222D',
                color: '#D1D4DC',
                family: 'SF Mono, Roboto Mono, Consolas, monospace',
                size: 11,
                weight: 500,
                paddingLeft: 8,
                paddingRight: 8,
                paddingTop: 4,
                paddingBottom: 4,
                borderRadius: 2
            }
        }
    }
};

export function ChartWidget({ symbol = "HYPE", coin, showQuickTrade = true, onHideQuickTrade }: ChartWidgetProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const symbolRef = useRef(symbol);
    const datafeedRef = useRef<HyperliquidDatafeed | null>(null);
    const [initialPrice, setInitialPrice] = useState(0);
    const [chartReady, setChartReady] = useState(false);
    const orders = usePositionsStore(state => state.orders);
    const overlayIdsRef = useRef<string[]>([]);
    const chartInstanceRef = useRef<any>(null);

    useEffect(() => { 
        symbolRef.current = symbol; 
    }, [symbol]);

    // Derive the API-facing coin for subscriptions/lookups
    const apiCoin = coin || (symbol.includes('-') ? symbol.split('-')[0] : symbol);

    // Fetch real price for the QuickTradeWidget
    useEffect(() => {
        const fetchPrice = async () => {
            try {
                const allMids = await hyperliquid.getMarketData();
                const price = parseFloat(allMids[apiCoin]);
                if (price && price > 0) setInitialPrice(price);
            } catch (e) { /* QuickTradeWidget will get price from L2 sub anyway */ }
        };
        fetchPrice();
    }, [apiCoin]);

    // Use layoutEffect + delay to ensure container has dimensions before chart init
    useEffect(() => {
        if (!containerRef.current || typeof window === 'undefined') return;
        
        // Guard: prevent double-initialization if chart already exists
        if (chartRef.current) {
            return;
        }

        // Set flag IMMEDIATELY to prevent duplicate init during async operations
        chartRef.current = 'INITIALIZING' as any;

        const container = containerRef.current; // Capture for closure

        // Create persistent datafeed instance
        if (!datafeedRef.current) {
            datafeedRef.current = new HyperliquidDatafeed();
        }

        // APPROACH 1: Force browser reflow to ensure container has dimensions
        const rect = container.getBoundingClientRect();
        // console.log('[CHART INIT] Container dimensions before init:', rect.width, 'x', rect.height);
        
        // APPROACH 2: Use requestAnimationFrame to defer until after paint cycle
        requestAnimationFrame(() => {
        requestAnimationFrame(() => {

        // Dynamic import to avoid SSR issues
        import('@klinecharts/pro').then(({ KLineChartPro }) => {
            const watermarkImg = document.createElement('img');
            watermarkImg.src = '/evlogo-short-green.svg';
            watermarkImg.style.opacity = '0.08';
            watermarkImg.style.width = '120px';
            watermarkImg.style.height = 'auto';

            // APPROACH 3: Set explicit pixel dimensions on container before init
            const parentRect = container.parentElement?.getBoundingClientRect();
            if (parentRect) {
                container.style.width = `${Math.floor(parentRect.width)}px`;
                container.style.height = `${Math.floor(parentRect.height)}px`;
            }

            chartRef.current = new KLineChartPro({
                container: container,
                watermark: watermarkImg,
                symbol: {
                    ticker: apiCoin,
                    name: apiCoin,
                    exchange: 'Hyperliquid'
                },
                period: { 
                    multiplier: 15, 
                    timespan: 'minute' as const,
                    text: '15m'
                },
                periods: [
                    { multiplier: 1, timespan: 'minute', text: '1m' },
                    { multiplier: 3, timespan: 'minute', text: '3m' },
                    { multiplier: 5, timespan: 'minute', text: '5m' },
                    { multiplier: 15, timespan: 'minute', text: '15m' },
                    { multiplier: 30, timespan: 'minute', text: '30m' },
                    { multiplier: 1, timespan: 'hour', text: '1H' },
                    { multiplier: 2, timespan: 'hour', text: '2H' },
                    { multiplier: 4, timespan: 'hour', text: '4H' },
                    { multiplier: 1, timespan: 'day', text: 'D' },
                    { multiplier: 1, timespan: 'week', text: 'W' },
                    { multiplier: 1, timespan: 'month', text: 'M' }
                ],
                theme: 'dark',
                styles: chartStyles,
                locale: 'en-US',
                datafeed: datafeedRef.current!
            });

            // console.log('[CHART] Initialized with period:', { multiplier, timespan, text });
            // console.log('[CHART] Available periods:', chartRef.current.getChartSwitchConfig().periods.length, 'periods configured');
            
            // Configure candle pane with tighter Y-axis gap for better scaling on low-priced assets
            // Default gap is { top: 0.2, bottom: 0.1 } which can cause issues with small price ranges
            setTimeout(() => {
                try {
                    // Access underlying klinecharts instance via container query
                    const container = chartRef.current?._container;
                    if (!container) return;
                    
                    const chartElement = container.querySelector('[k-line-chart-id]') as HTMLElement;
                    if (!chartElement) return;
                    
                    const chartId = chartElement.getAttribute('k-line-chart-id');
                    if (!chartId) return;
                    
                    const originalId = chartElement.id;
                    chartElement.id = chartId;
                    
                    const chart = klinechartsInit(chartElement);
                    
                    if (originalId) {
                        chartElement.id = originalId;
                    } else {
                        chartElement.removeAttribute('id');
                    }
                    
                    if (chart) {
                        // Set high precision for low-priced assets BEFORE setting pane options
                        const dataList = chart.getDataList?.() || [];
                        if (dataList.length > 0) {
                            const lastPrice = dataList[dataList.length - 1]?.close || 0;
                            let precision = 2;
                            if (lastPrice < 0.1) precision = 8;
                            else if (lastPrice < 1) precision = 6;
                            else if (lastPrice < 10) precision = 4;
                            else if (lastPrice < 100) precision = 3;
                            
                            console.log(`[CHART] Setting precision to ${precision} for price $${lastPrice}`);
                            chart.setPriceVolumePrecision(precision, 2);
                        }
                        
                        chart.setPaneOptions({
                            id: 'candle_pane',
                            gap: { top: 0.02, bottom: 0.02 }
                        });
                        
                        // Force chart to recalculate by triggering resize
                        chart.resize();
                        
                        // Mark chart as ready to show
                        setChartReady(true);
                    }
                } catch (e) {
                    console.error('[CHART] Error setting pane options:', e);
                    setChartReady(true);
                }
            }, 800);
            
            // Log final container size after chart init
            const finalRect = container.getBoundingClientRect();
            // console.log('[CHART INIT] Final container dimensions:', container.getBoundingClientRect().width, 'x', container.getBoundingClientRect().height);
            // console.log('[CHART INIT] Container offsetWidth/Height:', container.offsetWidth, 'x', container.offsetHeight);
            
            // Expose to window for manual testing
            (window as any).__klinechart = chartRef.current;
            // Development helper: expose period change function for testing
            (window as any).__testPeriodChange = (multiplier: number, timespan: string, text: string) => {
                chartRef.current?.setPeriod({ multiplier, timespan, text });
            };
            // console.log('[CHART] Test command available: window.__testPeriodChange(1, "minute", "1m")');
            
            // Add tooltips after chart is initialized
            setTimeout(() => {
                // console.log('[CHART] Adding tooltips to tool buttons...');
                
                const tooltipMap: Record<string, string> = {
                    'horizontal_straight_line': 'Horizontal Line',
                    'vertical_straight_line': 'Vertical Line', 
                    'straight_line': 'Trend Line',
                    'ray_line': 'Ray',
                    'segment': 'Segment',
                    'arrow': 'Arrow',
                    'rect': 'Rectangle',
                    'circle': 'Circle',
                    'triangle': 'Triangle',
                    'parallelogram': 'Parallelogram',
                    'fibonacci_line': 'Fibonacci',
                    'fibonacci_segment': 'Fibonacci Extension',
                    'parallel_straight_line': 'Channel',
                    'price_line': 'Price Line'
                };
                
                // Find drawing toolbar buttons
                const drawingBar = container.querySelector('.klinecharts-pro-drawing-bar');
                if (drawingBar) {
                    const toolButtons = container.querySelectorAll('[class*="tool-button"], [class*="drawing-tool"], button[class*="klinecharts"]');
                // console.log('[CHART] Found', toolButtons.length, 'drawing tool buttons');
                    
                    // Position-based tool names (top to bottom in toolbar)
                    const toolNames = [
                        'Line Tools',           // 0 - Vertical/Trend/Ray/Segment/Arrow lines
                        'Channel',              // 1 - Price channel & parallel lines
                        'Circle',               // 2 - Circle shape
                        'Fibonacci Tools',      // 3 - Fib Line/Segment/Circle/Spiral/Sector/Extension/Gann
                        'Wave Patterns',        // 4 - XABCD/ABCD/Three/Five/Eight/Any Waves
                        'Magnet',               // 5 - Snap to price
                        'Lock Drawings',        // 6 - Lock/unlock
                        'Toggle Visibility',    // 7 - Eye icon
                        'Delete Drawing'        // 8 - Trash can
                    ];
                    
                    toolButtons.forEach((btn, idx) => {
                        // Get tool name from position-based mapping
                        let label = toolNames[idx] || `Tool ${idx + 1}`;
                        
                        // Try to get more specific name from icon attributes
                        const iconEl = btn.querySelector('i, svg, use');
                        if (iconEl) {
                            const href = iconEl.getAttribute('href') || iconEl.getAttribute('xlink:href') || '';
                            
                            // Try to match by class or href
                            const iconClasses = Array.from(iconEl.classList);
                            const toolClass = iconClasses.find(c => tooltipMap[c]);
                            if (toolClass) {
                                label = tooltipMap[toolClass];
                            } else if (href) {
                                // Extract tool name from SVG href like "#icon-horizontal_line"
                                const match = href.match(/#icon-(.+)/);
                                if (match && tooltipMap[match[1]]) {
                                    label = tooltipMap[match[1]];
                                }
                            }
                        }
                        
                        // Use native title attribute for reliable browser tooltips
                        btn.setAttribute('title', label);
                    });
                }
                // console.log('[CHART] Tooltip setup complete');
            }, 1000);
        
        }).catch(err => {
            console.error('[CHART] Failed to load KLineChartPro:', err);
        });

        });
        });

        return () => {
            if (chartRef.current && typeof chartRef.current.dispose === 'function') {
                chartRef.current.dispose();
                chartRef.current = null;
            }
        };
    }, []);

    // Watch PARENT element for size changes (when panel is dragged)
    // Update container's explicit px dimensions, then trigger chart resize
    useEffect(() => {
        if (!containerRef.current || typeof window === 'undefined') return;

        const container = containerRef.current;
        const parent = container.parentElement;
        if (!parent) return;

        let rafId: number;
        let lastWidth = 0;
        let lastHeight = 0;
        
        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                
                // Only process if dimensions changed by at least 1px
                const widthChanged = Math.abs(width - lastWidth) >= 1;
                const heightChanged = Math.abs(height - lastHeight) >= 1;
                
                if (!widthChanged && !heightChanged) return;
                
                lastWidth = width;
                lastHeight = height;
                
                // Cancel pending RAF if already scheduled
                if (rafId) cancelAnimationFrame(rafId);
                
                // Use RAF to update on next frame for smoother rendering
                rafId = requestAnimationFrame(() => {
                    // Update container to match new parent dimensions
                    const newWidth = Math.floor(width);
                    const newHeight = Math.floor(height);
                    
                    container.style.width = `${newWidth}px`;
                    container.style.height = `${newHeight}px`;
                    
                    // Trigger chart resize on next frame after DOM update
                    requestAnimationFrame(() => {
                        window.dispatchEvent(new Event('resize'));
                    });
                });
            }
        });

        resizeObserver.observe(parent);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        // Only update symbol if chart is fully initialized (not 'INITIALIZING' string)
        if (chartRef.current && typeof chartRef.current === 'object' && chartRef.current.setSymbol) {
            // Clear cached chart instance so overlays get recreated properly
            chartInstanceRef.current = null;
            
            chartRef.current.setSymbol({
                ticker: apiCoin,
                name: apiCoin,
                exchange: 'Hyperliquid'
            });
            
            // After symbol change, reset the chart view to fit new data
            setTimeout(() => {
                try {
                    const container = chartRef.current?._container;
                    if (!container) return;
                    
                    const chartElement = container.querySelector('[k-line-chart-id]') as HTMLElement;
                    if (!chartElement) return;
                    
                    const chartId = chartElement.getAttribute('k-line-chart-id');
                    if (!chartId) return;
                    
                    // Temporarily set id to get the chart instance
                    const originalId = chartElement.id;
                    chartElement.id = chartId;
                    
                    const chart = klinechartsInit(chartElement);
                    chartInstanceRef.current = chart;
                    
                    // Restore original id
                    if (originalId) {
                        chartElement.id = originalId;
                    } else {
                        chartElement.removeAttribute('id');
                    }
                    
                    // Scroll to latest data and reset zoom
                    if (chart) {
                        chart.scrollToRealTime(300);
                    }
                } catch (e) {
                    console.error('[Chart] Error resetting view:', e);
                }
            }, 800);
        }
    }, [apiCoin]);

    useEffect(() => {
        if (!chartRef.current || typeof chartRef.current !== 'object') return;
        
        // For order overlays, match by the internal asset name (selectedAsset.name)
        const cleanSymbol = symbol.includes('-') ? symbol.split('-')[0] : symbol;
        const assetOrders = orders.filter(o => o.coin === cleanSymbol);
        
        // Get or initialize the chart instance (only call klinechartsInit once)
        let actualChart = chartInstanceRef.current;
        
        if (!actualChart) {
            const container = chartRef.current._container;
            if (!container) return;
            
            const chartElement = container.querySelector('[k-line-chart-id]') as HTMLElement;
            if (!chartElement) return;
            
            const chartId = chartElement.getAttribute('k-line-chart-id');
            if (!chartId) return;
            
            // Set the id attribute to match the chart id so klinecharts can find it
            const originalId = chartElement.id;
            chartElement.id = chartId;
            
            try {
                actualChart = klinechartsInit(chartElement);
                chartInstanceRef.current = actualChart;
                
                // Set tighter Y-axis gap for better scaling on low-priced assets
                if (actualChart?.setPaneOptions) {
                    actualChart.setPaneOptions({
                        id: 'candle_pane',
                        gap: { top: 0.05, bottom: 0.03 }
                    });
                }
                
                // Set high precision for low-priced assets to improve Y-axis scaling
                // The Y-axis range calculation uses precision to determine minimum range
                if (actualChart?.setPriceVolumePrecision) {
                    const dataList = actualChart.getDataList?.() || [];
                    if (dataList.length > 0) {
                        const lastPrice = dataList[dataList.length - 1]?.close || 0;
                        let precision = 2;
                        if (lastPrice < 0.0001) precision = 8;
                        else if (lastPrice < 0.001) precision = 7;
                        else if (lastPrice < 0.01) precision = 6;
                        else if (lastPrice < 0.1) precision = 6;
                        else if (lastPrice < 1) precision = 5;
                        else if (lastPrice < 10) precision = 4;
                        else if (lastPrice < 100) precision = 3;
                        
                        actualChart.setPriceVolumePrecision(precision, 2);
                    }
                }
            } finally {
                // Restore original id
                if (originalId) {
                    chartElement.id = originalId;
                } else {
                    chartElement.removeAttribute('id');
                }
            }
        }
        
        if (!actualChart || typeof actualChart.createOverlay !== 'function') {
            return;
        }
        
        // Skip overlay updates if no orders
        if (assetOrders.length === 0) {
            // Remove existing overlays when no orders
            try {
                actualChart.removeOverlay({ groupId: 'orderLines' });
            } catch (e) {
                // Ignore
            }
            return;
        }
            
            // Remove old order overlays by group
            try {
                actualChart.removeOverlay({ groupId: 'orderLines' });
            } catch (e) {
                // Ignore
            }
            
            // Create new overlays for each order
            assetOrders.forEach(order => {
                let color = '#2DBD85'; // Green for long/buy
                let label = 'Limit';
                
                // Determine base color by side
                if (order.side === 'SELL') {
                    color = '#E05252'; // Red for short/sell
                }
                
                // Override for special order types
                if (order.isPositionTpsl) {
                    color = '#3b82f6'; // Blue for TP/SL
                    label = 'TP/SL';
                } else if (order.reduceOnly) {
                    color = '#a855f7'; // Purple for reduce only
                    label = 'Reduce';
                }
                
                try {
                    actualChart.createOverlay({
                        name: 'priceLine',
                        id: `order_${order.oid}`,
                        groupId: 'orderLines',
                        lock: true,
                        visible: true,
                        points: [
                            { value: order.limitPx }
                        ],
                        styles: {
                            line: {
                                color: color,
                                size: 1,
                                style: LineType.Dashed,
                                dashedValue: [4, 4]
                            },
                            text: {
                                color: '#ffffff',
                                backgroundColor: color,
                                size: 10
                            }
                        },
                        extendData: `${label} $${order.limitPx.toFixed(2)}`
                    }, 'candle_pane');
                } catch (e) {
                    console.error('[Chart] Failed to create order line:', e);
                }
            });
    }, [orders, symbol]);

    return (
        <div className="h-full w-full relative group">
            <div 
                ref={containerRef} 
                className="h-full w-full transition-opacity duration-200"
                style={{ opacity: chartReady ? 1 : 0 }}
            />
            {showQuickTrade && <QuickTradeWidget currentPrice={initialPrice} symbol={symbol.split('-')[0] || "BTC"} apiCoin={apiCoin} onClose={onHideQuickTrade} />}
        </div>
    )
}

function QuickTradeWidget({ currentPrice: initialPrice, symbol, apiCoin, onClose }: { currentPrice: number, symbol: string, apiCoin: string, onClose?: () => void }) {
    const [position, setPosition] = React.useState({ x: -9999, y: 12 });
    const [isDragging, setIsDragging] = React.useState(false);
    const widgetRef = React.useRef<HTMLDivElement>(null);
    const offsetRef = React.useRef({ x: 0, y: 0 });
    const hasPositioned = React.useRef(false);

    React.useLayoutEffect(() => {
        if (hasPositioned.current || !widgetRef.current) return;
        const parent = widgetRef.current.offsetParent as HTMLElement;
        if (!parent) return;
        const pw = parent.clientWidth;
        const ww = widgetRef.current.offsetWidth;
        if (ww > 0) {
            setPosition({ x: pw - ww - 12, y: 12 });
            hasPositioned.current = true;
        }
    });

    // Data State
    const [bestBid, setBestBid] = React.useState<number>(initialPrice);
    const [bestAsk, setBestAsk] = React.useState<number>(initialPrice);

    // UI State
    const [qty, setQty] = React.useState("0.1");
    const [unit, setUnit] = React.useState<'Asset' | 'USD'>('Asset');
    const [showUnitDropdown, setShowUnitDropdown] = React.useState(false);
    const dropdownRef = React.useRef<HTMLDivElement>(null);

    // Trade execution via useQuickTrade (chase + auto TP/SL)
    const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error', msg: string } | null>(null);
    const { executeQuickTrade, isExecuting, isReady } = useQuickTrade();
    const { readyState, handleTradeAction } = useTradingReadiness();

    // Ref guard for stale data
    const coinRef = React.useRef(apiCoin);
    React.useEffect(() => { coinRef.current = apiCoin; }, [apiCoin]);

    // Subscribe to L2 Data
    React.useEffect(() => {
        let unsubscribe: (() => void) | undefined;

        const initSub = async () => {
            await hyperliquid.initWebSocket();
            const handleData = (data: any) => {
                if (data.coin !== coinRef.current) return;
                const levels = data.levels;
                if (!levels) return;
                const bids = levels[0];
                const asks = levels[1];
                if (bids && bids.length > 0) setBestBid(parseFloat(bids[0].px));
                if (asks && asks.length > 0) setBestAsk(parseFloat(asks[0].px));
            };
            unsubscribe = await hyperliquid.subscribeToL2(apiCoin, handleData) as (() => void) | undefined;
        };
        initSub();

        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowUnitDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => { document.removeEventListener('mousedown', handleClickOutside); };
    }, [apiCoin, initialPrice]);

    // Format price with smart decimals
    const formatPrice = (price: number) => {
        if (price >= 10000) return price.toFixed(1);
        if (price >= 100) return price.toFixed(2);
        if (price >= 1) return price.toFixed(3);
        if (price >= 0.01) return price.toFixed(4);
        return price.toFixed(6);
    };

    // Execute chase order with auto TP/SL
    const executeOrder = async (side: 'buy' | 'sell') => {
        if (readyState !== 'ready') {
            handleTradeAction();
            return;
        }
        if (!isReady) {
            setFeedback({ type: 'error', msg: 'Not ready (API key / account)' });
            setTimeout(() => setFeedback(null), 2000);
            return;
        }
        const qtyNum = parseFloat(qty);
        if (!qtyNum || qtyNum <= 0) {
            setFeedback({ type: 'error', msg: 'Invalid qty' });
            setTimeout(() => setFeedback(null), 2000);
            return;
        }

        setFeedback(null);

        try {
            const price = side === 'buy' ? bestAsk : bestBid;
            // Compute exact asset size from user input
            const assetSize = unit === 'USD' ? qtyNum / price : qtyNum;

            const signal = {
                id: `qt-${Date.now()}`,
                asset: symbol,
                direction: (side === 'buy' ? 'long' : 'short') as 'long' | 'short',
                entry_price: price,
                target_price: 0,
                stop_price: 0,
                confidence: 1,
                signal_type: 'quick_trade',
                source: 'chart_widget'
            };

            const result = await executeQuickTrade(signal, '$0', false, {
                enableChase: true,
                autoSlTp: true,
                overrideSize: assetSize,
            });

            if (result.success) {
                setFeedback({ type: 'success', msg: `${side === 'buy' ? 'Long' : 'Short'} chasing` });
            } else {
                setFeedback({ type: 'error', msg: result.error?.slice(0, 30) || 'Failed' });
            }
        } catch (err: any) {
            setFeedback({ type: 'error', msg: err.message?.slice(0, 30) || 'Error' });
        } finally {
            setTimeout(() => setFeedback(null), 2500);
        }
    };

    // Drag handlers
    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
        const widgetRect = e.currentTarget.getBoundingClientRect();
        offsetRef.current = { x: e.clientX - widgetRect.left, y: e.clientY - widgetRect.top };
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging || !widgetRef.current) return;
        const parent = widgetRef.current.offsetParent as HTMLDivElement;
        if (!parent) return;
        const parentRect = parent.getBoundingClientRect();
        const widgetRect = widgetRef.current.getBoundingClientRect();
        let newX = e.clientX - parentRect.left - offsetRef.current.x;
        let newY = e.clientY - parentRect.top - offsetRef.current.y;
        newX = Math.max(0, Math.min(newX, parentRect.width - widgetRect.width));
        newY = Math.max(0, Math.min(newY, parentRect.height - widgetRect.height));
        setPosition({ x: newX, y: newY });
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        setIsDragging(false);
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    return (
        <>
            <div
                ref={widgetRef}
                className={cn(
                    "absolute z-20 flex items-stretch h-8 rounded-md border border-border bg-card/95 backdrop-blur-sm shadow-lg overflow-visible select-none touch-none",
                    isDragging ? "cursor-grabbing" : "cursor-default"
                )}
                style={{ left: position.x, top: position.y }}
            >
                {/* Drag grip */}
                <div
                    className="flex items-center justify-center w-5 border-r border-border text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                >
                    <svg width="5" height="9" viewBox="0 0 5 9" fill="currentColor">
                        <circle cx="1.5" cy="1.5" r="0.8" /><circle cx="1.5" cy="4.5" r="0.8" /><circle cx="1.5" cy="7.5" r="0.8" />
                        <circle cx="3.5" cy="1.5" r="0.8" /><circle cx="3.5" cy="4.5" r="0.8" /><circle cx="3.5" cy="7.5" r="0.8" />
                    </svg>
                </div>

                {/* Long button */}
                <button
                    onClick={() => executeOrder('buy')}
                    disabled={isExecuting}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2.5 bg-[#0ECB81]/10 hover:bg-[#0ECB81]/20 active:bg-[#0ECB81]/30 border-r border-border transition-colors disabled:opacity-40"
                >
                    <span className="text-xs font-bold text-[#0ECB81] uppercase">Long</span>
                    <span className="text-xs font-mono text-[#0ECB81]/80">{formatPrice(bestAsk)}</span>
                </button>

                {/* Qty input + unit */}
                <div className="flex items-center border-r border-border relative" onPointerDown={(e) => e.stopPropagation()}>
                    <input
                        type="text"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        className="w-14 h-full bg-transparent text-center text-xs text-foreground font-mono px-1 border-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground/30"
                        placeholder="0"
                    />
                    <div className="relative" ref={dropdownRef}>
                        <button
                            onClick={() => setShowUnitDropdown(!showUnitDropdown)}
                            className="flex items-center gap-0.5 h-full px-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground border-l border-border transition-colors"
                        >
                            {unit === 'Asset' ? symbol : 'USD'}
                            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
                        </button>
                        <AnimatePresence>
                            {showUnitDropdown && (
                                <motion.div
                                    className="absolute top-full right-0 mt-1 rounded border border-border bg-card shadow-xl z-50 overflow-hidden min-w-[56px]"
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -4 }}
                                    transition={{ duration: 0.1 }}
                                >
                                    <button
                                        onClick={() => { setUnit('Asset'); setShowUnitDropdown(false); }}
                                        className={cn("w-full px-2 py-1 text-[10px] text-left hover:bg-muted/50 transition-colors", unit === 'Asset' ? "text-foreground" : "text-muted-foreground")}
                                    >
                                        {symbol}
                                    </button>
                                    <button
                                        onClick={() => { setUnit('USD'); setShowUnitDropdown(false); }}
                                        className={cn("w-full px-2 py-1 text-[10px] text-left hover:bg-muted/50 transition-colors", unit === 'USD' ? "text-foreground" : "text-muted-foreground")}
                                    >
                                        USD
                                    </button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Short button */}
                <button
                    onClick={() => executeOrder('sell')}
                    disabled={isExecuting}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 px-2.5 bg-[#F6465D]/10 hover:bg-[#F6465D]/20 active:bg-[#F6465D]/30 border-r border-border transition-colors disabled:opacity-40"
                >
                    <span className="text-xs font-bold text-[#F6465D] uppercase">Short</span>
                    <span className="text-xs font-mono text-[#F6465D]/80">{formatPrice(bestBid)}</span>
                </button>

                {/* Close */}
                <button
                    onClick={() => onClose?.()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center justify-center w-6 text-muted-foreground/50 hover:text-foreground transition-colors"
                >
                    <X className="h-3 w-3" />
                </button>
            </div>

            {/* Feedback toast - floats below widget */}
            <AnimatePresence>
                {(isExecuting || feedback) && (
                    <motion.div
                        className={cn(
                            "absolute z-20 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium shadow-lg",
                            isExecuting && "bg-card border border-border text-muted-foreground",
                            feedback?.type === 'success' && "bg-[#0ECB81]/15 border border-[#0ECB81]/20 text-[#0ECB81]",
                            feedback?.type === 'error' && "bg-[#F6465D]/15 border border-[#F6465D]/20 text-[#F6465D]"
                        )}
                        style={{ left: position.x, top: position.y + 36 }}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                    >
                        {isExecuting && <><Loader2 className="h-3 w-3 animate-spin" /> Executing...</>}
                        {feedback?.type === 'success' && <><Check className="h-3 w-3" /> {feedback.msg}</>}
                        {feedback?.type === 'error' && <><X className="h-3 w-3" /> {feedback.msg}</>}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    )
}
