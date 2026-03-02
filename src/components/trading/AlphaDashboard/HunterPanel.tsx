'use client'

import { cn } from '@/lib/utils'
import type { SymbolData } from '@/store/useTrackerStore'
import { Crosshair } from 'lucide-react'

interface HunterPanelProps {
  data: SymbolData
  symbol: string
}

export function HunterPanel({ data }: HunterPanelProps) {
  const heatmap = data.liquidation_heatmap

  const formatCompact = (val: number) => {
    if (!val) return '0'
    const abs = Math.abs(val)
    const sign = val < 0 ? '-' : ''
    if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(1)}M`
    if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`
    return val.toFixed(0)
  }

  const formatPrice = (p: number) => {
    if (!p) return '0.00'
    if (p >= 1000) return p.toFixed(2)
    if (p >= 1) return p.toFixed(4)
    return p.toFixed(6)
  }

  const mostHuntableLong = heatmap?.most_huntable_long
  const mostHuntableShort = heatmap?.most_huntable_short

  return (
    <div className="space-y-4">
      {/* Huntability Section */}
      <div className="p-4 bg-muted/30 rounded-lg border border-border">
        <div className="flex items-center gap-2 mb-3">
          <Crosshair className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">Most Huntable Clusters</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Long Liquidations */}
          <div className={cn(
            "p-3 rounded-lg border",
            mostHuntableLong ? "bg-primary/5 border-primary/20" : "bg-muted/50 border-border"
          )}>
            <div className="text-xs text-muted-foreground mb-1">LONG LIQ</div>
            {mostHuntableLong ? (
              <>
                <div className="text-sm font-mono font-medium text-primary">
                  ${formatPrice(mostHuntableLong.price)}
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-muted-foreground">
                    Hunt: {(mostHuntableLong.huntability * 100).toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground">
                    ${formatCompact(mostHuntableLong.value || 0)}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">No clusters</div>
            )}
          </div>

          {/* Short Liquidations */}
          <div className={cn(
            "p-3 rounded-lg border",
            mostHuntableShort ? "bg-destructive/5 border-destructive/20" : "bg-muted/50 border-border"
          )}>
            <div className="text-xs text-muted-foreground mb-1">SHORT LIQ</div>
            {mostHuntableShort ? (
              <>
                <div className="text-sm font-mono font-medium text-destructive">
                  ${formatPrice(mostHuntableShort.price)}
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-muted-foreground">
                    Hunt: {(mostHuntableShort.huntability * 100).toFixed(0)}%
                  </span>
                  <span className="text-muted-foreground">
                    ${formatCompact(mostHuntableShort.value || 0)}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">No clusters</div>
            )}
          </div>
        </div>
      </div>

      {/* Timestamp */}
      {data.generated_at && (
        <div className="text-xs text-center text-muted-foreground">
          Updated: {new Date(data.generated_at).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}
