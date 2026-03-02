"use client"

import { useMemo, useState } from "react"
import { Position } from "@/types/positions"
import { cn } from "@/lib/utils"
import { useUserStore } from "@/store/useUserStore"
import { HyperliquidOrderClient } from "@/services/HyperliquidOrderClient"
import { Modal } from "@/components/ui/Modal"

interface PairPositionCardProps {
  longPosition: Position
  shortPosition: Position
}

export function PairPositionCard({ longPosition, shortPosition }: PairPositionCardProps) {
  const netPnl = (longPosition.unrealizedPnl || 0) + (shortPosition.unrealizedPnl || 0)
  const netPnlClass = netPnl >= 0 ? "text-trade-green" : "text-trade-red"

  const { apiKeys, user } = useUserStore()
  const [isClosing, setIsClosing] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [closeModal, setCloseModal] = useState<{ type: 'single' | 'both'; symbol?: string } | null>(null)

  const orderClient = useMemo(() => {
    if (!apiKeys?.hyperliquid?.apiKey) return null

    const client = new HyperliquidOrderClient()
    client.initialize(apiKeys.hyperliquid.apiKey).catch((err) => {
      console.error('[PairPositionCard] Failed to init order client:', err)
    })
    return client
  }, [apiKeys?.hyperliquid?.apiKey])

  const openCloseSingleModal = (symbol: string) => {
    if (isClosing) return
    setCloseModal({ type: 'single', symbol })
  }

  const openCloseBothModal = () => {
    if (isClosing) return
    setCloseModal({ type: 'both' })
  }

  const handleCloseSingle = async (symbol: string) => {
    setErrorText(null)

    if (!orderClient) {
      setErrorText('Order client not initialized')
      return
    }

    if (!user?.wallet_address) {
      setErrorText('Wallet address unavailable')
      return
    }

    setIsClosing(true)
    try {
      const result = await orderClient.closePosition(symbol, user.wallet_address)
      if (!result.success) {
        setErrorText(result.error || 'Close failed')
      }
    } catch (error: any) {
      setErrorText(error?.message || 'Close failed')
    } finally {
      setIsClosing(false)
    }
  }

  const handleCloseBoth = async () => {
    setErrorText(null)

    if (!orderClient) {
      setErrorText('Order client not initialized')
      return
    }

    if (!user?.wallet_address) {
      setErrorText('Wallet address unavailable')
      return
    }

    setIsClosing(true)
    try {
      const longResult = await orderClient.closePosition(longPosition.coin, user.wallet_address)
      const shortResult = await orderClient.closePosition(shortPosition.coin, user.wallet_address)

      if (!longResult.success || !shortResult.success) {
        const errors = [longResult.error, shortResult.error].filter(Boolean).join(' | ')
        setErrorText(errors || 'Close failed')
      }
    } catch (error: any) {
      setErrorText(error?.message || 'Close failed')
    } finally {
      setIsClosing(false)
    }
  }

  const confirmClose = async () => {
    const action = closeModal
    setCloseModal(null)

    if (!action) return

    if (action.type === 'single' && action.symbol) {
      await handleCloseSingle(action.symbol)
      return
    }

    await handleCloseBoth()
  }

  return (
    <div className="min-w-[280px] bg-secondary/20 border border-border rounded p-2 space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-trade-green">LONG</span>
          <span className="text-foreground">{longPosition.coin}</span>
          <span className="text-muted-foreground">{Math.abs(longPosition.size).toFixed(4)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("font-medium", longPosition.unrealizedPnl >= 0 ? "text-trade-green" : "text-trade-red")}>
            {longPosition.unrealizedPnl >= 0 ? '+' : ''}${longPosition.unrealizedPnl.toFixed(2)}
          </span>
          <button
            onClick={() => openCloseSingleModal(longPosition.coin)}
            disabled={isClosing}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-trade-red/20 text-trade-red disabled:opacity-50"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-1">
          <span className="font-semibold text-trade-red">SHORT</span>
          <span className="text-foreground">{shortPosition.coin}</span>
          <span className="text-muted-foreground">{Math.abs(shortPosition.size).toFixed(4)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("font-medium", shortPosition.unrealizedPnl >= 0 ? "text-trade-green" : "text-trade-red")}>
            {shortPosition.unrealizedPnl >= 0 ? '+' : ''}${shortPosition.unrealizedPnl.toFixed(2)}
          </span>
          <button
            onClick={() => openCloseSingleModal(shortPosition.coin)}
            disabled={isClosing}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-trade-red/20 text-trade-red disabled:opacity-50"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border/30">
        <span className={cn("text-[10px] font-semibold", netPnlClass)}>
          Net: {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
        </span>
        <button
          onClick={openCloseBothModal}
          disabled={isClosing}
          className="px-2 py-0.5 text-[10px] font-medium bg-trade-red/20 border border-trade-red/30 rounded text-trade-red hover:bg-trade-red/30 transition-colors disabled:opacity-50"
        >
          {isClosing ? 'Closing…' : 'Close Both'}
        </button>
      </div>
      {errorText ? (
        <div className="text-[10px] text-trade-red">{errorText}</div>
      ) : null}
      <Modal
        isOpen={Boolean(closeModal)}
        onClose={() => setCloseModal(null)}
        title={closeModal?.type === 'both' ? 'Close Both Positions' : `Close Position: ${closeModal?.symbol || ''}`}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground leading-relaxed m-0">
            This will submit a market close with 10% slippage to ensure execution.
          </p>
          <div className="bg-secondary/30 border border-border rounded p-3 text-xs text-muted-foreground">
            <span className="block">
              <strong>Single:</strong> Closes the selected leg only.
            </span>
            <span className="block">
              <strong>Both:</strong> Closes long and short legs sequentially.
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setCloseModal(null)}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmClose}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-trade-red/20 border border-trade-red/30 text-trade-red hover:bg-trade-red/30 transition-colors"
            >
              Confirm Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
