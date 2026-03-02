"use client"

import { useState, useEffect, useRef } from "react"
import { Modal } from "@/components/ui/Modal"
import { Position, Order } from "@/types/positions"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

interface ModifyPositionModalProps {
    isOpen: boolean
    onClose: () => void
    position: Position | null
    orders: Order[]
    currentPrice: number
    onConfirm: (params: ModifyTPSLParams) => Promise<void>
}

export interface ModifyTPSLParams {
    asset: string
    positionSize: number
    positionSide: 'LONG' | 'SHORT'
    tp?: { price: number, isMarket: boolean }
    sl?: { price: number, isMarket: boolean }
    ordersToCancel: number[]
}

interface DetectedOrder {
    oid: number
    type: 'TP' | 'SL'
    price: number
    size: number
    sizeMatch: boolean
}

export function ModifyPositionModal({ isOpen, onClose, position, orders, currentPrice, onConfirm }: ModifyPositionModalProps) {
    const [tpPrice, setTPPrice] = useState('')
    const [tpPercent, setTPPercent] = useState('')
    const [slPrice, setSLPrice] = useState('')
    const [slPercent, setSLPercent] = useState('')
    const [tpOrderType, setTPOrderType] = useState<'limit' | 'market'>('limit')
    const [slOrderType, setSLOrderType] = useState<'limit' | 'market'>('limit')
    const [detectedOrders, setDetectedOrders] = useState<{ toCancel: DetectedOrder[], hasIssues: boolean }>({ toCancel: [], hasIssues: false })
    const initializedRef = useRef<string | null>(null)
    
    useEffect(() => {
        if (isOpen && position) {
            if (initializedRef.current === position.coin) return
            initializedRef.current = position.coin
            
            const detected = detectAllTPSL(position, orders)
            setDetectedOrders(detected)
            
            const exactTP = detected.toCancel.find(o => o.type === 'TP' && o.sizeMatch)
            const exactSL = detected.toCancel.find(o => o.type === 'SL' && o.sizeMatch)
            
            if (exactTP) {
                setTPPrice(formatPrice(exactTP.price))
                updateTPPercentFromPrice(exactTP.price)
            } else {
                setTPPrice('')
                setTPPercent('')
            }
            
            if (exactSL) {
                setSLPrice(formatPrice(exactSL.price))
                updateSLPercentFromPrice(exactSL.price)
            } else {
                setSLPrice('')
                setSLPercent('')
            }
            
            setTPOrderType('limit')
            setSLOrderType('limit')
        }
        if (!isOpen) {
            initializedRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, position?.coin, orders])
    
    function detectAllTPSL(position: Position, allOrders: Order[]): { toCancel: DetectedOrder[], hasIssues: boolean } {
        const exactSize = Math.abs(position.size)
        const entryPrice = position.entryPrice
        
        const entryOrders = allOrders.filter(o => o.coin === position.coin && !o.reduceOnly)
        const entryOrderSizes = entryOrders.map(o => Math.abs(o.size))
        
        const allReduceOnly = allOrders.filter(o => {
            if (o.coin !== position.coin || !o.reduceOnly) return false
            
            const orderIsSell = o.side === 'SELL'
            const positionIsLong = position.side === 'LONG'
            
            return (positionIsLong && orderIsSell) || (!positionIsLong && !orderIsSell)
        })
        
        const toCancel: DetectedOrder[] = []
        let hasIssues = false
        
        for (const order of allReduceOnly) {
            const orderSize = Math.abs(order.size)
            const orderPrice = order.limitPx
            
            const belongsToEntry = entryOrderSizes.some(s => Math.abs(orderSize - s) < 0.0001)
            if (belongsToEntry) continue
            
            const isProfitable = position.side === 'LONG' ? orderPrice > entryPrice : orderPrice < entryPrice
            const sizeMatch = Math.abs(orderSize - exactSize) < 0.0001
            
            if (!sizeMatch) hasIssues = true
            
            toCancel.push({
                oid: order.oid,
                type: isProfitable ? 'TP' : 'SL',
                price: orderPrice,
                size: orderSize,
                sizeMatch
            })
        }
        
        return { toCancel, hasIssues }
    }
    
    function formatPrice(price: number): string {
        if (!price || price === 0) return '0.00'
        const num = parseFloat(String(price))
        if (isNaN(num)) return '0.00'
        
        const magnitude = Math.floor(Math.log10(Math.abs(num)))
        const precision = 6 - magnitude - 1
        
        if (precision < 0) {
            return num.toExponential(5)
        } else {
            const decimals = Math.max(2, Math.max(0, precision))
            return num.toFixed(decimals)
        }
    }
    
    function updateTPPercentFromPrice(tpPx: number) {
        if (!position || !position.entryPrice) return
        const entryPrice = position.entryPrice
        if (entryPrice <= 0) return
        
        const diff = tpPx - entryPrice
        const percent = (diff / entryPrice) * 100
        const displayPercent = position.side === 'LONG' ? percent : -percent
        setTPPercent(Math.abs(displayPercent).toFixed(2))
    }
    
    function updateTPPriceFromPercent(percent: number) {
        if (!position || !position.entryPrice) return
        const entryPrice = position.entryPrice
        if (entryPrice <= 0) return
        
        const multiplier = position.side === 'LONG' ? (1 + percent / 100) : (1 - percent / 100)
        const price = entryPrice * multiplier
        setTPPrice(formatPrice(price))
    }
    
    function updateSLPercentFromPrice(slPx: number) {
        if (!position || !position.entryPrice) return
        const entryPrice = position.entryPrice
        if (entryPrice <= 0) return
        
        const diff = slPx - entryPrice
        const percent = (diff / entryPrice) * 100
        const displayPercent = position.side === 'LONG' ? -percent : percent
        setSLPercent(Math.abs(displayPercent).toFixed(2))
    }
    
    function updateSLPriceFromPercent(percent: number) {
        if (!position || !position.entryPrice) return
        const entryPrice = position.entryPrice
        if (entryPrice <= 0) return
        
        const multiplier = position.side === 'LONG' ? (1 - percent / 100) : (1 + percent / 100)
        const price = entryPrice * multiplier
        setSLPrice(formatPrice(price))
    }
    
    function handleConfirm() {
        if (!position) return
        
        const newTP = tpPrice ? parseFloat(tpPrice) : undefined
        const newSL = slPrice ? parseFloat(slPrice) : undefined
        
        if (!newTP && !newSL) {
            toast.warning('Please enter at least TP or SL price')
            return
        }
        
        const entryPrice = position.entryPrice
        
        if (newTP) {
            if (newTP <= 0) {
                toast.warning('Invalid TP price')
                return
            }
            const isTPValid = position.side === 'LONG' ? newTP > entryPrice : newTP < entryPrice
            if (!isTPValid) {
                toast.warning(`TP must be ${position.side === 'LONG' ? 'above' : 'below'} entry price ($${formatPrice(entryPrice)})`)
                return
            }
        }
        
        if (newSL) {
            if (newSL <= 0) {
                toast.warning('Invalid SL price')
                return
            }
            const isSLValid = position.side === 'LONG' ? newSL <= currentPrice : newSL >= currentPrice
            if (!isSLValid) {
                toast.warning(`SL must be ${position.side === 'LONG' ? 'at or below' : 'at or above'} current market price ($${formatPrice(currentPrice)})`)
                return
            }
        }
        
        onClose()
        onConfirm({
            asset: position.coin,
            positionSize: Math.abs(position.size),
            positionSide: position.side,
            tp: newTP ? { price: newTP, isMarket: tpOrderType === 'market' } : undefined,
            sl: newSL ? { price: newSL, isMarket: slOrderType === 'market' } : undefined,
            ordersToCancel: detectedOrders.toCancel.map(o => o.oid)
        }).catch((error: any) => {
            console.error('[ModifyPositionModal] Error:', error)
        })
    }
    
    if (!position) return null
    
    const pnl = position.unrealizedPnl || 0
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="⚙️ Modify TP/SL" className="max-w-2xl">
            <div className="bg-secondary/30 border border-border rounded-lg p-3 mb-3">
                <h4 className="text-foreground text-xs font-semibold mb-2">Position Details</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Asset:</span>
                        <span className="font-semibold">{position.coin}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Side:</span>
                        <span className={cn("font-semibold", position.side === 'LONG' ? "text-trade-green" : "text-trade-red")}>
                            {position.side}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Size:</span>
                        <span className="font-semibold">{Math.abs(position.size).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Entry Price:</span>
                        <span className="font-semibold">${formatPrice(position.entryPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Market Price:</span>
                        <span className="font-semibold">${formatPrice(currentPrice)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">PnL:</span>
                        <span className={cn("font-semibold", pnl >= 0 ? "text-trade-green" : "text-trade-red")}>
                            {pnl >= 0 ? '+' : '-'}${formatPrice(Math.abs(pnl))}
                        </span>
                    </div>
                </div>
            </div>
            
            {detectedOrders.toCancel.length > 0 && (
                <div className="bg-orange-500/10 border border-orange-500/30 rounded p-3 mb-3">
                    <p className="text-xs text-orange-400 font-semibold mb-1">🔄 Existing Orders</p>
                    <p className="text-xs text-muted-foreground mb-2">These orders will be cancelled and replaced:</p>
                    <div className="space-y-1">
                        {detectedOrders.toCancel.map((order, idx) => (
                            <div 
                                key={idx}
                                className={cn(
                                    "flex justify-between items-center text-xs px-2 py-1 rounded border-l-2",
                                    order.sizeMatch ? "border-trade-green/50 bg-trade-green/5" : "border-trade-red/50 bg-trade-red/5"
                                )}
                            >
                                <span className={cn("font-semibold", order.type === 'TP' ? "text-trade-green" : "text-trade-red")}>
                                    {order.type}
                                </span>
                                <span>${formatPrice(order.price)}</span>
                                <span className="text-muted-foreground">
                                    Size: {order.size.toFixed(4)} {!order.sizeMatch && '⚠️'}
                                </span>
                            </div>
                        ))}
                    </div>
                    {detectedOrders.hasIssues && (
                        <p className="text-xs text-trade-red mt-2">
                            ⚠️ <strong>Warning:</strong> Some orders have different sizes than your current position.
                        </p>
                    )}
                </div>
            )}
            
            <div className="bg-secondary/50 border border-border rounded-lg p-3 mb-2">
                <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium">Take Profit (Optional)</label>
                    <div className="flex gap-1 bg-black/30 rounded p-0.5">
                        <button 
                            onClick={() => setTPOrderType('limit')}
                            className={cn("px-2 py-0.5 text-xs rounded transition-colors", 
                                tpOrderType === 'limit' ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                            )}
                        >
                            Limit
                        </button>
                        <button 
                            onClick={() => setTPOrderType('market')}
                            className={cn("px-2 py-0.5 text-xs rounded transition-colors", 
                                tpOrderType === 'market' ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                            )}
                        >
                            Market
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <input 
                        type="number"
                        value={tpPrice}
                        onChange={(e) => {
                            setTPPrice(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val > 0) updateTPPercentFromPrice(val)
                        }}
                        placeholder="TP Price"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.00000001"
                    />
                    <input 
                        type="number"
                        value={tpPercent}
                        onChange={(e) => {
                            setTPPercent(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) updateTPPriceFromPercent(val)
                        }}
                        placeholder="Gain %"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.1"
                    />
                </div>
            </div>
            
            <div className="bg-secondary/50 border border-border rounded-lg p-3 mb-3">
                <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-medium">Stop Loss (Optional)</label>
                    <div className="flex gap-1 bg-black/30 rounded p-0.5">
                        <button 
                            onClick={() => setSLOrderType('limit')}
                            className={cn("px-2 py-0.5 text-xs rounded transition-colors", 
                                slOrderType === 'limit' ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                            )}
                        >
                            Limit
                        </button>
                        <button 
                            onClick={() => setSLOrderType('market')}
                            className={cn("px-2 py-0.5 text-xs rounded transition-colors", 
                                slOrderType === 'market' ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
                            )}
                        >
                            Market
                        </button>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <input 
                        type="number"
                        value={slPrice}
                        onChange={(e) => {
                            setSLPrice(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val > 0) updateSLPercentFromPrice(val)
                        }}
                        placeholder="SL Price"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.00000001"
                    />
                    <input 
                        type="number"
                        value={slPercent}
                        onChange={(e) => {
                            setSLPercent(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) updateSLPriceFromPercent(val)
                        }}
                        placeholder="Loss %"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.1"
                    />
                </div>
            </div>
            
            <div className="bg-yellow-500/10 border-l-4 border-yellow-500 rounded-r p-3 mb-4">
                <p className="text-xs text-yellow-400">
                    <strong>⚠️ Note:</strong> Modifying will cancel existing TP/SL orders and place new ones.
                </p>
            </div>
            
            <div className="flex justify-end gap-2 px-4 py-3 bg-secondary/30 -mx-4 -mb-4 rounded-b-lg">
                <button 
                    onClick={onClose}
                    className="px-3 py-1.5 text-xs rounded border border-border hover:bg-secondary transition-colors"
                >
                    Cancel
                </button>
                <button 
                    onClick={handleConfirm}
                    className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                    Confirm
                </button>
            </div>
        </Modal>
    )
}
