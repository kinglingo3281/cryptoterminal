"use client"

import { Modal } from "@/components/ui/Modal"

interface ClosePositionModalProps {
    isOpen: boolean
    onClose: () => void
    asset: string
    onConfirm: (method: 'market' | 'limit' | 'chase') => void
}

export function ClosePositionModal({ 
    isOpen, 
    onClose, 
    asset, 
    onConfirm 
}: ClosePositionModalProps) {
    const handleChoice = (method: 'market' | 'limit' | 'chase') => {
        onConfirm(method)
        onClose()
    }

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title={`Close Position: ${asset}`}
            className="min-w-[420px]"
        >
            <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground leading-relaxed m-0">
                    Choose how to close this position:
                </p>

                <div className="p-3 bg-secondary/30 border border-border rounded">
                    <p className="text-xs text-muted-foreground leading-relaxed m-0 space-y-1">
                        <span className="block">
                            <strong>Chase:</strong> Automated price chasing until filled
                        </span>
                        <span className="block">
                            <strong>Limit:</strong> Progressive slippage (0.1% → 0.5% → 10%)
                        </span>
                        <span className="block">
                            <strong>Market:</strong> Immediate close with 10% slippage
                        </span>
                    </p>
                </div>

                <div className="flex gap-2.5 justify-end px-5 py-3.5 bg-black/20 rounded -mx-4 -mb-4 mt-2">
                    <button
                        onClick={() => handleChoice('chase')}
                        className="px-3 py-1.5 text-xs font-semibold rounded border transition-all duration-150 bg-purple-500/15 border-purple-500/30 text-purple-400 hover:bg-purple-500/25"
                    >
                        Chase
                    </button>
                    <button
                        onClick={() => handleChoice('limit')}
                        className="px-3 py-1.5 text-xs font-semibold rounded border transition-all duration-150 bg-orange-500/15 border-orange-500/30 text-orange-400 hover:bg-orange-500/25"
                    >
                        Limit Close
                    </button>
                    <button
                        onClick={() => handleChoice('market')}
                        className="px-3 py-1.5 text-xs font-semibold rounded border transition-all duration-150 bg-primary/15 border border-primary/30 text-primary hover:-translate-y-0.5 hover:shadow-lg hover:bg-primary/25"
                    >
                        Market Close
                    </button>
                </div>
            </div>
        </Modal>
    )
}
