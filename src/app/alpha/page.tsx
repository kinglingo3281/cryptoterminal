"use client"

import { useState, useMemo, useRef, useEffect } from 'react'
import { useTrackerSSE } from '@/hooks/useTrackerSSE'
import { useTrackerStore } from '@/store/useTrackerStore'
import { cn } from '@/lib/utils'
import { ChevronDown, RefreshCw, TrendingUp, TrendingDown, Search, Info } from 'lucide-react'
import { useQuickTrade } from '@/hooks/useQuickTrade'
import { toast } from 'sonner'
import { EVFlowPanel } from '@/components/trading/AlphaDashboard/EVFlowPanel'
import { LiquidationHeatmap } from '@/components/trading/AlphaDashboard/LiquidationHeatmap'
import { StrongSignalBanner } from '@/components/trading/AlphaDashboard/StrongSignalBanner'
import { BreakdownTables } from '@/components/trading/AlphaDashboard/BreakdownTables'
import { PreyWallets } from '@/components/trading/AlphaDashboard/PreyWallets'
import { PositionAlertsTable } from '@/components/trading/AlphaDashboard/PositionAlertsTable'
import { PerpSignalsPanel } from '@/components/trading/AlphaDashboard/PerpSignalsPanel'
import { OrderbookHeatmap } from '@/components/trading/AlphaDashboard/OrderbookHeatmap'

const TRADE_SIZE_PRESETS = ['100', '250', '500', '1000', '2500', '5000']

export default function AlphaPage() {
    const { connectionState, currentData, reconnect, getTimeSinceUpdate } = useTrackerSSE()
    const { 
        selectedSymbol, 
        setSelectedSymbol, 
        getSymbolList 
    } = useTrackerStore()

    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [tradeSize, setTradeSize] = useState('1000')
    const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false)
    const [heatmapTab, setHeatmapTab] = useState<'liq' | 'orderbook'>('liq')
    const [alertsTab, setAlertsTab] = useState<'alerts' | 'prey'>('alerts')
    const [customSize, setCustomSize] = useState('')
    const [isTrading, setIsTrading] = useState(false)
    const [showSizeTooltip, setShowSizeTooltip] = useState(false)
    
    const dropdownRef = useRef<HTMLDivElement>(null)
    const sizeDropdownRef = useRef<HTMLDivElement>(null)
    const sizeInputRef = useRef<HTMLInputElement>(null)
    
    const { executeQuickTrade } = useQuickTrade()

    const symbolList = getSymbolList()

    const filteredSymbols = useMemo(() => {
        if (!searchQuery) return symbolList.slice(0, 50)
        const query = searchQuery.toUpperCase()
        return symbolList.filter(s => s.includes(query)).slice(0, 50)
    }, [symbolList, searchQuery])

    const price = useMemo(() => {
        if (!currentData) return 0
        if (typeof currentData.price === 'number') return currentData.price
        return currentData.price?.mark || currentData.price?.current || 0
    }, [currentData])

    const pct24h = useMemo(() => {
        if (!currentData?.price_change) return 0
        const prevDay = currentData.price_change.prev_day_px
        if (prevDay && prevDay > 0 && price > 0) {
            return ((price - prevDay) / prevDay) * 100
        }
        return currentData.price_change.pct_24h || 0
    }, [currentData, price])

    const formatPrice = (p: number) => {
        if (!p) return '0.00'
        if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        if (p >= 1) return p.toFixed(4)
        return p.toFixed(6)
    }

    const handleSymbolSelect = (symbol: string) => {
        setSelectedSymbol(symbol)
        setDropdownOpen(false)
        setSearchQuery('')
    }

    // Handle custom size input
    const handleCustomSizeChange = (value: string) => {
        // Allow only numbers and one decimal point
        const cleaned = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
        setCustomSize(cleaned)
    }

    const applyCustomSize = () => {
        if (customSize && parseFloat(customSize) > 0) {
            setTradeSize(customSize)
            setCustomSize('')
            setSizeDropdownOpen(false)
        }
    }

    // Quick trade execution
    const handleQuickTrade = async (direction: 'long' | 'short') => {
        if (isTrading || !price) return
        setIsTrading(true)

        try {
            const tradeSignal = {
                id: `quick-${selectedSymbol}-${Date.now()}`,
                asset: selectedSymbol,
                direction,
                entry_price: price,
                confidence: 0.5,
                source: 'alpha-dashboard'
            }

            const result = await executeQuickTrade(tradeSignal as any, `$${tradeSize}`, false, {
                enableChase: true,
                autoSlTp: true
            })

            if (result.success) {
                console.log('[AlphaDash] Trade executed:', result)
            } else {
                console.error('[AlphaDash] Trade failed:', result.error)
                toast.error(`Trade failed: ${result.error}`)
            }
        } catch (error: any) {
            console.error('[AlphaDash] Trade error:', error)
            toast.error(error.message)
        } finally {
            setIsTrading(false)
        }
    }

    // Close dropdowns on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
            if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(e.target as Node)) {
                setSizeDropdownOpen(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const isConnected = connectionState === 'connected'
    const isLoading = connectionState === 'connecting'

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Combined Header Row */}
            <div className="flex items-center gap-4 px-6 py-3 border-b border-border bg-card/50">
                {/* Symbol Selector */}
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-lg transition-colors"
                    >
                        <span className="text-lg font-bold text-foreground">{selectedSymbol}</span>
                        <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", dropdownOpen && "rotate-180")} />
                    </button>

                    {dropdownOpen && (
                        <div className="absolute top-full left-0 mt-2 w-72 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                            <div className="p-3 border-b border-border">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search symbols..."
                                        className="w-full pl-10 pr-4 py-2.5 bg-secondary border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div className="max-h-72 overflow-y-auto">
                                {filteredSymbols.length === 0 ? (
                                    <div className="px-4 py-6 text-center text-sm text-muted-foreground">No symbols found</div>
                                ) : (
                                    filteredSymbols.map(symbol => (
                                        <button
                                            key={symbol}
                                            onClick={() => handleSymbolSelect(symbol)}
                                            className={cn(
                                                "w-full px-4 py-2.5 text-left text-sm hover:bg-muted transition-colors",
                                                symbol === selectedSymbol && "bg-primary/10 text-primary font-medium"
                                            )}
                                        >
                                            {symbol}
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Price Display + Updated Time */}
                <div className="flex items-center gap-3">
                    <span className="text-2xl font-mono font-bold text-foreground">${formatPrice(price)}</span>
                    <span className={cn(
                        "text-sm font-medium px-2.5 py-1 rounded",
                        pct24h >= 0 ? "text-green-500 bg-green-500/10" : "text-red-500 bg-red-500/10"
                    )}>
                        {pct24h >= 0 ? '+' : ''}{pct24h.toFixed(2)}%
                    </span>
                    {currentData?.generated_at && (
                        <span className="text-xs text-muted-foreground">
                            {new Date(currentData.generated_at).toLocaleTimeString()}
                        </span>
                    )}
                </div>

                <div className="flex-1" />

                {/* Connection Status */}
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        isConnected ? "bg-green-500/10 text-green-500" : isLoading ? "bg-yellow-500/10 text-yellow-500" : "bg-destructive/10 text-destructive"
                    )}>
                        <span className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-green-500 animate-pulse" : isLoading ? "bg-yellow-500" : "bg-destructive")} />
                        {isConnected ? 'Live' : isLoading ? '...' : 'Off'}
                    </div>
                    <button
                        onClick={reconnect}
                        disabled={isLoading}
                        className="p-1.5 hover:bg-muted rounded-lg transition-colors disabled:opacity-50"
                        title="Reconnect"
                    >
                        <RefreshCw className={cn("w-3.5 h-3.5 text-muted-foreground", isLoading && "animate-spin")} />
                    </button>
                </div>

                <div className="w-px h-6 bg-border" />

                {/* Trade Size Selector with Custom Input */}
                <div className="relative" ref={sizeDropdownRef}>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setSizeDropdownOpen(!sizeDropdownOpen)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-mono transition-colors"
                        >
                            ${tradeSize}
                            <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", sizeDropdownOpen && "rotate-180")} />
                        </button>
                        <div 
                            className="relative"
                            onMouseEnter={() => setShowSizeTooltip(true)}
                            onMouseLeave={() => setShowSizeTooltip(false)}
                        >
                            <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                            {showSizeTooltip && (
                                <div className="absolute top-full left-0 mt-2 w-48 p-2.5 bg-popover border border-border rounded-lg shadow-xl z-[9999] text-xs">
                                    <p className="text-foreground font-medium mb-1">Order Size (Margin)</p>
                                    <p className="text-muted-foreground">USD margin amount (pre-leverage). Your actual position size = margin × leverage.</p>
                                </div>
                            )}
                        </div>
                    </div>
                    {sizeDropdownOpen && (
                        <div className="absolute top-full right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-xl z-[9999] overflow-hidden">
                            {/* Custom Input */}
                            <div className="p-2 border-b border-border">
                                <div className="flex items-center gap-2">
                                    <span className="text-muted-foreground">$</span>
                                    <input
                                        ref={sizeInputRef}
                                        type="text"
                                        value={customSize}
                                        onChange={(e) => handleCustomSizeChange(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && applyCustomSize()}
                                        placeholder="Custom..."
                                        className="flex-1 bg-transparent text-sm font-mono focus:outline-none"
                                        autoFocus
                                    />
                                    <button
                                        onClick={applyCustomSize}
                                        disabled={!customSize || parseFloat(customSize) <= 0}
                                        className="px-2 py-1 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                                    >
                                        Set
                                    </button>
                                </div>
                            </div>
                            {/* Presets - include current tradeSize if custom */}
                            {(() => {
                                const options = [...TRADE_SIZE_PRESETS]
                                if (!options.includes(tradeSize)) {
                                    options.push(tradeSize)
                                    options.sort((a, b) => parseFloat(a) - parseFloat(b))
                                }
                                return options.map(size => (
                                    <button
                                        key={size}
                                        onClick={() => { setTradeSize(size); setSizeDropdownOpen(false) }}
                                        className={cn(
                                            "w-full px-4 py-2.5 text-left text-sm font-mono hover:bg-muted transition-colors",
                                            size === tradeSize && "bg-primary/10 text-primary"
                                        )}
                                    >
                                        ${size}
                                    </button>
                                ))
                            })()}
                        </div>
                    )}
                </div>

                {/* Quick Trade Buttons */}
                <button 
                    onClick={() => handleQuickTrade('long')}
                    disabled={isTrading || !price}
                    className={cn(
                        "flex items-center gap-2 px-5 py-2.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 font-semibold rounded-lg transition-colors",
                        isTrading && "opacity-50 cursor-wait"
                    )}
                >
                    <TrendingUp className="w-4 h-4" />
                    {isTrading ? '...' : 'Long'}
                </button>
                <button 
                    onClick={() => handleQuickTrade('short')}
                    disabled={isTrading || !price}
                    className={cn(
                        "flex items-center gap-2 px-5 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-semibold rounded-lg transition-colors",
                        isTrading && "opacity-50 cursor-wait"
                    )}
                >
                    <TrendingDown className="w-4 h-4" />
                    {isTrading ? '...' : 'Short'}
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {!currentData ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                        <p className="text-sm text-muted-foreground">Loading {selectedSymbol} data...</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">{symbolList.length} symbols available</p>
                    </div>
                ) : (
                    <>
                        {/* Strong Signal Banner */}
                        <StrongSignalBanner
                            perpSignals={currentData.perp_signals}
                            symbol={selectedSymbol}
                            entryPrice={price}
                            tradeSize={tradeSize}
                            followFadeSignal={currentData.signals?.follow_fade}
                            onTradeSizeChange={setTradeSize}
                        />

                        {/* Two-Column Grid Layout */}
                        <div className="p-6 space-y-6">
                            {/* EVFlow - Full Width */}
                            <EVFlowPanel data={currentData} symbol={selectedSymbol} />

                            {/* Two-Column Grid */}
                            <div className="grid grid-cols-2 gap-6 items-stretch">
                                {/* Left Column: Breakdowns */}
                                <div className="flex flex-col">
                                    <BreakdownTables
                                        className="flex-1"
                                        breakdown={{
                                            by_label: currentData.by_label || currentData.breakdown?.by_label,
                                            by_cohort: currentData.by_cohort || currentData.breakdown?.by_cohort,
                                            by_size: currentData.by_size || currentData.breakdown?.by_size,
                                            by_label_all: currentData.by_label_all || currentData.breakdown?.by_label_all || currentData.by_label,
                                            by_cohort_all: currentData.by_cohort_all || currentData.breakdown?.by_cohort_all || currentData.by_cohort,
                                            by_size_all: currentData.by_size_all || currentData.breakdown?.by_size_all || currentData.by_size,
                                            hot_zone_pct: currentData.breakdown?.hot_zone_pct || currentData.summary?.hot_zone_pct,
                                            total_positions: currentData.breakdown?.total_positions || currentData.summary?.total_positions,
                                            filtered_positions: currentData.breakdown?.filtered_positions || currentData.summary?.filtered_positions,
                                            avg_leverage: currentData.breakdown?.avg_leverage || (currentData as any).summary?.avg_leverage,
                                            coverage_pct: currentData.breakdown?.coverage_pct || (currentData as any).summary?.coverage_pct,
                                        }}
                                        symbol={selectedSymbol}
                                    />
                                </div>

                                {/* Right Column: Heatmaps */}
                                <div className="flex flex-col">
                                    <div className="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden">
                                        <div className="flex border-b border-border">
                                            <button
                                                onClick={() => setHeatmapTab('liq')}
                                                className={cn(
                                                    "flex-1 py-2.5 text-sm font-medium transition-colors",
                                                    heatmapTab === 'liq'
                                                        ? "bg-primary/10 text-primary border-b-2 border-primary"
                                                        : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Liquidation Heatmap
                                            </button>
                                            <button
                                                onClick={() => setHeatmapTab('orderbook')}
                                                className={cn(
                                                    "flex-1 py-2.5 text-sm font-medium transition-colors",
                                                    heatmapTab === 'orderbook'
                                                        ? "bg-primary/10 text-primary border-b-2 border-primary"
                                                        : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                Orderbook Heatmap
                                            </button>
                                        </div>
                                        {heatmapTab === 'liq' ? (
                                            <LiquidationHeatmap data={currentData} symbol={selectedSymbol} price={price} />
                                        ) : (
                                            <OrderbookHeatmap data={currentData.orderbook_heatmap} symbol={selectedSymbol} price={price} />
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Full-Width: Position Alerts / Prey Wallets */}
                            <div className="bg-card border border-border rounded-lg overflow-hidden">
                                <div className="flex border-b border-border">
                                    <button
                                        onClick={() => setAlertsTab('alerts')}
                                        className={cn(
                                            "flex-1 py-2.5 text-sm font-medium transition-colors",
                                            alertsTab === 'alerts'
                                                ? "bg-primary/10 text-primary border-b-2 border-primary"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        Position Alerts
                                    </button>
                                    <button
                                        onClick={() => setAlertsTab('prey')}
                                        className={cn(
                                            "flex-1 py-2.5 text-sm font-medium transition-colors",
                                            alertsTab === 'prey'
                                                ? "bg-primary/10 text-primary border-b-2 border-primary"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        Prey Wallets
                                    </button>
                                </div>
                                {alertsTab === 'alerts' ? (
                                    <PositionAlertsTable positionAlerts={currentData.position_alerts} symbol={selectedSymbol} />
                                ) : (
                                    <PreyWallets fragileWallets={currentData.fragile_wallets} symbol={selectedSymbol} />
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
