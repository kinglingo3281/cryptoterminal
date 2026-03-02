'use client'

import React, { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import type { BreakdownData, BreakdownEntry } from '@/store/useTrackerStore'
import { useTrackerStore } from '@/store/useTrackerStore'
import { ChevronDown, ChevronRight, ExternalLink, Users, Target, Scale } from 'lucide-react'

interface BreakdownTablesProps {
  breakdown?: BreakdownData
  symbol: string
  className?: string
}

type TabType = 'skill' | 'cohort' | 'equity'

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
  if (p >= 1000) return p.toFixed(2)
  if (p >= 1) return p.toFixed(4)
  return p.toFixed(6)
}

export function BreakdownTables({ breakdown, symbol, className }: BreakdownTablesProps) {
  const { zoneMode, setZoneMode, totalsMode, setTotalsMode } = useTrackerStore()
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('trackerBreakdownTab') as TabType) || 'skill'
    }
    return 'skill'
  })
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Persist tab selection
  useEffect(() => {
    localStorage.setItem('trackerBreakdownTab', activeTab)
  }, [activeTab])

  // Smart/Dumb group definitions per table type
  const SMART_KEYS = {
    skill: ['LEGEND', 'ELITE', 'SKILLED', 'SOLID', 'GRINDER', 'SURVIVOR'],
    cohort: ['Money Printer', 'Smart Money', 'Consistent Grinder', 'Humble Earner'],
    equity: ['Leviathan', 'Tidal Whale', 'Whale', 'Small Whale', 'Apex Predator']
  }
  const DUMB_KEYS = {
    skill: ['WEAK', 'BLEEDING', 'LOSER', 'REKT', 'WRECKED'],
    cohort: ['Exit Liquidity', 'Semi-Rekt', 'Full Rekt', 'Giga-Rekt'],
    equity: ['Dolphin', 'Fish', 'Shrimp']
  }

  // Get long/short USD values from entry (zone-aware: hot uses long_usd/short_usd, all uses long_exposure/short_exposure)
  const getLongShort = (d: any, mode: string = zoneMode): { long: number; short: number; net: number } => {
    if (mode === 'all') {
      const longExp = d.long_exposure || 0
      const shortExp = d.short_exposure || 0
      if (longExp || shortExp) return { long: longExp, short: -shortExp, net: longExp - shortExp }
      // Fallback to total_value + net_bias
      const totalVal = d.total_value || 0
      const bias = d.net_bias ?? 50
      return { long: totalVal * (bias / 100), short: -(totalVal * (1 - bias / 100)), net: totalVal * (2 * bias / 100 - 1) }
    }
    // HOT mode: prefer explicit USD fields
    if (d.long_usd || d.short_usd) {
      return { long: d.long_usd || 0, short: d.short_usd || 0, net: d.net_usd || (d.long_usd || 0) - Math.abs(d.short_usd || 0) }
    }
    // Fallback: derive from total_value + net_bias
    const totalVal = d.total_value || 0
    const bias = d.net_bias ?? 50
    return { long: totalVal * (bias / 100), short: -(totalVal * (1 - bias / 100)), net: totalVal * (2 * bias / 100 - 1) }
  }

  // Calculate group delta for alpha indicator (case-insensitive key match)
  const calculateGroupDelta = (data: Record<string, BreakdownEntry> | undefined, keys: string[]) => {
    if (!data) return { longTotal: 0, shortTotal: 0, delta: 0 }
    let totalLong = 0, totalShort = 0
    const upperKeys = keys.map(k => k.toUpperCase())
    for (const [k, d] of Object.entries(data)) {
      if (!upperKeys.includes(k.toUpperCase())) continue
      const ls = getLongShort(d)
      totalLong += ls.long
      totalShort += ls.short
    }
    return { longTotal: totalLong, shortTotal: totalShort, delta: totalLong - totalShort }
  }

  // Calculate alpha indicator (Smart vs Dumb)
  const calculateAlpha = (data: Record<string, BreakdownEntry> | undefined, tableType: TabType) => {
    if (!data) return { value: 0, isAligned: false }
    const smartKeys = SMART_KEYS[tableType]
    const dumbKeys = DUMB_KEYS[tableType]
    const smartGroup = calculateGroupDelta(data, smartKeys)
    const dumbGroup = calculateGroupDelta(data, dumbKeys)
    const signA = smartGroup.delta >= 0 ? 1 : -1
    const signB = dumbGroup.delta >= 0 ? 1 : -1
    const isAligned = signA === signB
    const alphaValue = isAligned 
      ? smartGroup.delta + dumbGroup.delta 
      : smartGroup.delta - dumbGroup.delta
    return { value: alphaValue, isAligned }
  }

  // Check if any breakdown data exists
  const hasAnyData = breakdown && (
    (breakdown.by_label && Object.keys(breakdown.by_label).length > 0) ||
    (breakdown.by_cohort && Object.keys(breakdown.by_cohort).length > 0) ||
    (breakdown.by_size && Object.keys(breakdown.by_size).length > 0)
  )

  if (!breakdown || !hasAnyData) {
    return (
      <div className="p-4 bg-muted/30 rounded-lg border border-border">
        <div className="text-sm font-medium mb-2">Position Breakdown</div>
        <div className="text-sm text-muted-foreground text-center py-4">No breakdown data available</div>
        <div className="text-xs text-muted-foreground/70 text-center">Waiting for tracker data...</div>
      </div>
    )
  }

  const toggleRow = (rowId: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }

  // Skill label ordering (matching old codebase)
  const SKILL_ORDER = ['LEGEND', 'ELITE', 'SKILLED', 'SOLID', 'GRINDER', 'SURVIVOR', 'MM', 'HLP', 'WEAK', 'BLEEDING', 'LOSER', 'NOOB', 'NEW', 'REKT', 'WRECKED']

  // Equity: map dollar-range API keys to display names, with merge groups
  const EQUITY_ORDER: { name: string; keys: string[] }[] = [
    { name: 'Leviathan', keys: ['>$2.5m'] },
    { name: 'Tidal Whale', keys: ['$1m-$2.5m'] },
    { name: 'Whale', keys: ['$250k-$500k', '$500k-$1m'] },
    { name: 'Small Whale', keys: ['$100k-$250k'] },
    { name: 'Apex Predator', keys: ['$50k-$100k'] },
    { name: 'Dolphin', keys: ['$10k-$25k', '$25k-$50k'] },
    { name: 'Fish', keys: ['$1k-$10k'] },
    { name: 'Shrimp', keys: ['<$1k'] },
    { name: 'HLP', keys: ['HLP'] },
  ]

  // Merge multiple API size entries into one named entry
  const mergeEquityEntries = (data: Record<string, any>): [string, any][] => {
    return EQUITY_ORDER.map(({ name, keys }) => {
      const merged: any = { count: 0, total_count: 0, long_count: 0, short_count: 0, long_usd: 0, short_usd: 0, net_usd: 0, total_value: 0, long_exposure: 0, short_exposure: 0, net_bias: 0, in_danger_pct: 0, avg_leverage: 0, top_wallets: [] }
      let totalWeight = 0
      keys.forEach(k => {
        const d = data[k]
        if (!d) return
        merged.count += d.count || 0
        merged.total_count += d.total_count || 0
        merged.long_count += d.long_count || 0
        merged.short_count += d.short_count || 0
        merged.long_usd += d.long_usd || 0
        merged.short_usd += d.short_usd || 0
        merged.net_usd += d.net_usd || 0
        merged.total_value += d.total_value || 0
        merged.long_exposure += d.long_exposure || 0
        merged.short_exposure += d.short_exposure || 0
        merged.avg_leverage += (d.avg_leverage || 0) * (d.count || 0)
        merged.in_danger_pct += (d.in_danger_pct || 0) * (d.count || 0)
        totalWeight += d.count || 0
        if (d.top_wallets) merged.top_wallets = merged.top_wallets.concat(d.top_wallets)
      })
      if (totalWeight > 0) {
        merged.avg_leverage /= totalWeight
        merged.in_danger_pct /= totalWeight
      }
      const total = merged.long_exposure + merged.short_exposure
      merged.net_bias = total > 0 ? (merged.long_exposure / total) * 100 : 50
      merged.net_direction = merged.long_exposure > merged.short_exposure ? 'NET_LONG' : 'NET_SHORT'
      return [name, merged] as [string, any]
    })
  }

  const renderTable = (data: Record<string, BreakdownEntry> | undefined, type: TabType) => {
    if (!data || Object.keys(data).length === 0) {
      return <div className="text-sm text-muted-foreground text-center py-4">No {type} data available</div>
    }

    let allEntries: [string, BreakdownEntry][]

    if (type === 'equity') {
      // Map dollar ranges to named categories with merges
      allEntries = mergeEquityEntries(data).filter(([_, d]: [string, any]) => {
        if (zoneMode === 'all') return (d.total_count || d.count || 0) > 0
        return (d.count || 0) > 0 || (d.long_count || 0) > 0 || (d.short_count || 0) > 0
      })
    } else {
      // Use raw API keys directly, filter out empty entries based on zone mode
      allEntries = Object.entries(data).filter(([_, d]: [string, any]) => {
        if (zoneMode === 'all') return (d.total_count || d.count || 0) > 0
        return (d.count || 0) > 0 || (d.long_count || 0) > 0 || (d.short_count || 0) > 0
      })
    }

    // Sort skill tab by canonical order
    if (type === 'skill') {
      allEntries.sort((a, b) => {
        const ai = SKILL_ORDER.indexOf(a[0])
        const bi = SKILL_ORDER.indexOf(b[0])
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
    }

    const sortedEntries = allEntries

    if (sortedEntries.length === 0) {
      return <div className="text-sm text-muted-foreground text-center py-4">No {totalsMode} {type} data</div>
    }

    // Unified columns for all tabs (matching old codebase)
    const headerLabel = type === 'skill' ? 'Skill' : type === 'cohort' ? 'Cohort' : 'Equity'

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 px-2 text-left font-medium text-muted-foreground">{headerLabel}</th>
              <th className="py-2 px-2 text-right font-medium text-muted-foreground">L/S</th>
              <th className="py-2 px-2 text-right font-medium text-muted-foreground">Net Position</th>
              <th className="py-2 px-2 text-right font-medium text-muted-foreground">Danger</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map(([label, entry]) => {
              const rowId = `${type}-${label}`
              const isExpanded = expandedRows.has(rowId)
              const e = entry as any
              const longCount = zoneMode === 'all' ? Math.round((e.total_count || 0) * ((e.net_bias || 50) / 100)) : (e.long_count || 0)
              const shortCount = zoneMode === 'all' ? (e.total_count || 0) - Math.round((e.total_count || 0) * ((e.net_bias || 50) / 100)) : (e.short_count || 0)
              const ls = getLongShort(e)
              const dangerClass = (entry.in_danger_pct || 0) > 10 ? 'text-warning' : ''
              const isSmartLabel = SMART_KEYS[type]?.some(k => k.toUpperCase() === label.toUpperCase())
              const isHLP = label.toUpperCase() === 'HLP'
              const displayLabel = isHLP ? `\u{1F3DB}\uFE0F ${label}` : label

              return (
                <React.Fragment key={rowId}>
                  <tr 
                    className="hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => entry.top_wallets?.length && toggleRow(rowId)}
                  >
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        {entry.top_wallets?.length ? (
                          isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
                        ) : <span className="w-3" />}
                        <span className="font-medium">{displayLabel}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className="text-primary">{longCount}</span>
                      <span className="text-muted-foreground">/</span>
                      <span className="text-destructive">{shortCount}</span>
                    </td>
                    <td className={cn("py-2 px-2 text-right font-medium", ls.net > 0 ? 'text-primary' : ls.net < 0 ? 'text-destructive' : '')}>
                      {formatVolume(ls.net)}
                    </td>
                    <td className={cn("py-2 px-2 text-right", dangerClass)}>{(entry.in_danger_pct || 0).toFixed(1)}%</td>
                  </tr>
                  
                  {/* Expandable Wallet Details (matching old codebase format) */}
                  {isExpanded && entry.top_wallets && entry.top_wallets.length > 0 && (
                    entry.top_wallets.slice(0, 5).map((w: any, idx) => {
                      const walletAddr = w.wallet || w.addr || ''
                      const hasAddr = walletAddr && walletAddr.length > 10
                      const pnlValue = w.pnl || 0
                      const entryPx = w.entry || 0
                      const liqPx = w.liq || 0
                      const balance = w.balance || 0
                      const holdTime = w.holding_time || 0
                      const holdHours = holdTime > 0 ? (holdTime / 3600).toFixed(1) : '0.0'
                      const side = w.side || (w.is_long ? 'LONG' : 'SHORT')
                      const mode = w.margin_mode || 'CROSS'
                      
                      return (
                        <tr key={`${rowId}-wallet-${idx}`} className="bg-background/50 text-[11px]">
                          <td className="py-1.5 px-2 pl-8" colSpan={4}>
                            <div className="flex items-center gap-3 flex-wrap">
                              {hasAddr ? (
                                <a 
                                  href={`https://hypurrscan.io/address/${walletAddr}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline flex items-center gap-0.5"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {walletAddr.slice(0, 6)}...{walletAddr.slice(-4)}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-muted-foreground">Unknown</span>
                              )}
                              <span className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground">
                                {w.label || 'Unknown'}
                              </span>
                              <span className={cn(side === 'LONG' ? 'text-primary' : 'text-destructive')}>
                                {side}
                              </span>
                              {entryPx > 0 && (
                                <span className="text-muted-foreground font-mono">
                                  @${entryPx >= 1000 ? entryPx.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : entryPx.toFixed(4)}
                                </span>
                              )}
                              {liqPx > 0 && (
                                <span className="text-muted-foreground font-mono">
                                  Liq: ${liqPx >= 1000 ? liqPx.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : liqPx.toFixed(4)}
                                </span>
                              )}
                              <span className="text-muted-foreground">{mode}</span>
                              {balance > 0 && (
                                <span className="text-muted-foreground font-mono">{formatVolume(balance)}</span>
                              )}
                              <span className={cn("font-mono", pnlValue >= 0 ? 'text-primary' : 'text-destructive')}>
                                {formatVolume(pnlValue)}
                              </span>
                              <span className="text-muted-foreground">{holdHours}h</span>
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // Select data based on active tab (zone mode handled per-entry, not separate datasets)
  const getRawData = () => {
    switch (activeTab) {
      case 'skill': return breakdown.by_label
      case 'cohort': return breakdown.by_cohort
      case 'equity': return breakdown.by_size
      default: return undefined
    }
  }

  const rawData = getRawData()
  // For equity, convert merged entries back to a Record for totals/alpha calculations
  const currentData: Record<string, BreakdownEntry> | undefined = activeTab === 'equity' && rawData
    ? Object.fromEntries(mergeEquityEntries(rawData))
    : rawData
  
  // Calculate totals based on mode (all/smart/dumb)
  const calculateTotals = () => {
    if (!currentData) return { long: 0, short: 0, net: 0, count: 0, label: 'All' }
    
    const sumEntries = (entries: [string, BreakdownEntry][]) => {
      let totalLong = 0, totalShort = 0, totalCount = 0
      entries.forEach(([_, e]) => {
        const ls = getLongShort(e as any)
        totalLong += ls.long
        totalShort += ls.short
        const ea = e as any
        totalCount += zoneMode === 'all' ? (ea.total_count || ea.count || 0) : (ea.count ?? ((ea.long_count || 0) + (ea.short_count || 0)))
      })
      return { long: totalLong, short: totalShort, net: totalLong + totalShort, count: totalCount }
    }

    if (totalsMode === 'all') {
      const s = sumEntries(Object.entries(currentData))
      return { ...s, label: 'All' }
    }
    
    const keys = totalsMode === 'smart' ? SMART_KEYS[activeTab] : DUMB_KEYS[activeTab]
    const upperKeys = keys.map(k => k.toUpperCase())
    const filtered = Object.entries(currentData).filter(([k]) => upperKeys.includes(k.toUpperCase()))
    const s = sumEntries(filtered)
    return { 
      ...s,
      label: totalsMode === 'smart' 
        ? (activeTab === 'skill' ? 'Smart' : activeTab === 'cohort' ? 'Winners' : 'Whales')
        : (activeTab === 'skill' ? 'Dumb' : activeTab === 'cohort' ? 'Rekt' : 'Shrimp')
    }
  }
  
  const totals = calculateTotals()
  const alpha = calculateAlpha(currentData, activeTab)

  return (
    <div className={cn("bg-muted/30 rounded-lg border border-border overflow-hidden flex flex-col", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-background/50 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Position Breakdown</span>
          {/* Zone Toggle */}
          <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
            <button
              onClick={() => setZoneMode('hot')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                zoneMode === 'hot' ? "bg-warning/20 text-warning" : "text-muted-foreground hover:text-foreground"
              )}
            >
              HOT {breakdown.hot_zone_pct ? `±${breakdown.hot_zone_pct.toFixed(0)}%` : ''}
            </button>
            <button
              onClick={() => setZoneMode('all')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                zoneMode === 'all' ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              ALL
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Totals Toggle */}
          <div className="flex items-center gap-0.5 bg-muted rounded p-0.5">
            <button
              onClick={() => setTotalsMode('all')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                totalsMode === 'all' ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              ALL
            </button>
            <button
              onClick={() => setTotalsMode('smart')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                totalsMode === 'smart' ? "bg-green-500/20 text-green-500" : "text-muted-foreground hover:text-foreground"
              )}
            >
              SMART
            </button>
            <button
              onClick={() => setTotalsMode('dumb')}
              className={cn(
                "px-2 py-0.5 text-xs rounded transition-colors",
                totalsMode === 'dumb' ? "bg-red-500/20 text-red-500" : "text-muted-foreground hover:text-foreground"
              )}
            >
              DUMB
            </button>
          </div>
          {/* Totals Display */}
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="text-muted-foreground font-medium">{totals.label}{totals.count > 0 ? ` (${totals.count.toLocaleString()})` : ''}</span>
            <span className="text-primary">L: {formatVolume(totals.long)}</span>
            <span className="text-muted-foreground">|</span>
            <span className="text-destructive">S: {formatVolume(totals.short)}</span>
            <span className="text-muted-foreground">|</span>
            <span className={cn("font-medium", totals.net > 0 ? "text-primary" : totals.net < 0 ? "text-destructive" : "")}>
              Δ {formatVolume(totals.net)}
            </span>
            <span className="text-muted-foreground">|</span>
            <span className={cn(
              "font-medium",
              alpha.isAligned ? "text-muted-foreground" : alpha.value > 0 ? "text-green-500" : "text-red-500"
            )}>
              α {formatVolume(alpha.value)}
            </span>
          </div>
        </div>
      </div>

      {/* Zone Stats Bar - compute from current data entries */}
      {(() => {
        const activeData = currentData || {}
        let derivedTotal = 0, derivedLevSum = 0, derivedLevCount = 0
        Object.values(activeData).forEach((e: any) => {
          const cnt = e.count ?? ((e.long_count || 0) + (e.short_count || 0))
          derivedTotal += cnt
          if (e.avg_leverage && cnt > 0) { derivedLevSum += e.avg_leverage * cnt; derivedLevCount += cnt }
        })
        const totalPos = breakdown.total_positions || derivedTotal || 0
        const filteredPos = zoneMode === 'all' ? totalPos : (breakdown.filtered_positions || derivedTotal || 0)
        const avgLev = breakdown.avg_leverage || (derivedLevCount > 0 ? derivedLevSum / derivedLevCount : 0)
        const coverage = breakdown.coverage_pct || (totalPos > 0 ? (filteredPos / totalPos) * 100 : 0)
        const zoneLabel = zoneMode === 'all' ? 'ALL' : `±${(breakdown.hot_zone_pct || 5).toFixed(0)}%`

        return (
          <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-background/30 text-xs">
            <span className="text-muted-foreground">Zone: <span className="text-foreground font-medium">{zoneLabel}</span></span>
            <span className="text-muted-foreground">Positions: <span className="text-foreground font-medium">{derivedTotal.toLocaleString()}</span></span>
            <span className="text-muted-foreground">Avg Lev: <span className="text-foreground font-medium">{avgLev.toFixed(1)}x</span></span>
            <span className="text-muted-foreground">Coverage: <span className="text-foreground font-medium">{coverage.toFixed(1)}%</span></span>
          </div>
        )
      })()}

      {/* Tab Navigation */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('skill')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === 'skill' 
              ? "border-primary text-primary" 
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Target className="w-3 h-3" />
          Skill
        </button>
        <button
          onClick={() => setActiveTab('cohort')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === 'cohort' 
              ? "border-primary text-primary" 
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="w-3 h-3" />
          Cohort
        </button>
        <button
          onClick={() => setActiveTab('equity')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors border-b-2",
            activeTab === 'equity' 
              ? "border-primary text-primary" 
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Scale className="w-3 h-3" />
          Equity
        </button>
      </div>

      {/* Table Content */}
      <div className="p-2">
        {activeTab === 'skill' && renderTable(breakdown.by_label, 'skill')}
        {activeTab === 'cohort' && renderTable(breakdown.by_cohort, 'cohort')}
        {activeTab === 'equity' && renderTable(breakdown.by_size, 'equity')}
      </div>
    </div>
  )
}
