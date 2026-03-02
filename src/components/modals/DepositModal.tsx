"use client"

import { useState, useEffect } from "react"
import { Modal } from "@/components/ui/Modal"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DepositService } from "@/services/DepositService"
import type { WalletClient } from "viem"

interface DepositModalProps {
  isOpen: boolean
  onClose: () => void
  onDeposit: (amount: number) => Promise<void>
  isProcessing: boolean
  walletClient?: WalletClient | null
}

export function DepositModal({ isOpen, onClose, onDeposit, isProcessing, walletClient }: DepositModalProps) {
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [estimatedFee, setEstimatedFee] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)

  const handleDeposit = async () => {
    setError(null)
    
    const amountNum = parseFloat(amount)
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount")
      return
    }

    try {
      await onDeposit(amountNum)
      setAmount("")
      onClose()
    } catch (err: any) {
      setError(err.message || "Deposit failed")
    }
  }

  const handleClose = () => {
    if (!isProcessing) {
      setAmount("")
      setError(null)
      setEstimatedFee(null)
      onClose()
    }
  }

  // Estimate gas when amount changes
  useEffect(() => {
    const estimateGas = async () => {
      if (!amount || !walletClient) {
        setEstimatedFee(null)
        return
      }

      const amountNum = parseFloat(amount)
      if (isNaN(amountNum) || amountNum <= 0) {
        setEstimatedFee(null)
        return
      }

      setIsEstimating(true)
      const result = await DepositService.estimateDepositGas(walletClient, amountNum)
      setIsEstimating(false)

      if (result.success && result.estimatedGasETH) {
        setEstimatedFee(result.estimatedGasETH)
      } else {
        setEstimatedFee(null)
      }
    }

    const debounce = setTimeout(estimateGas, 500)
    return () => clearTimeout(debounce)
  }, [amount, walletClient])

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Deposit USDC">
      <div className="bg-background border border-border rounded-lg w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">Deposit USDC</h2>
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
                    handleDeposit()
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
              <span>Network:</span>
              <span className="text-foreground font-medium">Arbitrum</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Asset:</span>
              <span className="text-foreground font-medium">USDC</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Destination:</span>
              <span className="text-foreground font-medium">Hyperliquid</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Network Fee:</span>
              <span className="text-foreground font-medium">
                {isEstimating ? (
                  <span className="text-muted-foreground">Estimating...</span>
                ) : estimatedFee ? (
                  <span>~{estimatedFee} ETH</span>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </span>
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
            onClick={handleDeposit}
            disabled={isProcessing || !amount}
            className={cn(
              "flex-1 py-2.5 rounded-md font-bold text-sm transition-opacity",
              "bg-trade-green/10 text-trade-green border border-trade-green/50 hover:bg-trade-green/20",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {isProcessing ? 'Processing...' : 'Deposit'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
