"use client"

import { useState } from "react"
import { FundingService } from "@/services/FundingService"

interface FundingHeaderProps {
  pairSize: number
  onSizeChange: (size: number) => void
  countdown: string
  lastFetch: Date | null
  loading: boolean
  onRefresh: () => void
}

export function FundingHeader({
  pairSize,
  onSizeChange,
  countdown,
  lastFetch,
  loading,
  onRefresh
}: FundingHeaderProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const lastFetchText = lastFetch
    ? FundingService.formatTimeAgo(lastFetch.getTime())
    : 'Never'

  return (
    <div className="px-4 py-3 border-b border-border bg-secondary/30">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Size: $
          </label>
          <div className="relative">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground cursor-help"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              ?
            </span>
            {showTooltip && (
              <div className="absolute top-full left-0 mt-1 w-52 p-2.5 bg-popover border border-border rounded-lg shadow-xl z-[9999] text-xs">
                <p className="text-foreground font-medium mb-1">Notional Position Size</p>
                <p className="text-muted-foreground leading-relaxed">Size after leverage is applied. This is the total position value per leg, not the margin used. Total exposure is 2x this value (long + short).</p>
              </div>
            )}
          </div>
          <input
            type="number"
            value={pairSize}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            min={10}
            max={100000}
            className="w-24 px-2 py-1 text-xs bg-input border border-border rounded text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs px-2 py-1 bg-primary/10 border border-primary/20 rounded text-primary font-medium">
            Total: ${pairSize * 2}
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Next Funding:</span>
            <span className="text-xs font-mono font-semibold text-foreground px-2 py-1 bg-secondary border border-border rounded">
              {countdown}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" title={lastFetch?.toLocaleTimeString()}>
              Last: {lastFetchText}
            </span>
            <button
              onClick={onRefresh}
              disabled={loading}
              className="px-3 py-1 text-xs font-medium bg-primary/15 border border-primary/30 rounded text-primary hover:bg-primary/25 transition-colors disabled:opacity-50"
            >
              {loading ? 'Fetching...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
