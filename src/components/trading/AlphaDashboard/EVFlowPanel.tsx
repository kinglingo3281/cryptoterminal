'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { SymbolData, EVFlowData, FlowScore } from '@/store/useTrackerStore'
import { AlertTriangle, ChevronDown } from 'lucide-react'
import { useQuickTrade } from '@/hooks/useQuickTrade'
import { usePositionsStore } from '@/store/usePositionsStore'
import { toast } from 'sonner'

interface EVFlowPanelProps {
  data: SymbolData
  symbol: string
}

export function EVFlowPanel({ data, symbol }: EVFlowPanelProps) {
  const [tradeSize, setTradeSize] = useState('1000')
  const [sizeDropdownOpen, setSizeDropdownOpen] = useState(false)
  const [isTrading, setIsTrading] = useState(false)
  const { executeQuickTrade } = useQuickTrade()
  const positions = usePositionsStore(state => state.positions)
  const accountSummary = usePositionsStore(state => state.accountSummary)
  
  // Extract data early so it can be used in handlers
  const evflow: Partial<EVFlowData> = data.evflow || {}
  const flowScore: Partial<FlowScore> | undefined = data.flow_score
  const cvd = data.cvd
  
  // Get current position for this symbol
  const currentPosition = positions.find(p => p.coin === symbol)
  
  // Handle close position
  const handleClosePosition = async () => {
    if (!currentPosition || isTrading) return
    
    setIsTrading(true)
    try {
      // Close position by trading in opposite direction
      const closeDirection = currentPosition.side === 'LONG' ? 'short' : 'long'
      const signal = {
        id: `close-${symbol}-${Date.now()}`,
        asset: symbol,
        direction: closeDirection as 'long' | 'short',
        entry_price: typeof data.price === 'number' ? data.price : (data.price?.mark || data.price?.current || 0),
        confidence: 100,
        source: 'close'
      }
      
      // Use the position size for closing
      const closeSize = `$${Math.abs(currentPosition.size * currentPosition.entryPrice).toFixed(0)}`
      const result = await executeQuickTrade(signal as any, closeSize, false, {
        isClose: true,
        enableChase: false,
        autoSlTp: false
      })
      
      if (result.success) {
        console.log('[EVFlow] Position closed:', result)
      } else {
        console.error('[EVFlow] Close failed:', result.error)
        toast.error(`Close failed: ${result.error}`)
      }
    } catch (error: any) {
      console.error('[EVFlow] Close error:', error)
      toast.error(error.message)
    } finally {
      setIsTrading(false)
    }
  }

  // Handle quick trade execution
  const handleQuickTrade = async (direction: string) => {
    if (isTrading || direction === 'NEUTRAL') return
    
    setIsTrading(true)
    try {
      const signal = {
        id: `evflow-${symbol}-${Date.now()}`,
        asset: symbol,
        direction: direction.toLowerCase() as 'long' | 'short',
        entry_price: typeof data.price === 'number' ? data.price : (data.price?.mark || data.price?.current || 0),
        confidence: evflow?.confidence || 50,
        source: 'evflow'
      }
      
      const result = await executeQuickTrade(signal as any, tradeSize, true, {
        enableChase: true,
        autoSlTp: true
      })
      
      if (result.success) {
        console.log('[EVFlow] Trade executed:', result)
      } else {
        console.error('[EVFlow] Trade failed:', result.error)
        toast.error(`Trade failed: ${result.error}`)
      }
    } catch (error: any) {
      console.error('[EVFlow] Trade error:', error)
      toast.error(error.message)
    } finally {
      setIsTrading(false)
    }
  }

  // Check what data sections are available
  const hasEvflowData = evflow.available || evflow.score !== undefined || evflow.signal !== undefined || Object.keys(evflow).length > 0
  const hasFlowScore = !!flowScore?.available
  const hasCvd = !!cvd?.multi_exchange

  // Use EVFlow data or fall back to FlowScore
  const score = hasEvflowData ? (evflow.score || 0) : (flowScore?.score || 0)
  const signal = hasEvflowData ? (evflow.signal || 'NEUTRAL') : hasFlowScore ? (flowScore?.signal || 'NEUTRAL') : 'NEUTRAL'
  const confidence = hasEvflowData ? (evflow.confidence || 50) : hasFlowScore ? (flowScore?.confidence || 50) : 50
  const aligned = evflow.aligned || false
  const diverging = evflow.diverging || false
  const components = evflow.components || { evscore: 0, cvd: 0, qim: 0 }
  const showEvflowCard = hasEvflowData || hasFlowScore

  const signalText = signal.replace(/_/g, ' ')
  const tradeDirection = score > 0 ? 'LONG' : score < 0 ? 'SHORT' : 'NEUTRAL'
  const isNeutral = tradeDirection === 'NEUTRAL'

  const getSignalClass = () => {
    if (score > 0) return 'text-primary bg-primary/10 border-primary/30'
    if (score < 0) return 'text-destructive bg-destructive/10 border-destructive/30'
    return 'text-muted-foreground bg-muted/50 border-border'
  }

  const renderStrengthBars = () => {
    const absScore = Math.abs(score)
    let bars = 1
    if (absScore >= 75) bars = 4
    else if (absScore >= 50) bars = 3
    else if (absScore >= 25) bars = 2

    const barClass = score > 0 ? 'bg-primary' : score < 0 ? 'bg-destructive' : 'bg-muted-foreground'

    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={cn(
              "w-2 h-4 rounded-sm transition-colors",
              i <= bars ? barClass : 'bg-muted'
            )}
          />
        ))}
      </div>
    )
  }

  const formatDelta = (val: number) => {
    if (!val) return '0'
    const sign = val >= 0 ? '+' : ''
    if (Math.abs(val) >= 1000000) return `${sign}${(val / 1000000).toFixed(1)}M`
    if (Math.abs(val) >= 1000) return `${sign}${(val / 1000).toFixed(1)}K`
    return `${sign}${val.toFixed(0)}`
  }

  const formatCompact = (val: number) => {
    if (!val) return '0'
    const abs = Math.abs(val)
    const sign = val < 0 ? '-' : ''
    if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M`
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`
    return val.toFixed(0)
  }

  return (
    <div className="space-y-4">
      {/* EVFlow / FlowScore Signal Card (only if evflow or flowscore data exists) */}
      {showEvflowCard && (
        <>
          {/* Divergence Warning */}
          {diverging && (
            <div className="flex items-center gap-2 p-3 bg-warning/10 border border-warning/30 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <span className="text-sm text-warning">
                {evflow.divergence_warning || 'EVScore and CVD disagree'}
              </span>
            </div>
          )}

          {/* Main Signal Card */}
          <div className={cn("p-4 rounded-lg border", getSignalClass())}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold">{signalText}</span>
                {aligned && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary/20 text-primary rounded">
                    ALIGNED
                  </span>
                )}
              </div>
              {renderStrengthBars()}
            </div>

            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Confidence: <span className="font-medium text-foreground">{confidence}%</span>
              </div>
              {currentPosition ? (
                <div className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium",
                  currentPosition.unrealizedPnl >= 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                )}>
                  <div className="flex items-center gap-2">
                    <span className={currentPosition.side === 'LONG' ? "text-primary" : "text-destructive"}>
                      {currentPosition.side}
                    </span>
                    <span>{Math.abs(currentPosition.size).toFixed(4)}</span>
                    <span className={currentPosition.unrealizedPnl >= 0 ? "text-primary" : "text-destructive"}>
                      {currentPosition.unrealizedPnl >= 0 ? '+' : ''}${currentPosition.unrealizedPnl.toFixed(2)}
                    </span>
                    <button
                      onClick={() => handleClosePosition()}
                      className="ml-1 px-1.5 py-0.5 bg-muted hover:bg-muted/80 rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Close Position"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  disabled={isNeutral || isTrading}
                  onClick={() => handleQuickTrade(tradeDirection)}
                  className={cn(
                    "px-4 py-2 text-sm font-semibold rounded-lg transition-colors",
                    score > 0 
                      ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                      : score < 0 
                        ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        : "bg-muted text-muted-foreground cursor-not-allowed",
                    isTrading && "opacity-50 cursor-wait"
                  )}
                >
                  {isTrading ? 'Trading...' : isNeutral ? 'NEUTRAL' : `${tradeDirection} ${symbol}`}
                </button>
              )}
            </div>
          </div>

          {/* Component Chips */}
          {hasEvflowData && (
            <div className="flex flex-wrap gap-2">
              <div className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium",
                components.evscore > 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
              )}>
                <span className="text-xs text-muted-foreground">EV</span>
                <span>{components.evscore >= 0 ? '+' : ''}{components.evscore.toFixed(0)}</span>
              </div>
              <div className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium",
                components.cvd > 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
              )}>
                <span className="text-xs text-muted-foreground">CVD</span>
                <span>{components.cvd >= 0 ? '+' : ''}{components.cvd.toFixed(0)}</span>
              </div>
              <div className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium",
                components.qim > 0 ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
              )}>
                <span className="text-xs text-muted-foreground">QIM</span>
                <span>{components.qim >= 0 ? '+' : ''}{components.qim.toFixed(0)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-muted">
                <span className="text-xs text-muted-foreground">Conf</span>
                <span>{confidence}%</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Flow Score Section */}
      {flowScore?.available && (
        <div className="p-3 bg-muted/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Flow Score</span>
            <div className={cn(
              "px-2 py-0.5 rounded text-sm font-medium",
              (flowScore.score || 0) >= 30 ? "bg-primary/10 text-primary" : 
              (flowScore.score || 0) <= -30 ? "bg-destructive/10 text-destructive" : 
              "bg-muted text-muted-foreground"
            )}>
              {(flowScore.score || 0) >= 0 ? '+' : ''}{flowScore.score?.toFixed(0) || 0}
              <span className="ml-1.5 text-xs">{flowScore.signal?.replace(/_/g, ' ')}</span>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div className="text-center">
              <div className="text-muted-foreground">Spot</div>
              <div className="font-mono">{flowScore.inputs?.spot_5m}/{flowScore.inputs?.spot_15m}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Perp</div>
              <div className="font-mono">{flowScore.inputs?.perp_5m}/{flowScore.inputs?.perp_15m}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">OI</div>
              <div className="font-mono">{flowScore.inputs?.oi}</div>
            </div>
            <div className="text-center">
              <div className="text-muted-foreground">Price</div>
              <div className="font-mono">{flowScore.inputs?.price}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span className="text-muted-foreground">Conf: {flowScore.confidence}%</span>
            <span className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground">{flowScore.tier}</span>
          </div>
        </div>
      )}

      {/* Multi-Exchange CVD */}
      {cvd?.multi_exchange && (
        <div className="grid grid-cols-2 gap-3">
          {/* Spot Pool */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">SPOT</span>
              <span className={cn(
                "text-sm font-mono font-medium",
                (cvd.multi_exchange.spot?.['5m']?.value || 0) >= 0 ? "text-primary" : "text-destructive"
              )}>
                {formatDelta(cvd.multi_exchange.spot?.['5m']?.value || 0)}
              </span>
            </div>
            {cvd.multi_exchange.spot?.breakdown && (
              <div className="space-y-1">
                {Object.entries(cvd.multi_exchange.spot.breakdown).slice(0, 4).map(([ex, data]) => (
                  <div key={ex} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground uppercase">{ex}</span>
                    <span className={cn(
                      "font-mono",
                      data.value >= 0 ? "text-primary" : "text-destructive"
                    )}>
                      {formatDelta(data.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Perp Pool */}
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">PERP</span>
              <span className={cn(
                "text-sm font-mono font-medium",
                (cvd.multi_exchange.perp?.['5m']?.value || 0) >= 0 ? "text-primary" : "text-destructive"
              )}>
                {formatDelta(cvd.multi_exchange.perp?.['5m']?.value || 0)}
              </span>
            </div>
            {cvd.multi_exchange.perp?.breakdown && (
              <div className="space-y-1">
                {Object.entries(cvd.multi_exchange.perp.breakdown).slice(0, 4).map(([ex, data]) => (
                  <div key={ex} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground uppercase">{ex}</span>
                    <span className={cn(
                      "font-mono",
                      data.value >= 0 ? "text-primary" : "text-destructive"
                    )}>
                      {formatDelta(data.value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


    </div>
  )
}
