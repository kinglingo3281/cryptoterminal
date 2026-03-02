"use client"

import { cn } from "@/lib/utils"

interface FundingStrengthBarProps {
  strength: 1 | 2 | 3 | 4
}

export function FundingStrengthBar({ strength }: FundingStrengthBarProps) {
  const bars = [1, 2, 3, 4]

  const getBarClass = (barIndex: number) => {
    const isFilled = barIndex <= strength

    if (!isFilled) {
      return "bg-secondary/20"
    }

    if (strength >= 3) return "bg-trade-green"
    if (strength >= 2) return "bg-orange-500"
    return "bg-muted-foreground/50"
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      {bars.map((barIndex) => (
        <div
          key={barIndex}
          className={cn(
            "w-1.5 h-3 rounded-sm transition-colors",
            getBarClass(barIndex)
          )}
        />
      ))}
    </div>
  )
}
