'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTrackerStore } from '@/store/useTrackerStore'
import type { SymbolData, LiquidationLevel } from '@/store/useTrackerStore'
import { ExternalLink } from 'lucide-react'

interface LiquidationHeatmapProps {
  data: SymbolData
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

const getConcentrationIcon = (conc?: string, top1Pct?: number) => {
  if (conc === 'WHALE') return <span className="text-xs" title={top1Pct ? `${top1Pct}% from 1 whale` : 'Whale dominated'}>🐋</span>
  if (conc === 'CONCENTRATED') return <span className="text-xs" title={top1Pct ? `${top1Pct}% from top` : 'Concentrated'}>◉</span>
  return null
}

export function LiquidationHeatmap({ data, price }: LiquidationHeatmapProps) {
  const { totalsMode } = useTrackerStore()
  const [showCount, setShowCount] = useState(5)
  const [expandedLiqRow, setExpandedLiqRow] = useState<string | null>(null)

  const heatmap = data.liquidation_heatmap

  const { longLiqs, shortLiqs } = useMemo(() => {
    if (!heatmap) return { longLiqs: [], shortLiqs: [] }
    return {
      longLiqs: (heatmap.long_liquidations || []).slice(0, showCount),
      shortLiqs: (heatmap.short_liquidations || []).slice(0, showCount),
    }
  }, [heatmap, showCount])

  const totalLongs = heatmap?.long_liquidations?.length || 0
  const totalShorts = heatmap?.short_liquidations?.length || 0

  const maxValue = useMemo(() => {
    const allValues = [...longLiqs, ...shortLiqs].map(l => l.total_value || 0)
    return Math.max(...allValues, 1)
  }, [longLiqs, shortLiqs])

  if (!heatmap || (longLiqs.length === 0 && shortLiqs.length === 0)) {
    return (
      <div className="p-4 text-center">
        <div className="text-sm text-muted-foreground">No liquidation data available</div>
      </div>
    )
  }

  const renderRow = (liq: LiquidationLevel, type: 'long' | 'short', idx: number) => {
    if (!liq) return null
    const liqPrice = Number((liq as any).price_bucket || liq.price) || 0
    const value = liq.total_value || 0
    const count = (liq as any).count || liq.top_wallets?.length || 0
    const distPct = price > 0 && liqPrice > 0 ? Math.abs((liqPrice - price) / price) * 100 : 0
    const barWidth = maxValue > 0 ? (value / maxValue) * 100 : 0
    const isLong = type === 'long'
    const rowId = `${type}-${idx}`
    const isRowExpanded = expandedLiqRow === rowId
    const hasWallets = liq.top_wallets && liq.top_wallets.length > 0

    return (
      <div key={rowId}>
        <div
          className={cn("flex items-center gap-2 py-1 px-2 transition-colors", hasWallets ? "cursor-pointer hover:bg-muted/30" : "")}
          onClick={() => hasWallets && setExpandedLiqRow(isRowExpanded ? null : rowId)}
        >
          <div className="w-24 text-xs font-mono flex-shrink-0">
            <span className={isLong ? "text-primary" : "text-destructive"}>{formatPrice(liqPrice)}</span>
          </div>
          <div className="w-10 text-xs text-muted-foreground text-right flex-shrink-0">
            {distPct.toFixed(1)}%
          </div>
          <div className="flex-1 h-4 bg-muted/50 rounded overflow-hidden relative">
            <div
              className={cn("h-full transition-all", isLong ? "bg-primary/40" : "bg-destructive/40")}
              style={{ width: `${barWidth}%` }}
            />
            <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
              {formatVolume(value)}
            </span>
          </div>
          <div className="w-8 text-xs text-muted-foreground text-right flex-shrink-0">{count}</div>
          <div className="w-5 text-center flex-shrink-0">{getConcentrationIcon(liq.concentration, liq.top1_pct)}</div>
        </div>

        {/* Expanded wallet details */}
        {isRowExpanded && hasWallets && (
          <div className="mx-2 mb-1 p-2 bg-background/50 rounded border border-border/50 text-[11px]">
            <div className="grid gap-1.5">
              {liq.top_wallets!.slice(0, 5).map((w, wIdx) => {
                const holdHrs = w.holding_time ? (w.holding_time / 3600).toFixed(1) : '0.0'
                const mode = w.margin_mode === 'ISOLATED' ? 'ISO' : (w.margin_mode || 'CROSS')
                return (
                  <div key={wIdx} className="flex items-center gap-2 flex-wrap">
                    <a
                      href={`https://hypurrscan.io/address/${w.addr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {w.addr?.slice(0, 6)}...{w.addr?.slice(-4)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-muted-foreground font-mono">{formatVolume(w.value)}</span>
                    <span className="text-muted-foreground font-mono">@{formatPrice(w.entry)}</span>
                    <span className="text-muted-foreground font-mono">{formatPrice(w.liq)}</span>
                    <span className="text-muted-foreground">{mode}</span>
                    <span className="text-muted-foreground font-mono">{formatVolume(w.balance)}</span>
                    {w.label && <span className="text-muted-foreground">{w.label}</span>}
                    {w.pnl_cohort && <span className="text-muted-foreground">{w.pnl_cohort}</span>}
                    <span className="text-muted-foreground">{holdHrs}h</span>
                    <span className={cn("font-mono", w.pnl >= 0 ? "text-primary" : "text-destructive")}>
                      {w.pnl >= 0 ? '+' : ''}{formatVolume(w.pnl)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* ▲ SHORT LIQUIDATIONS */}
      <div className="border-b border-border">
        <div className="px-4 py-1.5 bg-destructive/5 border-b border-border">
          <span className="text-xs font-medium text-destructive">▲ SHORT LIQUIDATIONS ({Math.min(showCount, totalShorts)}/{totalShorts})</span>
        </div>
        <div className="py-1">
          {shortLiqs.length > 0 ? (
            [...shortLiqs].reverse().map((liq, idx) => renderRow(liq, 'short', idx))
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">None</div>
          )}
        </div>
      </div>

      {/* ◆ Current Price */}
      <div className="px-4 py-2 border-b border-border bg-warning/10 text-center">
        <span className="text-warning font-medium text-sm">◆ {formatPrice(price)}</span>
      </div>

      {/* ▼ LONG LIQUIDATIONS */}
      <div>
        <div className="py-1">
          {longLiqs.length > 0 ? (
            longLiqs.map((liq, idx) => renderRow(liq, 'long', idx))
          ) : (
            <div className="text-xs text-muted-foreground text-center py-2">None</div>
          )}
        </div>
        <div className="px-4 py-1.5 bg-primary/5 border-t border-border">
          <span className="text-xs font-medium text-primary">▼ LONG LIQUIDATIONS ({Math.min(showCount, totalLongs)}/{totalLongs})</span>
        </div>
      </div>

      {/* Show more/less */}
      {(totalLongs > 5 || totalShorts > 5) && (
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
