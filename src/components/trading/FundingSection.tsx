"use client"

import { useState } from "react"
import { useFundingRates } from "@/hooks/useFundingRates"
import { usePositionsStore } from "@/store/usePositionsStore"
import { FundingHeader } from "./FundingHeader"
import { FundingTable } from "./FundingTable"
import { HistoricPairsSection } from "./HistoricPairsSection"

export function FundingSection() {
  const { pairs, loading, lastFetch, countdown, refresh } = useFundingRates()
  const { positions } = usePositionsStore()
  const [pairSize, setPairSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('fundingPairSize')
      return saved ? parseInt(saved) : 1000
    }
    return 1000
  })

  const handleSizeChange = (newSize: number) => {
    const parsed = Number.isFinite(newSize) ? Math.round(newSize) : 0
    const clamped = Math.min(100000, Math.max(10, parsed || 10))

    setPairSize(clamped)
    if (typeof window !== 'undefined') {
      localStorage.setItem('fundingPairSize', String(clamped))
    }
  }

  return (
    <div className="h-full w-full flex flex-col bg-card">
      <FundingHeader
        pairSize={pairSize}
        onSizeChange={handleSizeChange}
        countdown={countdown}
        lastFetch={lastFetch}
        loading={loading}
        onRefresh={refresh}
      />

      <div className="flex-1 overflow-auto">
        <FundingTable
          pairs={pairs}
          positions={positions}
          pairSize={pairSize}
          loading={loading}
        />

        <HistoricPairsSection positions={positions} />
      </div>

      <div className="px-4 py-2 border-t border-border bg-secondary/20">
        <p className="text-xs text-muted-foreground">
          Funding paid hourly at :00 | Auto-refresh: every 5 minutes
        </p>
      </div>
    </div>
  )
}
