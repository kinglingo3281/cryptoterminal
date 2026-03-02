"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/Modal"
import { X, ArrowRightLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePositionsStore } from "@/store/usePositionsStore"

interface TransferModalProps {
  isOpen: boolean
  onClose: () => void
  onTransfer: (amount: number, toPerp: boolean) => Promise<void>
  isProcessing: boolean
}

export function TransferModal({ isOpen, onClose, onTransfer, isProcessing }: TransferModalProps) {
  const [amount, setAmount] = useState("")
  const [toPerp, setToPerp] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const accountSummary = usePositionsStore(state => state.accountSummary)

  // Spot→Perps: use USDC balance in spot wallet
  // Perps→Spot: use withdrawable (free margin not used by positions)
  const spotUsdcBalance = accountSummary?.spotBalances?.find(b => b.coin === 'USDC')?.total || 0
  const sourceBalance = toPerp
    ? spotUsdcBalance
    : (accountSummary?.withdrawable || 0)

  const handleTransfer = async () => {
    setError(null)

    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount")
      return
    }

    if (amountNum > sourceBalance) {
      setError(`Insufficient ${toPerp ? 'Spot' : 'Perps'} balance`)
      return
    }

    try {
      await onTransfer(amountNum, toPerp)
      setAmount("")
      onClose()
    } catch (err: any) {
      setError(err.message || "Transfer failed")
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("")
      setError(null)
      onClose()
    }
  }

  const handleMaxClick = () => {
    if (sourceBalance > 0) {
      setAmount(sourceBalance.toFixed(2))
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Transfer USDC">
      <div className="bg-background border border-border rounded-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Transfer USDC</h2>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Direction Toggle */}
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex-1 text-center py-2.5 rounded-md text-sm font-medium border transition-colors",
                toPerp
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-secondary border-border text-muted-foreground"
              )}
            >
              Spot
            </div>
            <button
              onClick={() => setToPerp(!toPerp)}
              disabled={isProcessing}
              className="p-2 rounded-md bg-secondary border border-border hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              <ArrowRightLeft className="h-4 w-4 text-foreground" />
            </button>
            <div
              className={cn(
                "flex-1 text-center py-2.5 rounded-md text-sm font-medium border transition-colors",
                !toPerp
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-secondary border-border text-muted-foreground"
              )}
            >
              Perps
            </div>
          </div>

          <div className="text-center text-xs text-muted-foreground">
            {toPerp ? "Spot → Perps" : "Perps → Spot"}
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-muted-foreground">
                Amount (USDC)
              </label>
              <button
                onClick={handleMaxClick}
                disabled={isProcessing || sourceBalance <= 0}
                className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              >
                Max: ${sourceBalance.toFixed(2)}
              </button>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">
                $
              </span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={isProcessing}
                placeholder="0.00"
                step="0.01"
                min="0"
                className={cn(
                  "w-full bg-secondary border border-border rounded-md pl-7 pr-4 py-3",
                  "text-foreground font-mono text-lg",
                  "focus:outline-none focus:border-primary/50 transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isProcessing) {
                    handleTransfer()
                  }
                }}
              />
            </div>
          </div>

          {error && (
            <div className="bg-trade-red/10 border border-trade-red/50 rounded-md p-3 text-sm text-trade-red">
              {error}
            </div>
          )}

          <div className="bg-secondary/50 border border-border/50 rounded-md p-3 space-y-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>From:</span>
              <span className="text-foreground font-medium">{toPerp ? "Spot" : "Perps"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>To:</span>
              <span className="text-foreground font-medium">{toPerp ? "Perps" : "Spot"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fee:</span>
              <span className="text-foreground font-medium">Free</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 p-4 border-t border-border">
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className={cn(
              "flex-1 py-2.5 rounded-md font-medium text-sm transition-colors",
              "bg-secondary text-foreground hover:bg-secondary/80",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleTransfer}
            disabled={isProcessing || !amount}
            className={cn(
              "flex-1 py-2.5 rounded-md font-bold text-sm transition-opacity",
              "bg-primary/10 text-primary border border-primary/50 hover:bg-primary/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isProcessing ? 'Processing...' : 'Transfer'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
