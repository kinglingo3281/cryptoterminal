"use client"

import { useState, useEffect, useRef } from "react"
import { Modal } from "@/components/ui/Modal"
import { Order } from "@/types/positions"
import { cn } from "@/lib/utils"
import { getSpotDisplayName } from "@/lib/spot-display"
import { toast } from "sonner"

interface ModifyOrderModalProps {
    isOpen: boolean
    onClose: () => void
    order: Order | null
    orders: Order[]
    currentPrice: number
    onConfirm: (params: ModifyOrderParams) => Promise<void>
}

export interface ModifyOrderParams {
    orderId: number
    asset: string
    newPrice: number
    newSize: number
    side: 'BUY' | 'SELL'
    tp?: { price: number, isMarket: boolean }
    sl?: { price: number, isMarket: boolean }
    ordersToCancel: number[]
}

function isBuySide(side: string): boolean {
    return side === 'BUY' || side === 'LONG'
}

export function ModifyOrderModal({ isOpen, onClose, order, orders, currentPrice, onConfirm }: ModifyOrderModalProps) {
    const [size, setSize] = useState('')
    const [entryPrice, setEntryPrice] = useState('')
    const [entryPercent, setEntryPercent] = useState('')
    const [tpPrice, setTPPrice] = useState('')
    const [tpPercent, setTPPercent] = useState('')
    const [slPrice, setSLPrice] = useState('')
    const [slPercent, setSLPercent] = useState('')
    const [tpOrderType, setTPOrderType] = useState<'limit' | 'market'>('limit')
    const [slOrderType, setSLOrderType] = useState<'limit' | 'market'>('limit')
    const [isTpSlExpanded, setIsTpSlExpanded] = useState(false)
    const [existingTPSL, setExistingTPSL] = useState<{ tp: Order | null, sl: Order | null }>({ tp: null, sl: null })
    const initializedOidRef = useRef<number | null>(null)
    
    useEffect(() => {
        if (isOpen && order) {
            if (initializedOidRef.current === order.oid) return
            initializedOidRef.current = order.oid
            
            const originalSize = Math.abs(order.size)
            const originalPrice = order.limitPx
            
            setSize(originalSize.toFixed(4))
            setEntryPrice(formatPrice(originalPrice))
            updateEntryPercent(originalPrice)
            
            const detected = detectExistingTPSL(order, orders)
            setExistingTPSL(detected)
            
            if (detected.tp) {
                const tpPx = detected.tp.limitPx
                setTPPrice(formatPrice(tpPx))
                updateTPPercentFromPrice(tpPx, originalPrice)
            } else {
                setTPPrice('')
                setTPPercent('')
            }
            
            if (detected.sl) {
                const slPx = detected.sl.limitPx
                setSLPrice(formatPrice(slPx))
                updateSLPercentFromPrice(slPx, originalPrice)
            } else {
                setSLPrice('')
                setSLPercent('')
            }
            
            setTPOrderType('limit')
            setSLOrderType('limit')
            setIsTpSlExpanded(false)
        }
        if (!isOpen) {
            initializedOidRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, order?.oid])
    
    function detectExistingTPSL(order: Order, allOrders: Order[]): { tp: Order | null, sl: Order | null } {
        const entrySize = Math.abs(order.size)
        const entryPrice = order.limitPx
        const isLong = isBuySide(order.side)
        
        const relatedOrders = allOrders.filter(o => {
            if (o.coin !== order.coin || !o.reduceOnly) return false
            
            const orderSize = Math.abs(o.size)
            const sizeDiff = Math.abs(orderSize - entrySize)
            const tolerance = entrySize * 0.01
            
            return sizeDiff <= tolerance
        })
        
        const tp = relatedOrders.find(o => {
            const price = o.limitPx
            return isLong ? price > entryPrice : price < entryPrice
        }) || null
        
        const sl = relatedOrders.find(o => {
            const price = o.limitPx
            return isLong ? price <= entryPrice : price >= entryPrice
        }) || null
        
        return { tp, sl }
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
    
    function updateEntryPercent(price: number) {
        if (!currentPrice || currentPrice <= 0) return
        const diff = price - currentPrice
        const percent = (diff / currentPrice) * 100
        setEntryPercent(percent.toFixed(2))
    }
    
    function updateEntryPriceFromPercent(percent: number) {
        if (!currentPrice || currentPrice <= 0) return
        const price = currentPrice * (1 + percent / 100)
        setEntryPrice(formatPrice(price))
    }
    
    function updateTPPercentFromPrice(tpPx: number, entryPx: number) {
        if (!entryPx || entryPx <= 0 || !order) return
        const isLong = isBuySide(order.side)
        const diff = tpPx - entryPx
        const percent = (diff / entryPx) * 100
        const displayPercent = isLong ? percent : -percent
        setTPPercent(Math.abs(displayPercent).toFixed(2))
    }
    
    function updateTPPriceFromPercent(percent: number) {
        const entryPx = parseFloat(entryPrice)
        if (!entryPx || entryPx <= 0 || !order) return
        const isLong = isBuySide(order.side)
        const multiplier = isLong ? (1 + percent / 100) : (1 - percent / 100)
        const price = entryPx * multiplier
        setTPPrice(formatPrice(price))
    }
    
    function updateSLPercentFromPrice(slPx: number, entryPx: number) {
        if (!entryPx || entryPx <= 0 || !order) return
        const isLong = isBuySide(order.side)
        const diff = slPx - entryPx
        const percent = (diff / entryPx) * 100
        const displayPercent = isLong ? -percent : percent
        setSLPercent(Math.abs(displayPercent).toFixed(2))
    }
    
    function updateSLPriceFromPercent(percent: number) {
        const entryPx = parseFloat(entryPrice)
        if (!entryPx || entryPx <= 0 || !order) return
        const isLong = isBuySide(order.side)
        const multiplier = isLong ? (1 - percent / 100) : (1 + percent / 100)
        const price = entryPx * multiplier
        setSLPrice(formatPrice(price))
    }
    
    function handleConfirm() {
        if (!order) return
        
        const newSize = parseFloat(size)
        const newPrice = parseFloat(entryPrice)
        const newTP = tpPrice ? parseFloat(tpPrice) : undefined
        const newSL = slPrice ? parseFloat(slPrice) : undefined
        
        if (!newSize || newSize <= 0) {
            toast.warning('Invalid size')
            return
        }
        
        if (!newPrice || newPrice <= 0) {
            toast.warning('Invalid price')
            return
        }
        
        const isLong = isBuySide(order.side)
        
        if (newTP) {
            const isTPValid = isLong ? newTP > newPrice : newTP < newPrice
            if (!isTPValid) {
                toast.warning(`TP must be ${isLong ? 'above' : 'below'} entry price ($${formatPrice(newPrice)})`)
                return
            }
        }
        
        if (newSL) {
            const isSLValid = isLong ? newSL <= newPrice : newSL >= newPrice
            if (!isSLValid) {
                toast.warning(`SL must be ${isLong ? 'at or below' : 'at or above'} entry price ($${formatPrice(newPrice)})`)
                return
            }
        }
        
        const ordersToCancel = [order.oid]
        if (existingTPSL.tp) ordersToCancel.push(existingTPSL.tp.oid)
        if (existingTPSL.sl) ordersToCancel.push(existingTPSL.sl.oid)
        
        onClose()
        onConfirm({
            orderId: order.oid,
            asset: order.coin,
            newPrice,
            newSize,
            side: isBuySide(order.side) ? 'BUY' : 'SELL',
            tp: newTP ? { price: newTP, isMarket: tpOrderType === 'market' } : undefined,
            sl: newSL ? { price: newSL, isMarket: slOrderType === 'market' } : undefined,
            ordersToCancel
        }).catch((error: any) => {
            console.error('[ModifyOrderModal] Error:', error)
        })
    }
    
    if (!order) return null
    
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="⚙️ Modify Entry Order" className="max-w-xl">
            <div className="bg-secondary/30 border border-border rounded-lg p-3 mb-3">
                <h4 className="text-foreground text-xs font-semibold mb-2">Order Details</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Asset:</span>
                        <span className="font-semibold">{getSpotDisplayName(order.coin)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Side:</span>
                        <span className={cn("font-semibold", isBuySide(order.side) ? "text-trade-green" : "text-trade-red")}>
                            {order.side}
                        </span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Order Price:</span>
                        <span className="font-semibold">${formatPrice(order.limitPx)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-muted-foreground">Market Price:</span>
                        <span className="font-semibold">${formatPrice(currentPrice)}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                        <span className="text-muted-foreground">Order ID:</span>
                        <span className="font-mono text-xs">{order.oid}</span>
                    </div>
                </div>
            </div>
            
            <div className="bg-secondary/50 border border-border rounded-lg p-3 mb-2">
                <label className="text-xs text-muted-foreground mb-1 block">Order Size</label>
                <input 
                    type="number"
                    value={size}
                    onChange={(e) => setSize(e.target.value)}
                    className="w-full bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                    step="0.0001"
                />
            </div>
            
            <div className="bg-secondary/50 border border-border rounded-lg p-3 mb-2">
                <label className="text-xs text-muted-foreground mb-1 block">Entry Price</label>
                <div className="grid grid-cols-2 gap-2">
                    <input 
                        type="number"
                        value={entryPrice}
                        onChange={(e) => {
                            setEntryPrice(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val) && val > 0) {
                                updateEntryPercent(val)
                                const tpVal = parseFloat(tpPrice)
                                if (!isNaN(tpVal) && tpVal > 0) updateTPPercentFromPrice(tpVal, val)
                                const slVal = parseFloat(slPrice)
                                if (!isNaN(slVal) && slVal > 0) updateSLPercentFromPrice(slVal, val)
                            }
                        }}
                        placeholder="Price"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.00000001"
                    />
                    <input 
                        type="number"
                        value={entryPercent}
                        onChange={(e) => {
                            setEntryPercent(e.target.value)
                            const val = parseFloat(e.target.value)
                            if (!isNaN(val)) updateEntryPriceFromPercent(val)
                        }}
                        placeholder="Distance %"
                        className="bg-background border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary"
                        step="0.1"
                    />
                </div>
            </div>
            
            <div className="border border-border rounded-lg mb-3">
                <button 
                    onClick={() => setIsTpSlExpanded(!isTpSlExpanded)}
                    className="w-full flex justify-between items-center px-3 py-2 hover:bg-secondary/50 transition-colors"
                >
                    <span className="text-xs font-medium">TP/SL Settings (Optional)</span>
                    <span className="text-xs">{isTpSlExpanded ? '▲' : '▼'}</span>
                </button>
                
                {isTpSlExpanded && (
                    <div className="p-3 border-t border-border">
                        {(existingTPSL.tp || existingTPSL.sl) && (
                            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-2 mb-3">
                                <p className="text-xs text-yellow-400 font-semibold mb-1">🔄 Existing Orders</p>
                                <p className="text-xs text-muted-foreground mb-2">Will be cancelled and replaced:</p>
                                <div className="space-y-1">
                                    {existingTPSL.tp && (
                                        <div className="text-xs flex justify-between">
                                            <span className="text-green-400 font-semibold">TP</span>
                                            <span>${formatPrice(existingTPSL.tp.limitPx)}</span>
                                        </div>
                                    )}
                                    {existingTPSL.sl && (
                                        <div className="text-xs flex justify-between">
                                            <span className="text-red-400 font-semibold">SL</span>
                                            <span>${formatPrice(existingTPSL.sl.limitPx)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        
                        <div className="mb-3">
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-medium">Take Profit</label>
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
                                        const entryPx = parseFloat(entryPrice)
                                        if (!isNaN(val) && val > 0 && !isNaN(entryPx) && entryPx > 0) {
                                            updateTPPercentFromPrice(val, entryPx)
                                        }
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
                        
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-medium">Stop Loss</label>
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
                                        const entryPx = parseFloat(entryPrice)
                                        if (!isNaN(val) && val > 0 && !isNaN(entryPx) && entryPx > 0) {
                                            updateSLPercentFromPrice(val, entryPx)
                                        }
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
                    </div>
                )}
            </div>
            
            <div className="bg-yellow-500/10 border-l-4 border-yellow-500 rounded-r p-3 mb-4">
                <p className="text-xs text-yellow-400">
                    <strong>⚠️ Note:</strong> Modifying will cancel the existing order and place a new one with updated parameters.
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
