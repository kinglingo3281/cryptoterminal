'use client'

import React, { useState } from 'react'
import { cn } from '@/lib/utils'
import type { FragileWallets } from '@/store/useTrackerStore'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'

interface PreyWalletsProps {
  fragileWallets?: FragileWallets
  symbol: string
}

const formatVolume = (val: number) => {
  if (!val) return '$0'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${val.toFixed(0)}`
}

const formatPrice = (p: number) => {
  if (!p) return '0.00'
  if (p >= 1000) return p.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
  if (p >= 1) return p.toFixed(4)
  return p.toFixed(6)
}

// hold_duration is in hours from API
const formatHoldTime = (hours: number) => {
  if (!hours) return '0m'
  if (hours >= 24) return `${Math.floor(hours / 24)}d`
  if (hours >= 1) return `${Math.floor(hours)}h`
  return `${Math.floor(hours * 60)}m`
}

export function PreyWallets({ fragileWallets, symbol }: PreyWalletsProps) {
  const [expandedWallet, setExpandedWallet] = useState<string | null>(null)
  const [sortCol, setSortCol] = useState<'pnl' | 'stress' | 'leverage' | 'holding'>('pnl')
  const [sortDesc, setSortDesc] = useState(true)

  if (!fragileWallets || !fragileWallets.wallets || fragileWallets.wallets.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted-foreground text-center">No fragile wallets detected</div>
    )
  }

  const wallets = fragileWallets.wallets as any[]

  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDesc(!sortDesc)
    else { setSortCol(col); setSortDesc(true) }
  }

  // Extract values using actual API field names
  const getVal = (w: any, col: string) => {
    const acctVal = w.account_value || 0
    const notional = w.total_notional || 0
    switch (col) {
      case 'pnl': return Math.abs(w.total_pnl || 0)
      case 'stress': return w.margin_usage_pct || 0
      case 'leverage': return acctVal > 0 ? notional / acctVal : 0
      case 'holding': return w.hold_duration || 0
      default: return 0
    }
  }

  const sorted = [...wallets].sort((a, b) => {
    const aVal = getVal(a, sortCol)
    const bVal = getVal(b, sortCol)
    return sortDesc ? bVal - aVal : aVal - bVal
  })

  const SortButton = ({ col, label }: { col: typeof sortCol; label: string }) => (
    <button
      onClick={() => handleSort(col)}
      className={cn(
        "text-xs font-medium transition-colors",
        sortCol === col ? "text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label} {sortCol === col && (sortDesc ? '↓' : '↑')}
    </button>
  )

  return (
    <div className="overflow-hidden h-[420px] flex flex-col">
      {/* Sort Controls */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-background/30">
        <span className="text-xs text-muted-foreground">Sort:</span>
        <SortButton col="pnl" label="PnL" />
        <SortButton col="stress" label="Stress" />
        <SortButton col="leverage" label="Leverage" />
        <SortButton col="holding" label="Hold Time" />
      </div>

      {/* Wallet Table */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-card">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium w-4"></th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Wallet</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Label</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Time</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Lev</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Size</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">PnL</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Balance</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Coin</th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 20).map((w: any, idx: number) => {
              const addr = w.wallet || ''
              const label = w.label || ''
              const acctVal = w.account_value || 0
              const notional = w.total_notional || 0
              const pnl = w.total_pnl || 0
              const leverage = acctVal > 0 ? notional / acctVal : 0
              const holdHours = w.hold_duration || 0
              const stress = w.margin_usage_pct || 0
              const positions = w.positions || []
              const primaryPos = positions.length > 0
                ? positions.reduce((best: any, p: any) => (Math.abs(p.notional || 0) > Math.abs(best.notional || 0) ? p : best), positions[0])
                : null
              const side = primaryPos?.side || (w.net_position >= 0 ? 'LONG' : 'SHORT')
              const sym = primaryPos?.coin || symbol
              const isExpanded = expandedWallet === addr
              const isLong = side === 'LONG'

              return (
                <React.Fragment key={`${addr}-${idx}`}>
                  <tr
                    className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                    onClick={() => addr && setExpandedWallet(isExpanded ? null : addr)}
                  >
                    <td className="py-1.5 px-2">
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </td>
                    <td className="py-1.5 px-2">
                      <a
                        href={`https://hypurrscan.io/address/${addr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {addr?.slice(0, 6)}...{addr?.slice(-3)}
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </td>
                    <td className="py-1.5 px-2">
                      <span className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{label}</span>
                    </td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{formatHoldTime(holdHours)}</td>
                    <td className="py-1.5 px-2 text-right text-muted-foreground">{leverage.toFixed(1)}x</td>
                    <td className={cn("py-1.5 px-2 font-mono", isLong ? 'text-primary' : 'text-destructive')}>
                      {isLong ? '+' : '-'}{formatVolume(notional)} {side.charAt(0)}
                    </td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", pnl >= 0 ? 'text-primary' : 'text-destructive')}>
                      {pnl >= 0 ? '+' : ''}{formatVolume(pnl)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{formatVolume(acctVal)}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{sym}</td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="p-0">
                        <div className="bg-background/50 px-6 py-2 text-xs space-y-1.5">
                          {positions.length > 0 ? positions.map((p: any, pIdx: number) => (
                            <div key={pIdx} className="flex items-center gap-3 flex-wrap">
                              <span className="font-medium text-foreground">{p.coin}</span>
                              <span className={cn("font-mono", p.side === 'LONG' ? 'text-primary' : 'text-destructive')}>
                                {p.side} {formatVolume(p.notional || 0)}
                              </span>
                              <span className="text-muted-foreground">@<span className="font-mono text-foreground">{formatPrice(p.entry || 0)}</span></span>
                              <span className="text-muted-foreground">Liq: <span className="font-mono text-destructive">{formatPrice(p.liq_px || 0)}</span></span>
                              <span className="text-muted-foreground">{p.margin_mode === 'ISOLATED' ? 'ISO' : p.margin_mode || 'CROSS'}</span>
                              <span className={cn("font-mono", (p.pnl || 0) >= 0 ? 'text-primary' : 'text-destructive')}>
                                {(p.pnl || 0) >= 0 ? '+' : ''}{formatVolume(p.pnl || 0)}
                              </span>
                            </div>
                          )) : (
                            <span className="text-muted-foreground">No position details</span>
                          )}
                          <div className="flex items-center gap-4 pt-1 border-t border-border/30">
                            <span className="text-muted-foreground">Margin: <span className={cn("font-medium", stress > 100 ? 'text-destructive' : stress > 50 ? 'text-warning' : 'text-foreground')}>{stress.toFixed(1)}%</span></span>
                            <span className="text-muted-foreground">Net: <span className="font-mono text-foreground">{formatVolume(w.net_position || 0)}</span></span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {wallets.length > 20 && (
        <div className="px-4 py-2 text-xs text-center text-muted-foreground border-t border-border">
          Showing 20 of {wallets.length} wallets
        </div>
      )}
    </div>
  )
}
