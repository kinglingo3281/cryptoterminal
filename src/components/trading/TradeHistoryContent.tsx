import { useEffect, useState, useMemo } from 'react'
import { useTradeHistory } from '@/hooks/useTradeHistory'
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TradeHistoryService } from '@/services/TradeHistoryService'

interface TradeHistoryContentProps {
  userAddress: string | null
  onStatsChange?: (stats: { totalFills: number; totalVolume: number; totalFees: number; realizedPnl: number }) => void
}

export function TradeHistoryContent({ userAddress, onStatsChange }: TradeHistoryContentProps) {
  const { fills, isLoading, refresh } = useTradeHistory(userAddress)
  const [currentPage, setCurrentPage] = useState(1)
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all')
  const ITEMS_PER_PAGE = 100

  useEffect(() => {
    if (userAddress && fills.length === 0 && !isLoading) {
      refresh()
    }
  }, [userAddress, fills.length, isLoading, refresh])

  // Filter fills by date range
  const filteredFills = useMemo(() => {
    if (dateRange === 'all') return fills
    
    const now = Date.now()
    const ranges = {
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000
    }
    const cutoff = now - ranges[dateRange]
    return fills.filter(f => f.time >= cutoff)
  }, [fills, dateRange])

  // Calculate stats for filtered fills
  const stats = useMemo(() => {
    return TradeHistoryService.calculateStats(filteredFills)
  }, [filteredFills])

  // Notify parent of stats changes
  useEffect(() => {
    if (onStatsChange) {
      onStatsChange(stats)
    }
  }, [stats, onStatsChange])

  // Pagination
  const totalPages = Math.ceil(filteredFills.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const paginatedFills = filteredFills.slice(startIndex, endIndex)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [dateRange])

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    if (isToday) {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      })
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const formatPrice = (price: number) => {
    if (price < 0.01) return `$${price.toFixed(6)}`
    if (price < 1) return `$${price.toFixed(4)}`
    if (price < 100) return `$${price.toFixed(2)}`
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatPnl = (pnl: number) => {
    if (pnl === 0) return '$0.00'
    const formatted = pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return pnl > 0 ? `+$${formatted}` : `-$${Math.abs(pnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  if (!userAddress) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
        <h3 className="text-sm font-medium">Trade History</h3>
        <p className="text-xs mt-1">Connect wallet to view trade history</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Single Row Controls: Date Range + Stats + Info + Pagination + Refresh */}
      <div className="flex items-center justify-between px-2 py-2 mb-2">
        {/* Date Range Filters */}
        <div className="flex items-center gap-1">
          {(['all', '7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={cn(
                "px-2 py-1 text-xs rounded transition-colors",
                dateRange === range
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
              )}
            >
              {range === 'all' ? 'All' : range.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Showing Info */}
        <div className="text-xs text-muted-foreground">
          {filteredFills.length > 0 ? (
            <>
              Showing {startIndex + 1}-{Math.min(endIndex, filteredFills.length)} of {filteredFills.length} trade{filteredFills.length !== 1 ? 's' : ''}
            </>
          ) : 'No trades'}
        </div>

        {/* Trade Stats */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">TRADES</span>
            <span className="font-mono text-foreground">{stats.totalFills}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">VOL</span>
            <span className="font-mono text-foreground">${stats.totalVolume.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">FEES</span>
            <span className="font-mono text-foreground">${stats.totalFees.toFixed(2)}</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground font-medium">PNL</span>
            <span className={cn(
              "font-mono font-medium",
              stats.realizedPnl > 0 ? "text-trade-green" : stats.realizedPnl < 0 ? "text-trade-red" : "text-foreground"
            )}>
              {stats.realizedPnl > 0 ? '+' : ''}{stats.realizedPnl < 0 ? '-' : ''}${Math.abs(stats.realizedPnl).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Pagination + Refresh */}
        <div className="flex items-center gap-2">
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-1.5 py-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span className="text-xs text-muted-foreground px-2">
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-1.5 py-1 rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}
          <button
            onClick={refresh}
            disabled={isLoading}
            className="px-2 py-1 text-xs rounded bg-secondary hover:bg-secondary/80 text-foreground disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {filteredFills.length === 0 && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <h3 className="text-sm font-medium">No Trades Found</h3>
          <p className="text-xs mt-1">{fills.length > 0 ? 'No trades in selected date range' : 'Your completed trades will appear here'}</p>
        </div>
      )}

      {filteredFills.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background z-10">
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">TIME</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">ASSET</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">SIDE</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">TYPE</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">SIZE</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">PRICE</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">VALUE</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">FEE</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">PNL</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFills.map((fill) => {
                const value = fill.price * fill.size
                return (
                  <tr 
                    key={fill.tid} 
                    className="border-b border-border/50 hover:bg-white/5 transition-colors"
                  >
                    <td className="px-3 py-2 text-muted-foreground font-mono">
                      {formatTime(fill.time)}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {fill.coin}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "font-medium",
                        fill.side === 'BUY' ? "text-trade-green" : "text-trade-red"
                      )}>
                        {fill.side}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-[10px]">
                      {fill.direction || '-'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {fill.size.toFixed(4)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatPrice(fill.price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      ${fill.fee.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className={cn(
                        fill.closedPnl > 0 ? "text-trade-green" : fill.closedPnl < 0 ? "text-trade-red" : "text-muted-foreground"
                      )}>
                        {formatPnl(fill.closedPnl)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {isLoading && fills.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Loading trade history...
          </div>
        </div>
      )}
    </div>
  )
}
