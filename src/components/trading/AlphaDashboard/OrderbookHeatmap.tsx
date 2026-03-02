'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { OrderbookHeatmap as OrderbookHeatmapType } from '@/store/useTrackerStore'

interface OrderbookHeatmapProps {
  data?: OrderbookHeatmapType
  symbol: string
  price: number
}

const formatPrice = (p: number) => {
  if (!p) return '0.00'
  if (p >= 1000) return `$${p.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
  if (p >= 1) return `$${p.toFixed(4)}`
  return `$${p.toFixed(6)}`
}

const formatVolume = (val: number) => {
  if (!val) return '$0'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${val.toFixed(0)}`
}

const num = (v: any) => parseFloat(v) || 0

const getConcentrationIcon = (row: any) => {
  const conc = row.concentration || ''
  const top1 = row.top1_pct || 0
  if (conc === 'WHALE') return <span className="text-xs" title={top1 ? `${top1}% from 1 whale` : 'Whale dominated'}>🐋</span>
  if (conc === 'CONCENTRATED') return <span className="text-xs" title={top1 ? `${top1}% from top` : 'Concentrated'}>◉</span>
  return null
}

export function OrderbookHeatmap({ data, symbol, price }: OrderbookHeatmapProps) {
  const [showCount, setShowCount] = useState(5)

  if (!data) {
    return (
      <div className="p-4 text-center">
        <div className="text-sm text-muted-foreground">No orderbook data available</div>
      </div>
    )
  }

  const rawAsks = (data.asks || []) as any[]
  const rawBids = (data.bids || []) as any[]
  const imbalancePct = data.imbalance_pct ?? 0
  const totalAsks = rawAsks.length
  const totalBids = rawBids.length
  const asks = rawAsks.slice(0, showCount)
  const bids = rawBids.slice(0, showCount)

  const getRowValue = (r: any) => num(r.total_value || 0)

  const maxValue = useMemo(() => {
    const allVals = [...rawAsks, ...rawBids].map((r: any) => getRowValue(r))
    return Math.max(...allVals, 1)
  }, [rawAsks, rawBids, price])

  const renderRow = (row: any, type: 'ask' | 'bid', idx: number) => {
    const rowPrice = num(row.price_bucket || row.price)
    const value = getRowValue(row)
    const count = row.order_count || row.count || 0
    const distPct = price > 0 && rowPrice > 0 ? Math.abs((rowPrice - price) / price) * 100 : 0
    const barWidth = maxValue > 0 ? (value / maxValue) * 100 : 0
    const isAsk = type === 'ask'

    return (
      <div key={`${type}-${idx}`} className="flex items-center gap-2 py-1 px-2 hover:bg-muted/30 transition-colors">
        <div className="w-24 text-xs font-mono flex-shrink-0">
          <span className={isAsk ? "text-destructive" : "text-primary"}>{formatPrice(rowPrice)}</span>
        </div>
        <div className="w-10 text-xs text-muted-foreground text-right flex-shrink-0">
          {distPct.toFixed(1)}%
        </div>
        <div className="flex-1 h-4 bg-muted/50 rounded overflow-hidden relative">
          <div
            className={cn("h-full transition-all", isAsk ? "bg-destructive/40" : "bg-primary/40")}
            style={{ width: `${barWidth}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
            {formatVolume(value)}
          </span>
        </div>
        <div className="w-8 text-xs text-muted-foreground text-right flex-shrink-0">{count}</div>
        <div className="w-5 text-center flex-shrink-0">{getConcentrationIcon(row)}</div>
      </div>
    )
  }

  return (
    <div>
      {/* ▲ ASKS */}
      <div className="border-b border-border">
        <div className="px-4 py-1.5 bg-destructive/5 border-b border-border">
          <span className="text-xs font-medium text-destructive">▲ ASKS ({Math.min(showCount, totalAsks)}/{totalAsks})</span>
        </div>
        <div className="py-1">
          {asks.length > 0 ? (
            [...asks].reverse().map((row, idx) => renderRow(row, 'ask', idx))
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">None</div>
          )}
        </div>
      </div>

      {/* ◆ Current Price + Imbalance */}
      <div className="px-4 py-2 border-b border-border bg-warning/10 text-center">
        <span className="text-warning font-medium text-sm">◆ {formatPrice(price)}</span>
        <div className={cn(
          "text-xs font-medium mt-0.5",
          imbalancePct > 0 ? "text-primary" : imbalancePct < 0 ? "text-destructive" : "text-muted-foreground"
        )}>
          Imbalance: {imbalancePct >= 0 ? '+' : ''}{imbalancePct.toFixed(1)}%
        </div>
      </div>

      {/* ▼ BIDS */}
      <div>
        <div className="py-1">
          {bids.length > 0 ? (
            bids.map((row, idx) => renderRow(row, 'bid', idx))
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">None</div>
          )}
        </div>
        <div className="px-4 py-1.5 bg-primary/5 border-t border-border">
          <span className="text-xs font-medium text-primary">▼ BIDS ({Math.min(showCount, totalBids)}/{totalBids})</span>
        </div>
      </div>

      {/* Show more/less */}
      {(totalAsks > 5 || totalBids > 5) && (
        <div
          className="px-4 py-2 border-t border-border text-xs text-center text-muted-foreground cursor-pointer hover:bg-muted/30"
          onClick={() => setShowCount(prev => prev === 5 ? 10 : 5)}
        >
          {showCount === 5 ? `⌄ Show more` : `⌃ Show less`}
        </div>
      )}
    </div>
  )
}
