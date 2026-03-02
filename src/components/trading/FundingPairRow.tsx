"use client"

import { useMemo, useState } from "react"
import { FundingPair } from "@/types/funding"
import { Position } from "@/types/positions"
import { FundingStrengthBar } from "./FundingStrengthBar"
import { PairPositionCard } from "./PairPositionCard"
import { useChaseTracker } from "@/hooks/useChaseTracker"
import { usePositionsStore } from "@/store/usePositionsStore"
import { useUserStore } from "@/store/useUserStore"
import { HyperliquidOrderClient } from "@/services/HyperliquidOrderClient"
import { FundingPairTradeExecutor } from "@/services/FundingPairTradeExecutor"

interface FundingPairRowProps {
  pair: FundingPair
  positions: Position[]
  pairSize: number
}

export function FundingPairRow({ pair, positions, pairSize }: FundingPairRowProps) {
  const { startChase } = useChaseTracker()
  const accountSummary = usePositionsStore(state => state.accountSummary)
  const { apiKeys, user } = useUserStore()
  const [isExecuting, setIsExecuting] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)

  const longPosition = positions.find(p => p.coin === pair.long_symbol && p.side === 'LONG')
  const shortPosition = positions.find(p => p.coin === pair.short_symbol && p.side === 'SHORT')
  const hasPair = longPosition && shortPosition

  const executor = useMemo(() => {
    if (!apiKeys?.hyperliquid?.apiKey) return null

    const client = new HyperliquidOrderClient()
    client.initialize(apiKeys.hyperliquid.apiKey).catch((err) => {
      console.error('[FundingPairRow] Failed to init order client:', err)
    })
    return new FundingPairTradeExecutor(client, startChase)
  }, [apiKeys?.hyperliquid?.apiKey, startChase])

  const handleTrade = async () => {
    setErrorText(null)

    if (!executor) {
      setErrorText('Order client not initialized')
      return
    }

    if (!accountSummary?.accountValue) {
      setErrorText('Account value unavailable')
      return
    }

    if (!user?.wallet_address) {
      setErrorText('Wallet address unavailable')
      return
    }

    setIsExecuting(true)

    try {
      const result = await executor.executeFundingPairTrade({
        pair,
        pairSize,
        walletBalance: accountSummary.accountValue,
        userAddress: user.wallet_address,
        hedgeRatio: 1.0,
        timeframe: '1h',
        autoSlTp: true
      })

      if (!result.success) {
        setErrorText(result.error || 'Trade failed')
      }
    } catch (error: any) {
      setErrorText(error?.message || 'Trade failed')
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <tr className="border-b border-border/50 hover:bg-white/5 transition-colors">
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          <span className="font-medium text-trade-green">{pair.long_symbol}</span>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium text-trade-red">{pair.short_symbol}</span>
        </div>
      </td>

      <td className="px-3 py-2 text-center">
        <FundingStrengthBar strength={pair.signal_strength} />
      </td>

      <td className="px-3 py-2 text-right">
        <span className="text-trade-green font-medium">
          {pair.long_rate_1h_pct.toFixed(4)}%
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        <span className="text-trade-red font-medium">
          {pair.short_rate_1h_pct.toFixed(4)}%
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        <span className="text-foreground font-semibold">
          {pair.spread_1h_pct.toFixed(4)}%
        </span>
      </td>

      <td className="px-3 py-2 text-right">
        <span className="text-primary font-bold">
          {pair.annualized_pct.toFixed(1)}%
        </span>
      </td>

      <td className="px-3 py-2">
        {hasPair ? (
          <PairPositionCard
            longPosition={longPosition}
            shortPosition={shortPosition}
          />
        ) : (
          <div className="flex flex-col gap-1">
            <button
              onClick={handleTrade}
              disabled={isExecuting}
              className="w-full px-3 py-1.5 text-xs font-medium bg-primary/15 border border-primary/30 rounded text-primary hover:bg-primary/25 transition-colors disabled:opacity-60"
            >
              {isExecuting ? 'Executing…' : 'Trade'}
            </button>
            {errorText ? (
              <span className="text-[10px] text-trade-red">{errorText}</span>
            ) : null}
          </div>
        )}
      </td>
    </tr>
  )
}
