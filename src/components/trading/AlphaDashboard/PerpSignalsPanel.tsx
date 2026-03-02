'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { PerpSignals, SymbolData } from '@/store/useTrackerStore'
import { Activity, TrendingUp, TrendingDown, Zap, Info } from 'lucide-react'

// Signal explanations for tooltips
const SIGNAL_TOOLTIPS: Record<string, { title: string; description: string }> = {
  ofm: {
    title: 'Order Flow Momentum',
    description: 'Analyzes aggressive buying/selling pressure. High z-score indicates strong directional flow.'
  },
  fade: {
    title: 'Fade Signal',
    description: 'Identifies exhaustion in price movement. Suggests reversal when retail gets trapped.'
  },
  liq_pnl: {
    title: 'Liquidation PnL',
    description: 'Tracks liquidation-driven price moves. High z-score means significant forced liquidations.'
  },
  cvd: {
    title: 'Cumulative Volume Delta',
    description: 'Smart vs dumb money flow. Compares HL and Binance CVD for divergence signals.'
  }
}

interface PerpSignalsPanelProps {
  data: SymbolData
  symbol: string
}

type TimeframeType = 'cycle' | '15m' | '1h' | '4h' | '24h'

const formatVolume = (val: number) => {
  if (!val) return '$0'
  const abs = Math.abs(val)
  const sign = val < 0 ? '-' : ''
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${val.toFixed(0)}`
}

const getSignalColor = (signal?: string) => {
  if (!signal) return 'neutral'
  const s = signal.toUpperCase()
  if (s.includes('BULL') || s.includes('BUY') || s.includes('LONG')) return 'bullish'
  if (s.includes('BEAR') || s.includes('SELL') || s.includes('SHORT')) return 'bearish'
  return 'neutral'
}

export function PerpSignalsPanel({ data, symbol }: PerpSignalsPanelProps) {
  const [timeframe, setTimeframe] = useState<TimeframeType>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('ofmTimeframe') as TimeframeType) || 'cycle'
    }
    return 'cycle'
  })
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  
  // Persist timeframe selection
  const handleTimeframeChange = (tf: TimeframeType) => {
    setTimeframe(tf)
    localStorage.setItem('ofmTimeframe', tf)
  }
  
  const perpSignals = data.perp_signals
  const ofm = (data as any).ofm // OFM data if available
  const cvd = data.cvd

  // Get signal displays
  const signals = [
    { 
      key: 'ofm', 
      label: 'OFM', 
      signal: perpSignals?.ofm?.signal,
      zScore: perpSignals?.ofm?.z_score,
      explanation: perpSignals?.ofm?.explanation
    },
    { 
      key: 'fade', 
      label: 'FADE', 
      signal: perpSignals?.fade?.signal,
      zScore: perpSignals?.fade?.z_score,
      explanation: perpSignals?.fade?.explanation
    },
    { 
      key: 'liq_pnl', 
      label: 'LIQ', 
      signal: perpSignals?.liq_pnl?.signal,
      zScore: perpSignals?.liq_pnl?.z_score,
      explanation: perpSignals?.liq_pnl?.explanation
    },
    { 
      key: 'cvd', 
      label: 'CVD', 
      signal: perpSignals?.cvd?.signal,
      zScore: perpSignals?.cvd?.z_smart || perpSignals?.cvd?.z_dumb,
      explanation: perpSignals?.cvd?.explanation
    }
  ]

  // Render z-score strength bars
  const renderStrengthBars = (zScore?: number) => {
    const absZ = Math.abs(zScore || 0)
    let bars = 1
    if (absZ >= 3.0) bars = 4
    else if (absZ >= 2.5) bars = 3
    else if (absZ >= 2.0) bars = 2

    return (
      <div className="flex gap-0.5">
        {[1, 2, 3, 4].map(i => (
          <div 
            key={i}
            className={cn(
              "w-1.5 h-3 rounded-sm",
              i <= bars ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="bg-muted/30 rounded-lg border border-border overflow-hidden">
      {/* Header with Timeframe Selector */}
      <div className="flex items-center justify-between px-4 py-3 bg-background/50 border-b border-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">Perp Signals</span>
        </div>
        
        {/* OFM Timeframe Selector */}
        <div className="flex items-center gap-1">
          {(['cycle', '15m', '1h', '4h', '24h'] as TimeframeType[]).map(tf => (
            <button
              key={tf}
              onClick={() => handleTimeframeChange(tf)}
              className={cn(
                "px-2 py-1 text-xs rounded transition-colors",
                timeframe === tf 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              )}
            >
              {tf === 'cycle' ? '~5m' : tf}
            </button>
          ))}
        </div>
      </div>

      {/* Signals Grid */}
      <div className="grid grid-cols-2 gap-px bg-border">
        {signals.map(sig => {
          const color = getSignalColor(sig.signal)
          const colorClass = color === 'bullish' ? 'text-primary' : color === 'bearish' ? 'text-destructive' : 'text-muted-foreground'
          const tooltip = SIGNAL_TOOLTIPS[sig.key]
          
          return (
            <div key={sig.key} className="bg-background p-3 relative">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{sig.label}</span>
                  {tooltip && (
                    <div 
                      className="relative"
                      onMouseEnter={() => setActiveTooltip(sig.key)}
                      onMouseLeave={() => setActiveTooltip(null)}
                    >
                      <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                      {activeTooltip === sig.key && (
                        <div className="absolute top-full left-0 mt-2 w-48 p-2.5 bg-popover border border-border rounded-lg shadow-xl z-[9999] text-xs">
                          <p className="text-foreground font-medium mb-1">{tooltip.title}</p>
                          <p className="text-muted-foreground">{tooltip.description}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {sig.zScore !== undefined && renderStrengthBars(sig.zScore)}
              </div>
              <div className={cn("text-sm font-bold", colorClass)}>
                {sig.signal?.replace(/_/g, ' ') || 'N/A'}
              </div>
              {sig.zScore !== undefined && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  z: {sig.zScore.toFixed(2)}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* OFM Details (if available) */}
      {ofm && (() => {
        // Get timeframe-specific flow counts
        const getFlowData = () => {
          switch (timeframe) {
            case '15m': return { longs: ofm.new_longs_15m, shorts: ofm.new_shorts_15m }
            case '1h': return { longs: ofm.new_longs_1h, shorts: ofm.new_shorts_1h }
            case '4h': return { longs: ofm.new_longs_4h, shorts: ofm.new_shorts_4h }
            case '24h': return { longs: ofm.new_longs_24h, shorts: ofm.new_shorts_24h }
            default: return { longs: ofm.new_longs, shorts: ofm.new_shorts }
          }
        }
        const flow = getFlowData()
        const tfLabel = timeframe === 'cycle' ? '~5m' : timeframe

        return (
          <div className="px-4 py-3 border-t border-border">
            <div className="grid grid-cols-3 gap-3 text-xs">
              {/* New Longs (timeframe-specific) */}
              <div>
                <div className="text-muted-foreground mb-1">New Longs ({tfLabel})</div>
                <div className="font-bold text-primary">
                  +{flow.longs ?? ofm.new_longs ?? 0}
                </div>
              </div>

              {/* New Shorts (timeframe-specific) */}
              <div>
                <div className="text-muted-foreground mb-1">New Shorts ({tfLabel})</div>
                <div className="font-bold text-destructive">
                  +{flow.shorts ?? ofm.new_shorts ?? 0}
                </div>
              </div>

              {/* Conviction */}
              <div>
                <div className="text-muted-foreground mb-1">Conviction</div>
                <div className={cn(
                  "font-bold",
                  (ofm.conviction_score || 0) > 5 ? "text-primary" : 
                  (ofm.conviction_score || 0) < -5 ? "text-destructive" : ""
                )}>
                  {ofm.conviction_score >= 0 ? '+' : ''}{(ofm.conviction_score || 0).toFixed(0)}
                </div>
              </div>
            </div>

            {/* Cycle-only details */}
            {timeframe === 'cycle' && (
              <div className="grid grid-cols-3 gap-3 text-xs mt-2 pt-2 border-t border-border/50">
                <div>
                  <div className="text-muted-foreground mb-1">Net Flow</div>
                  <div className={cn(
                    "font-bold",
                    (ofm.net_long_flow - ofm.net_short_flow) >= 0 ? "text-primary" : "text-destructive"
                  )}>
                    {formatVolume((ofm.net_long_flow || 0) - (ofm.net_short_flow || 0))}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Smart Flow</div>
                  <div className={cn(
                    "font-bold",
                    (ofm.smart_flow_value || 0) >= 0 ? "text-primary" : "text-destructive"
                  )}>
                    {formatVolume(ofm.smart_flow_value || 0)}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Flipped</div>
                  <div className="font-bold">
                    <span className="text-primary">↑{ofm.flipped_to_long || 0}</span>
                    {' / '}
                    <span className="text-destructive">↓{ofm.flipped_to_short || 0}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Flow Bar */}
            {(ofm.net_long_flow || ofm.net_short_flow) && (
              <div className="mt-3">
                <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                  <div 
                    className="bg-primary transition-all"
                    style={{ 
                      width: `${Math.abs(ofm.net_long_flow || 0) / (Math.abs(ofm.net_long_flow || 0) + Math.abs(ofm.net_short_flow || 0)) * 100}%` 
                    }}
                  />
                  <div 
                    className="bg-destructive transition-all"
                    style={{ 
                      width: `${Math.abs(ofm.net_short_flow || 0) / (Math.abs(ofm.net_long_flow || 0) + Math.abs(ofm.net_short_flow || 0)) * 100}%` 
                    }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span className="text-primary">{formatVolume(ofm.net_long_flow || 0)}</span>
                  <span className="text-destructive">{formatVolume(ofm.net_short_flow || 0)}</span>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* CVD Details */}
      {cvd?.multi_exchange && (
        <div className="px-4 py-3 border-t border-border">
          <div className="text-xs text-muted-foreground mb-2">Multi-Exchange CVD</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span>HL CVD 5m:</span>
              <span className={cn(
                "font-mono",
                (cvd.hl_cvd_5m || 0) >= 0 ? "text-primary" : "text-destructive"
              )}>
                {formatVolume(cvd.hl_cvd_5m || 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Binance 5m:</span>
              <span className={cn(
                "font-mono",
                (cvd.binance_cvd_5m || 0) >= 0 ? "text-primary" : "text-destructive"
              )}>
                {formatVolume(cvd.binance_cvd_5m || 0)}
              </span>
            </div>
          </div>
          {cvd.cvd_divergence && (
            <div className="mt-2 px-2 py-1 bg-warning/10 text-warning text-xs rounded">
              ⚠️ CVD Divergence: {cvd.cvd_divergence_type}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
