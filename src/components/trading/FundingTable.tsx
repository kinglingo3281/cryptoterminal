"use client"

import { FundingPair } from "@/types/funding"
import { Position } from "@/types/positions"
import { FundingPairRow } from "./FundingPairRow"

interface FundingTableProps {
  pairs: FundingPair[]
  positions: Position[]
  pairSize: number
  loading: boolean
}

export function FundingTable({ pairs, positions, pairSize, loading }: FundingTableProps) {
  if (loading && pairs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Fetching funding rates...</p>
        </div>
      </div>
    )
  }

  if (pairs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-muted-foreground">No funding data available</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-secondary/40 border-b border-border">
          <tr className="text-muted-foreground">
            <th className="text-left px-3 py-2 font-medium">PAIR</th>
            <th className="text-center px-3 py-2 font-medium">STRENGTH</th>
            <th className="text-right px-3 py-2 font-medium">LONG (1H)</th>
            <th className="text-right px-3 py-2 font-medium">SHORT (1H)</th>
            <th className="text-right px-3 py-2 font-medium">SPREAD</th>
            <th className="text-right px-3 py-2 font-medium">APY</th>
            <th className="text-center px-3 py-2 font-medium">OPEN</th>
          </tr>
        </thead>
        <tbody>
          {pairs.slice(0, 30).map((pair, index) => (
            <FundingPairRow
              key={`${pair.long_symbol}-${pair.short_symbol}-${index}`}
              pair={pair}
              positions={positions}
              pairSize={pairSize}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
