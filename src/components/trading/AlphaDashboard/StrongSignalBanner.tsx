'use client'

import { useState, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { PerpSignals } from '@/store/useTrackerStore'
import { useQuickTrade } from '@/hooks/useQuickTrade'
import { atrService } from '@/services/ATRService'
import { TrendingUp, TrendingDown, Zap, Info, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'

const BANNER_SIZE_PRESETS = ['100', '250', '500', '750', '1000', '2500', '5000']

interface StrongSignalBannerProps {
  perpSignals?: PerpSignals
  symbol: string
  entryPrice: number
  tradeSize: string
  followFadeSignal?: string
  onTradeSizeChange?: (size: string) => void
}

interface StrongSignalResult {
  key: string
  label: string
  signal: string
  zScore: number
  direction: 'LONG' | 'SHORT'
}

// Get the strongest signal with z >= 2.0
function getStrongSignal(perpSignals?: PerpSignals): StrongSignalResult | null {
  if (!perpSignals) return null

  const defs = [
    { key: 'ofm', label: 'OFM', zKeys: ['z_score'] },
    { key: 'fade', label: 'FADE', zKeys: ['z_score'] },
    { key: 'liq_pnl', label: 'LIQ', zKeys: ['z_score'] },
    { key: 'cvd', label: 'CVD', zKeys: ['z_smart', 'z_dumb'] }
  ] as const

  const threshold = 2.0
  let strongest: StrongSignalResult | null = null

  defs.forEach(def => {
    const entry = perpSignals[def.key as keyof PerpSignals]
    if (!entry?.signal) return

    const signal = String(entry.signal).toUpperCase()
    
    // Determine direction from signal
    let direction: 'LONG' | 'SHORT' | null = null
    if (signal.includes('BULL') || signal.includes('BUY') || signal.includes('LONG')) {
      direction = 'LONG'
    } else if (signal.includes('BEAR') || signal.includes('SELL') || signal.includes('SHORT')) {
      direction = 'SHORT'
    }
    if (!direction) return

    // Get z-score
    let zScore = 0
    for (const zKey of def.zKeys) {
      const val = entry[zKey as keyof typeof entry]
      if (typeof val === 'number' && Math.abs(val) > Math.abs(zScore)) {
        zScore = val
      }
    }

    const absZ = Math.abs(zScore)
    if (absZ < threshold) return

    if (!strongest || absZ > strongest.zScore) {
      strongest = {
        key: def.key,
        label: def.label,
        signal,
        zScore: absZ,
        direction
      }
    }
  })

  return strongest
}

export function StrongSignalBanner({ perpSignals, symbol, entryPrice, tradeSize, followFadeSignal, onTradeSizeChange }: StrongSignalBannerProps) {
  const [isTrading, setIsTrading] = useState(false)
  const [tpsl, setTpsl] = useState<{ tp: number; sl: number; atrPct: number | null }>({ tp: 0, sl: 0, atrPct: null })
  const [showTooltip, setShowTooltip] = useState(false)
  const [sizeTooltip, setSizeTooltip] = useState(false)
  const [sizeDropOpen, setSizeDropOpen] = useState(false)
  const [customSizeInput, setCustomSizeInput] = useState('')
  const sizeDropRef = useRef<HTMLDivElement>(null)
  const { executeQuickTrade } = useQuickTrade()

  // Close size dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sizeDropRef.current && !sizeDropRef.current.contains(e.target as Node)) {
        setSizeDropOpen(false)
      }
    }
    if (sizeDropOpen) {
      document.addEventListener('mousedown', handler)
      return () => document.removeEventListener('mousedown', handler)
    }
  }, [sizeDropOpen])

  const applyCustomSize = () => {
    const cleaned = customSizeInput.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    const val = parseFloat(cleaned)
    if (val > 0) {
      onTradeSizeChange?.(cleaned)
      setCustomSizeInput('')
      setSizeDropOpen(false)
    }
  }

  const strongSignal = getStrongSignal(perpSignals)

  // Parse follow_fade signal for display (e.g. "DEAD_SHORT" -> label="DEAD", dir="SHORT")
  const parsedFollowFade = (() => {
    if (!followFadeSignal) return null
    const parts = followFadeSignal.toUpperCase().replace(/_/g, ' ').trim().split(/\s+/)
    let dir: 'LONG' | 'SHORT' | null = null
    let ffLabel = followFadeSignal.replace(/_/g, ' ')
    if (parts.includes('LONG')) { dir = 'LONG'; ffLabel = parts.filter(p => p !== 'LONG').join(' ') || 'FOLLOW' }
    else if (parts.includes('SHORT')) { dir = 'SHORT'; ffLabel = parts.filter(p => p !== 'SHORT').join(' ') || 'FADE' }
    return dir ? { label: ffLabel, direction: dir } : null
  })()

  const label = parsedFollowFade?.label || strongSignal?.label || ''
  const zScore = strongSignal?.zScore || 0
  const direction = parsedFollowFade?.direction || strongSignal?.direction || 'LONG'
  const isLong = direction === 'LONG'
  const hasStrongPerp = !!strongSignal

  // Fetch ATR-based TP/SL when signal or price changes
  useEffect(() => {
    if ((!strongSignal && !parsedFollowFade) || !entryPrice || entryPrice <= 0) return

    const fetchTPSL = async () => {
      try {
        const result = await atrService.getTPSL(symbol, entryPrice, isLong)
        setTpsl({
          tp: atrService.roundPrice(result.tp, entryPrice),
          sl: atrService.roundPrice(result.sl, entryPrice),
          atrPct: result.atrPct
        })
      } catch (error) {
        // Fallback to 2%
        const fallbackPct = 0.02
        setTpsl({
          tp: isLong ? entryPrice * (1 + fallbackPct * 1.5) : entryPrice * (1 - fallbackPct * 1.5),
          sl: isLong ? entryPrice * (1 - fallbackPct) : entryPrice * (1 + fallbackPct),
          atrPct: null
        })
      }
    }

    fetchTPSL()
  }, [strongSignal, parsedFollowFade?.direction, symbol, entryPrice, isLong])

  if (!strongSignal && !parsedFollowFade) return null

  const slPrice = tpsl.sl || (isLong ? entryPrice * 0.98 : entryPrice * 1.02)
  const tpPrice = tpsl.tp || (isLong ? entryPrice * 1.03 : entryPrice * 0.97)

  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    return p.toFixed(6)
  }

  const handleTrade = async () => {
    if (isTrading) return
    setIsTrading(true)

    try {
      const tradeSignal = {
        id: `strong-${symbol}-${Date.now()}`,
        asset: symbol,
        direction: direction.toLowerCase() as 'long' | 'short',
        entry_price: entryPrice,
        confidence: Math.min(zScore * 25, 95),
        source: label.toLowerCase()
      }

      const result = await executeQuickTrade(tradeSignal as any, tradeSize, true, {
        enableChase: true,
        autoSlTp: true,
        tpPrice: tpPrice,
        slPrice: slPrice
      })

      if (result.success) {
        console.log('[StrongSignal] Trade executed:', result)
      } else {
        console.error('[StrongSignal] Trade failed:', result.error)
        toast.error(`Trade failed: ${result.error}`)
      }
    } catch (error: any) {
      console.error('[StrongSignal] Trade error:', error)
      toast.error(error.message)
    } finally {
      setIsTrading(false)
    }
  }

  return (
    <div className={cn(
      "mx-4 mb-3 p-3 rounded-lg border-2 animate-pulse",
      isLong 
        ? "bg-primary/10 border-primary/50" 
        : "bg-destructive/10 border-destructive/50"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap className={cn("w-5 h-5", isLong ? "text-primary" : "text-destructive")} />
          <span className="font-bold text-sm">{label}</span>
          <span className={cn(
            "px-2 py-0.5 rounded text-xs font-bold",
            isLong ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground"
          )}>
            {direction}
          </span>
          {hasStrongPerp && (
            <span className="px-2 py-0.5 bg-warning/20 text-warning text-xs font-bold rounded animate-pulse">
              STRONG SIGNAL
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs">
          <span>Entry: <span className="font-mono font-medium">${formatPrice(entryPrice)}</span></span>
          <span className="text-destructive">SL: <span className="font-mono">${formatPrice(slPrice)}</span></span>
          <span className="text-primary">TP: <span className="font-mono">${formatPrice(tpPrice)}</span></span>
          <div 
            className="relative"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
          >
            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            {showTooltip && (
              <div className="absolute top-full left-0 mt-2 w-44 p-2.5 bg-popover border border-border rounded-lg shadow-xl z-[9999] text-xs">
                <p className="text-foreground font-medium mb-1">ATR-Based Levels</p>
                <p className="text-muted-foreground">
                  {tpsl.atrPct 
                    ? `TP: 2x ATR (${tpsl.atrPct.toFixed(1)}%), SL: 1.5x ATR` 
                    : 'Using 2% fallback (ATR unavailable)'}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative" ref={sizeDropRef}>
            <button
              onClick={() => setSizeDropOpen(!sizeDropOpen)}
              className="flex items-center gap-1.5 text-xs font-mono bg-muted border border-border px-2 py-1 rounded cursor-pointer hover:bg-muted/80 transition-colors"
            >
              ${tradeSize}
              <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", sizeDropOpen && "rotate-180")} />
            </button>
            {sizeDropOpen && (
              <div className="absolute top-full right-0 mt-1 w-40 bg-card border border-border rounded-lg shadow-xl z-[9999] overflow-hidden">
                {/* Custom Input */}
                <div className="p-1.5 border-b border-border">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <input
                      type="text"
                      value={customSizeInput}
                      onChange={(e) => setCustomSizeInput(e.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'))}
                      onKeyDown={(e) => e.key === 'Enter' && applyCustomSize()}
                      placeholder="Custom..."
                      className="flex-1 bg-transparent text-xs font-mono focus:outline-none min-w-0"
                      autoFocus
                    />
                    <button
                      onClick={applyCustomSize}
                      disabled={!customSizeInput || parseFloat(customSizeInput) <= 0}
                      className="px-1.5 py-0.5 text-[10px] bg-primary/10 text-primary rounded hover:bg-primary/20 disabled:opacity-50"
                    >
                      Set
                    </button>
                  </div>
                </div>
                {/* Presets - include current tradeSize if custom */}
                {(() => {
                  const options = [...BANNER_SIZE_PRESETS]
                  if (!options.includes(tradeSize)) {
                    options.push(tradeSize)
                    options.sort((a, b) => parseFloat(a) - parseFloat(b))
                  }
                  return options.map(s => (
                    <button
                      key={s}
                      onClick={() => { onTradeSizeChange?.(s); setSizeDropOpen(false) }}
                      className={cn(
                        "w-full px-3 py-1.5 text-left text-xs font-mono hover:bg-muted transition-colors",
                        s === tradeSize && "bg-primary/10 text-primary"
                      )}
                    >
                      ${s}
                    </button>
                  ))
                })()}
              </div>
            )}
          </div>
          <div
            className="relative"
            onMouseEnter={() => setSizeTooltip(true)}
            onMouseLeave={() => setSizeTooltip(false)}
          >
            <Info className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            {sizeTooltip && (
              <div className="absolute top-full right-0 mt-2 w-48 p-2.5 bg-popover border border-border rounded-lg shadow-xl z-[9999] text-xs">
                <p className="text-foreground font-medium mb-1">Order Size (Margin)</p>
                <p className="text-muted-foreground">USD margin amount (pre-leverage). Your actual position size = margin × leverage.</p>
              </div>
            )}
          </div>
          <button
            onClick={handleTrade}
            disabled={isTrading}
            className={cn(
              "px-4 py-1.5 rounded-lg text-sm font-bold transition-colors flex items-center gap-1",
              isLong 
                ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                : "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              isTrading && "opacity-50 cursor-wait"
            )}
          >
            {isLong ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {isTrading ? 'Trading...' : direction}
          </button>
        </div>
      </div>
    </div>
  )
}
