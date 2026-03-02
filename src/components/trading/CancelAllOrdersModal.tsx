"use client"

import { Modal } from "@/components/ui/Modal"
import { Order } from "@/types/positions"

interface CancelAllOrdersModalProps {
    isOpen: boolean
    onClose: () => void
    orders: Order[]
    onConfirm: () => Promise<void>
}

export function CancelAllOrdersModal({ 
    isOpen, 
    onClose, 
    orders,
    onConfirm 
}: CancelAllOrdersModalProps) {
    const handleConfirm = () => {
        onClose()
        onConfirm().catch((error: any) => {
            console.error('[CancelAllOrdersModal] Error:', error)
        })
    }

    const orderCount = orders.length
    
    // Group orders by asset for display
    const ordersByAsset = orders.reduce((acc, order) => {
        if (!acc[order.coin]) {
            acc[order.coin] = []
        }
        acc[order.coin].push(order)
        return acc
    }, {} as Record<string, Order[]>)

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="⚠️ Cancel All Orders"
            className="max-w-lg"
        >
            <div className="flex flex-col gap-4">
                {/* Order Count Section */}
                <div className="bg-secondary/30 border border-border rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-semibold text-foreground">Orders to Cancel</span>
                        <span className="text-lg font-bold text-foreground">{orderCount}</span>
                    </div>
                    <div className="max-h-[200px] overflow-auto space-y-1 pr-2">
                        {Object.entries(ordersByAsset).map(([asset, assetOrders]) => (
                            <div key={asset} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{asset}:</span>
                                <span className="font-semibold">{assetOrders.length} order{assetOrders.length !== 1 ? 's' : ''}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Warning Section */}
                <div className="bg-trade-red/10 border border-trade-red/30 rounded-lg p-3">
                    <p className="text-trade-red text-sm font-semibold mb-1">⚠️ Warning</p>
                    <p className="text-xs text-muted-foreground">
                        This action will cancel all {orderCount} open orders. This action cannot be undone.
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
                        onClick={handleConfirm}
                        className="px-4 py-2 text-sm font-medium bg-trade-red/20 border border-trade-red/30 rounded text-trade-red hover:bg-trade-red/30 transition-colors"
                    >
                        Confirm Cancel All
                    </button>
                </div>
            </div>
        </Modal>
    )
}
