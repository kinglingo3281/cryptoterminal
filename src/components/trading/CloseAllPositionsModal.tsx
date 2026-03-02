"use client"

import { useState } from "react"
import { Modal } from "@/components/ui/Modal"
import { Position } from "@/types/positions"
import { cn } from "@/lib/utils"

interface CloseAllPositionsModalProps {
    isOpen: boolean
    onClose: () => void
    positions: Position[]
    onConfirm: (method: 'market' | 'limit') => Promise<void>
}

export function CloseAllPositionsModal({ 
    isOpen, 
    onClose, 
    positions,
    onConfirm 
}: CloseAllPositionsModalProps) {
    const [selectedMethod, setSelectedMethod] = useState<'market' | 'limit'>('market')

    const handleConfirm = (method: 'market' | 'limit') => {
        setSelectedMethod(method)
        onClose()
        onConfirm(method).catch((error: any) => {
            console.error('[CloseAllPositionsModal] Error:', error)
        })
    }

    const positionCount = positions.length
    
    // Group positions by asset for display
    const positionsByAsset = positions.reduce((acc, position) => {
        if (!acc[position.coin]) {
            acc[position.coin] = []
        }
        acc[position.coin].push(position)
        return acc
    }, {} as Record<string, Position[]>)

    // Calculate total PnL
    const totalPnl = positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0)

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="📊 Close All Positions"
            className="max-w-2xl"
        >
            <div className="flex flex-col gap-4">
                {/* Position Count Section */}
                <div className="bg-secondary/30 border border-border rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-foreground">Positions to Close</span>
                        <div className="flex items-center gap-3">
                            <span className="text-lg font-bold text-foreground">{positionCount}</span>
                            <span className={cn(
                                "text-sm font-semibold",
                                totalPnl >= 0 ? "text-trade-green" : "text-trade-red"
                            )}>
                                {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                            </span>
                        </div>
                    </div>
                    <div className="max-h-[200px] overflow-auto space-y-1 pr-2">
                        {Object.entries(positionsByAsset).map(([asset, assetPositions]) => (
                            <div key={asset} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{asset}:</span>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold">
                                        {assetPositions[0].side} {Math.abs(assetPositions[0].size).toFixed(4)}
                                    </span>
                                    <span className={cn(
                                        "text-xs",
                                        assetPositions[0].unrealizedPnl >= 0 ? "text-trade-green" : "text-trade-red"
                                    )}>
                                        {assetPositions[0].unrealizedPnl >= 0 ? '+' : ''}${assetPositions[0].unrealizedPnl.toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Close Method Info */}
                <div className="bg-secondary/30 border border-border rounded p-3">
                    <p className="text-xs font-semibold text-foreground mb-2">Choose Close Method:</p>
                    <div className="space-y-2 text-xs text-muted-foreground">
                        <div className="flex items-start gap-2">
                            <span className="font-semibold text-primary shrink-0">Market:</span>
                            <span>Immediate close with 10% slippage (guaranteed fill)</span>
                        </div>
                        <div className="flex items-start gap-2">
                            <span className="font-semibold text-trade-green shrink-0">Limit:</span>
                            <span>Progressive slippage: 0.1% → 0.5% → 10% (better price, may take time)</span>
                        </div>
                    </div>
                </div>

                {/* Warning Section */}
                <div className="bg-trade-red/10 border border-trade-red/30 rounded-lg p-3">
                    <p className="text-trade-red text-sm font-semibold mb-1">⚠️ Warning</p>
                    <p className="text-xs text-muted-foreground">
                        This action will close all {positionCount} positions using <strong>{selectedMethod}</strong> orders. 
                        This action cannot be undone.
                    </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium bg-secondary rounded text-muted-foreground hover:text-foreground transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => handleConfirm('limit')}
                        className="px-4 py-2 text-sm font-medium bg-trade-green/20 border border-trade-green/30 rounded text-trade-green hover:bg-trade-green/30 transition-colors"
                    >
                        Limit Close
                    </button>
                    <button
                        onClick={() => handleConfirm('market')}
                        className="px-4 py-2 text-sm font-medium bg-primary/15 border border-primary/30 rounded text-primary hover:bg-primary/25 transition-colors"
                    >
                        Market Close
                    </button>
                </div>
            </div>
        </Modal>
    )
}
