'use client'

import { useState, useMemo } from 'react'
import { useTrackerSSE } from '@/hooks/useTrackerSSE'
import { useTrackerStore } from '@/store/useTrackerStore'
import { cn } from '@/lib/utils'
import { ChevronDown, RefreshCw, TrendingUp, TrendingDown, Search } from 'lucide-react'
import { EVFlowPanel } from './EVFlowPanel'
import { LiquidationHeatmap } from './LiquidationHeatmap'
import { StrongSignalBanner } from './StrongSignalBanner'
import { BreakdownTables } from './BreakdownTables'
import { PreyWallets } from './PreyWallets'
import { PositionAlertsTable } from './PositionAlertsTable'
import { PerpSignalsPanel } from './PerpSignalsPanel'
import { OrderbookHeatmap } from './OrderbookHeatmap'

export function AlphaDashboard() {
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
    if (p >= 1000) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    return p.toFixed(6)
  }

  const handleSymbolSelect = (symbol: string) => {
    setSelectedSymbol(symbol)
    setDropdownOpen(false)
    setSearchQuery('')
  }

  const isConnected = connectionState === 'connected'
  const isLoading = connectionState === 'connecting'

  return (
    <div className="h-full w-full flex flex-col bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50">
        {/* Symbol Selector */}
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
          >
            <span className="text-lg font-bold text-foreground">{selectedSymbol}</span>
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", dropdownOpen && "rotate-180")} />
          </button>
          
          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-popover border border-border rounded-lg shadow-xl z-50 overflow-hidden">
              <div className="p-2 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search symbols..."
                    className="w-full pl-8 pr-3 py-2 bg-background border border-border rounded text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {filteredSymbols.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-muted-foreground">No symbols found</div>
                ) : (
                  filteredSymbols.map(symbol => (
                    <button
                      key={symbol}
                      onClick={() => handleSymbolSelect(symbol)}
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors",
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
          <span className="text-xl font-mono font-bold text-foreground">${formatPrice(price)}</span>
          <span className={cn(
            "text-sm font-medium px-2 py-0.5 rounded",
            pct24h >= 0 ? "text-primary bg-primary/10" : "text-destructive bg-destructive/10"
          )}>
            {pct24h >= 0 ? '+' : ''}{pct24h.toFixed(2)}%
          </span>
          {currentData?.generated_at && (
            <span className="text-xs text-muted-foreground">
              {new Date(currentData.generated_at).toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* Connection Status & Refresh */}
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded text-xs",
            isConnected ? "bg-primary/10 text-primary" : isLoading ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
          )}>
            <div className={cn("w-1.5 h-1.5 rounded-full", isConnected ? "bg-primary animate-pulse" : isLoading ? "bg-warning" : "bg-destructive")} />
            {isConnected ? 'Live' : isLoading ? 'Connecting...' : 'Disconnected'}
          </div>
          <button
            onClick={reconnect}
            disabled={isLoading}
            className="p-1.5 hover:bg-muted rounded transition-colors disabled:opacity-50"
            title="Reconnect"
          >
            <RefreshCw className={cn("w-4 h-4 text-muted-foreground", isLoading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Trade Controls */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
        {/* Size Dropdown */}
        <div className="relative">
          <button
            onClick={() => setSizeDropdownOpen(!sizeDropdownOpen)}
            className="flex items-center gap-1 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm font-mono"
          >
            ${tradeSize}
            <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", sizeDropdownOpen && "rotate-180")} />
          </button>
          {sizeDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-32 bg-popover border border-border rounded-lg shadow-xl z-[9999] overflow-hidden">
              {['100', '250', '500', '1000', '2500', '5000'].map(size => (
                <button
                  key={size}
                  onClick={() => { setTradeSize(size); setSizeDropdownOpen(false) }}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm font-mono hover:bg-muted transition-colors",
                    size === tradeSize && "bg-primary/10 text-primary"
                  )}
                >
                  ${size}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Trade Buttons - these are placeholders, actual trading happens in EVFlowPanel */}
        <button className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary/10 hover:bg-primary/20 text-primary font-semibold rounded-lg transition-colors">
          <TrendingUp className="w-4 h-4" />
          Long
        </button>
        <button className="flex-1 flex items-center justify-center gap-2 py-2 bg-destructive/10 hover:bg-destructive/20 text-destructive font-semibold rounded-lg transition-colors">
          <TrendingDown className="w-4 h-4" />
          Short
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!currentData ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
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
            
            {/* Two-Column Grid Layout (matching old codebase) */}
            <div className="p-4 space-y-4">
              {/* EVFlow - Full Width */}
              <EVFlowPanel data={currentData} symbol={selectedSymbol} />

              {/* Two-Column Grid */}
              <div className="grid grid-cols-2 gap-4 items-stretch">
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
                  <div className="flex-1 flex flex-col bg-muted/30 rounded-lg border border-border overflow-hidden">
                    <div className="flex border-b border-border">
                      <button
                        onClick={() => setHeatmapTab('liq')}
                        className={cn(
                          "flex-1 py-2 text-xs font-medium transition-colors",
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
                          "flex-1 py-2 text-xs font-medium transition-colors",
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
