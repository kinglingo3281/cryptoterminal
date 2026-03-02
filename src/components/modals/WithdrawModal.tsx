"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/Modal"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface WithdrawModalProps {
  isOpen: boolean
  onClose: () => void
  onWithdraw: (amount: number) => Promise<void>
  isProcessing: boolean
}

export function WithdrawModal({ isOpen, onClose, onWithdraw, isProcessing }: WithdrawModalProps) {
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)

  const handleWithdraw = async () => {
    setError(null)
    
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount")
      return
    }

    try {
      await onWithdraw(amountNum)
      setAmount("")
      onClose()
    } catch (err: any) {
      setError(err.message || "Withdrawal failed")
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("")
      setError(null)
      onClose()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Withdraw USDC">
      <div className="bg-background border border-border rounded-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Withdraw USDC</h2>
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
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-2 block">
              Amount (USDC)
            </label>
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
                  "focus:outline-none focus:border-trade-orange transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed"
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isProcessing) {
                    handleWithdraw()
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
              <span>Source:</span>
              <span className="text-foreground font-medium">Hyperliquid</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Destination:</span>
              <span className="text-foreground font-medium">Arbitrum (your wallet)</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Asset:</span>
              <span className="text-foreground font-medium">USDC</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Fee:</span>
              <span className="text-foreground font-medium">$1.00</span>
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
            onClick={handleWithdraw}
            disabled={isProcessing || !amount}
            className={cn(
              "flex-1 py-2.5 rounded-md font-bold text-sm transition-opacity",
              "bg-trade-red/10 text-trade-red border border-trade-red/50 hover:bg-trade-red/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isProcessing ? 'Processing...' : 'Withdraw'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
