"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/Modal"
import { cn } from "@/lib/utils"
import type { Order } from "@/types/positions"
import type { ChaseSettings } from "@/types/chase"
import { getSpotDisplayName } from "@/lib/spot-display"
import { toast } from "sonner"

interface ChaseSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  order: Order | null
  onConfirm: (settings: ChaseSettings) => Promise<void>
}

export function ChaseSettingsModal({ isOpen, onClose, order, onConfirm }: ChaseSettingsModalProps) {
  const [distanceInput, setDistanceInput] = useState('10')
  const [freqMin, setFreqMin] = useState(10)
  const [freqMax, setFreqMax] = useState(20)
  const [rangeEnabled, setRangeEnabled] = useState(false)
  const [rangePrice, setRangePrice] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  
  if (!order) return null
  
  const isBuy = order.side === 'BUY'
  const sideColor = isBuy ? 'text-trade-green' : 'text-trade-red'
  
  const handleSubmit = async () => {
    setIsProcessing(true)
    
    try {
      // Parse distance (ticks or percentage)
      const cleanedInput = distanceInput.trim().replace(',', '.')
      const isPercent = cleanedInput.endsWith('%')
      
      let tickDistance: number | undefined
      let percentDistance: number | undefined
      
      if (isPercent) {
        percentDistance = parseFloat(cleanedInput.replace('%', ''))
        if (isNaN(percentDistance) || percentDistance <= 0 || percentDistance > 10) {
          toast.warning('Percentage distance must be 0.01%-10%')
          setIsProcessing(false)
          return
        }
      } else {
        tickDistance = parseFloat(cleanedInput)
        if (isNaN(tickDistance) || tickDistance <= 0) {
          toast.warning('Tick distance must be > 0')
          setIsProcessing(false)
          return
        }
      }
      
      if (freqMin < 5 || freqMax > 60 || freqMin > freqMax) {
        toast.warning('Frequency must be 5-60s, min ≤ max')
        setIsProcessing(false)
        return
      }
      
      const settings: ChaseSettings = {
        tickDistance,
        percentDistance,
        isPercent,
        frequencyRangeMin: freqMin,
        frequencyRangeMax: freqMax,
        rangePrice: rangeEnabled && rangePrice ? parseFloat(rangePrice) : null,
        rangeType: rangeEnabled ? (isBuy ? 'upper' : 'lower') : null,
        useAnchor: false,
        tpslEnabled: false,
        aggressive: false
      }
      
      await onConfirm(settings)
      onClose()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsProcessing(false)
    }
  }
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="🎯 Chase Order Settings" className="max-w-md">
      <div className="flex flex-col gap-4">
        {/* Order info */}
        <div className={cn(
          "border rounded-lg p-3",
          isBuy ? "bg-trade-green/10 border-trade-green/30" : "bg-trade-red/10 border-trade-red/30"
        )}>
          <div className="text-xs text-muted-foreground mb-1">Chasing Order</div>
          <div className="text-sm font-semibold">
            <span className={sideColor}>{isBuy ? 'BUY' : 'SELL'}</span>
            {' '}{order.size} {getSpotDisplayName(order.coin)} @ ${order.limitPx}
          </div>
        </div>
        
        {/* Distance input */}
        <div>
          <label className="block text-sm font-medium mb-2">
            Distance from Best Price
            <span className="text-muted-foreground text-xs ml-1">(ticks or %)</span>
          </label>
          <input
            type="text"
            value={distanceInput}
            onChange={(e) => setDistanceInput(e.target.value)}
            className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
            placeholder="10 or 0.5%"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Enter ticks (e.g., 10) or percentage (e.g., 0.5%)
          </p>
        </div>
        
        {/* Frequency range */}
        <div>
          <label className="block text-sm font-medium mb-2">Modification Frequency (seconds)</label>
          <div className="flex gap-3 items-center">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Min</label>
              <input
                type="number"
                value={freqMin}
                onChange={(e) => setFreqMin(parseInt(e.target.value))}
                min={5}
                max={60}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <span className="text-muted-foreground pt-5">-</span>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground block mb-1">Max</label>
              <input
                type="number"
                value={freqMax}
                onChange={(e) => setFreqMax(parseInt(e.target.value))}
                min={5}
                max={60}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Random delay between modifications to avoid detection
          </p>
        </div>
        
        {/* Range limit */}
        <div>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rangeEnabled}
              onChange={(e) => setRangeEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-input"
            />
            <span className="text-sm font-medium">
              Enable Price Limit
              <span className="text-muted-foreground ml-1 text-xs">
                ({isBuy ? 'upper bound' : 'lower bound'})
              </span>
            </span>
          </label>
          {rangeEnabled && (
            <div>
              <input
                type="number"
                value={rangePrice}
                onChange={(e) => setRangePrice(e.target.value)}
                className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                placeholder="Enter price limit"
                step="any"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Chase stops if market price {isBuy ? 'exceeds' : 'drops below'} this level
              </p>
            </div>
          )}
        </div>
        
        {/* Warning */}
        <div className="bg-yellow-500/10 border-l-4 border-yellow-500 rounded-r p-3">
          <p className="text-xs text-yellow-400 font-semibold mb-1">⚠️ Important:</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
            <li>Chase will automatically stop if order fills</li>
            <li>TP/SL orders will be canceled when entry is modified</li>
            <li>Order size remains constant during chase</li>
          </ul>
        </div>
        
        {/* Actions */}
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium bg-chart-4/20 border border-chart-4/30 rounded text-chart-4 hover:bg-chart-4/30 transition-colors disabled:opacity-50"
          >
            {isProcessing ? 'Starting...' : 'Start Chase'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
