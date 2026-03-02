"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Position } from "@/types/positions"
import { FundingService } from "@/services/FundingService"
import { FundingPairHistory } from "@/types/funding"
import { PairPositionCard } from "./PairPositionCard"
import { useUserStore } from "@/store/useUserStore"
import { HyperliquidOrderClient } from "@/services/HyperliquidOrderClient"

interface HistoricPairsSectionProps {
  positions: Position[]
}

async function verifyPosition(
  orderClient: HyperliquidOrderClient,
  symbol: string,
  direction: 'LONG' | 'SHORT',
  userAddress: string
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const entry = await orderClient.getPositionEntry(symbol, userAddress)
    if (entry && entry.side === direction && entry.size > 0) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  return false
}

export function HistoricPairsSection({ positions }: HistoricPairsSectionProps) {
  const [activePairs, setActivePairs] = useState<FundingPairHistory[]>([])
  const { apiKeys, user } = useUserStore()
  const verifierRef = useRef(false)

  const orderClient = useMemo(() => {
    if (!apiKeys?.hyperliquid?.apiKey) return null

    const client = new HyperliquidOrderClient()
    client.initialize(apiKeys.hyperliquid.apiKey).catch((err) => {
      console.error('[HistoricPairsSection] Failed to init order client:', err)
    })
    return client
  }, [apiKeys?.hyperliquid?.apiKey])

  useEffect(() => {
    const history = FundingService.loadHistory()
    let updated = false

    const longPositions = new Set(positions.filter(p => p.side === 'LONG').map(p => p.coin))
    const shortPositions = new Set(positions.filter(p => p.side === 'SHORT').map(p => p.coin))

    history.pairs.forEach((pair: any) => {
      if (pair.status !== 'ACTIVE') return

      const longExists = longPositions.has(pair.longSymbol)
      const shortExists = shortPositions.has(pair.shortSymbol)

      if (!longExists || !shortExists) {
        pair.status = 'CLOSED'
        pair.closedAt = Date.now()
        updated = true
      }
    })

    if (updated) {
      FundingService.saveHistory(history)
    }

    const active = history.pairs.filter((p: any) => p.status === 'ACTIVE')
    setActivePairs(active)
  }, [positions])

  useEffect(() => {
    const verify = async () => {
      if (!orderClient || !user?.wallet_address || verifierRef.current) return
      verifierRef.current = true

      try {
        const history = FundingService.loadHistory()
        const active = history.pairs.filter((p: any) => p.status === 'ACTIVE')

        if (active.length === 0) return

        let updated = false

        for (const pair of active) {
          const [longVerified, shortVerified] = await Promise.all([
            verifyPosition(orderClient, pair.longSymbol, 'LONG', user.wallet_address),
            verifyPosition(orderClient, pair.shortSymbol, 'SHORT', user.wallet_address)
          ])

          pair.lastVerified = Date.now()
          pair.verificationAttempts = (pair.verificationAttempts || 0) + 1

          if (!longVerified || !shortVerified) {
            pair.status = 'CLOSED'
            pair.closedAt = Date.now()
            updated = true
          }
        }

        if (updated) {
          FundingService.saveHistory(history)
        }

        setActivePairs(history.pairs.filter((p: any) => p.status === 'ACTIVE'))
      } finally {
        verifierRef.current = false
      }
    }

    verify()
  }, [orderClient, user?.wallet_address])

  if (activePairs.length === 0) {
    return null
  }

  return (
    <div className="mt-4 px-4 pb-4">
      <div className="bg-secondary/30 border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-2 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Active Funding Pairs</h3>
          <span className="text-xs px-2 py-0.5 bg-primary/15 border border-primary/30 rounded text-primary font-medium">
            {activePairs.length} Active
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/20 border-b border-border">
              <tr className="text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">PAIR</th>
                <th className="text-right px-3 py-2 font-medium">OPENED</th>
                <th className="text-right px-3 py-2 font-medium">ORIGINAL SPREAD</th>
                <th className="text-left px-3 py-2 font-medium">POSITIONS</th>
              </tr>
            </thead>
            <tbody>
              {activePairs.map((pair) => {
                const longPos = positions.find(p => p.coin === pair.longSymbol && p.side === 'LONG')
                const shortPos = positions.find(p => p.coin === pair.shortSymbol && p.side === 'SHORT')

                return (
                  <tr key={pair.id} className="border-b border-border/50 hover:bg-white/5">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="font-medium text-trade-green">{pair.longSymbol}</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="font-medium text-trade-red">{pair.shortSymbol}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {FundingService.formatTimeAgo(pair.openedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-primary font-semibold">
                        {pair.spreadAnnualized.toFixed(1)}% APR
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {longPos && shortPos ? (
                        <PairPositionCard longPosition={longPos} shortPosition={shortPos} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Verifying...</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
