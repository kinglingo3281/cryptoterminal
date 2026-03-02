"use client"

import { useState, useMemo, useEffect } from "react"
import {
    LayoutList,
    Copy,
    Wallet,
    ClipboardList,
    Timer,
    History,
    Sparkles
} from "lucide-react"
import { cn, formatPrice } from "@/lib/utils"
import { getAssetDisplayName, getHip3Badge, isSpotStablecoin } from '@/lib/spot-display'
import { AISignalsPanel } from "./AISignalsPanel"
import { TradeSignal } from "@/hooks/useTradeDataManager"
import { usePositionsStore } from "@/store/usePositionsStore"
import { useSpotPricesStore } from "@/store/useSpotPricesStore"
import { useSSEData } from "@/providers/SSEProvider"
import { Position, Order } from "@/types/positions"
import { useUserStore } from "@/store/useUserStore"
import { HyperliquidOrderClient } from "@/services/HyperliquidOrderClient"
import { hyperliquid } from "@/services/hyperliquid"
import { ClosePositionModal } from "./ClosePositionModal"
import { ModifyOrderModal, ModifyOrderParams } from "./ModifyOrderModal"
import { ModifyPositionModal, ModifyTPSLParams } from "./ModifyPositionModal"
import { CancelAllOrdersModal } from "./CancelAllOrdersModal"
import { CloseAllPositionsModal } from "./CloseAllPositionsModal"
import { ChaseSettingsModal } from "./ChaseSettingsModal"
import { useChaseTracker } from "@/hooks/useChaseTracker"
import { toast } from "sonner"
import type { ChaseSettings } from "@/types/chase"
import { TradeHistoryContent } from "./TradeHistoryContent"

type TabId = 'positions' | 'copytrade' | 'balances' | 'orders' | 'twap' | 'history' | 'signals'

interface PositionsTableProps {
    onSignalClick?: (signal: TradeSignal) => void;
    onAssetClick?: (asset: string) => void;
}

const TABS = [
    { id: 'positions' as TabId, label: 'Positions', icon: LayoutList },
    // { id: 'copytrade' as TabId, label: 'CopyTrade', icon: Copy },
    { id: 'balances' as TabId, label: 'Balances', icon: Wallet },
    { id: 'orders' as TabId, label: 'Open Orders', icon: ClipboardList },
    // { id: 'twap' as TabId, label: 'Twap', icon: Timer },
    { id: 'history' as TabId, label: 'History', icon: History },
    { id: 'signals' as TabId, label: 'AI Signals', icon: Sparkles, special: true },
]

const mapRawOrderToOrder = (order: any): Order => {
    const rawCoin = String(order.coin || '')
    const dexName = order.dex || ''
    const coin = dexName && dexName !== 'main' && rawCoin && !rawCoin.includes(':')
        ? `${dexName}:${rawCoin}`
        : rawCoin

    const isSpot = coin.startsWith('@')
    const isReduceOnly = order.reduceOnly || order.isPositionTpsl

    let displaySide: Order['side']
    if (isSpot || isReduceOnly) {
        displaySide = order.side === 'B' ? 'BUY' : order.side === 'A' ? 'SELL' : order.side
    } else {
        displaySide = order.side === 'B' ? 'LONG' : order.side === 'A' ? 'SHORT' : order.side
    }

    const rawOid = order.oid ?? order.orderId
    const parsedOid = typeof rawOid === 'number' ? rawOid : parseInt(String(rawOid || 0), 10)

    const isHip3 = coin.includes(':')
    return {
        oid: Number.isFinite(parsedOid) ? parsedOid : 0,
        coin,
        side: displaySide,
        size: parseFloat(order.sz ?? order.size ?? '0') || 0,
        limitPx: parseFloat(order.limitPx ?? order.px ?? order.price ?? '0') || 0,
        isPositionTpsl: Boolean(order.isPositionTpsl),
        reduceOnly: Boolean(order.reduceOnly),
        cloid: order.cloid || null,
        timestamp: order.timestamp,
        orderType: order.orderType || 'Limit',
        dex: isHip3 ? coin.split(':')[0] : (dexName || 'main'),
        isHip3
    }
}

const mapRawPositionToPosition = (assetPos: any, dexName = ''): Position | null => {
    const pos = assetPos?.position
    if (!pos) return null

    const size = parseFloat(pos.szi || '0')
    if (!size || Math.abs(size) === 0) return null

    const rawCoin = String(pos.coin || '')
    const coin = dexName && dexName !== 'main' && rawCoin && !rawCoin.includes(':')
        ? `${dexName}:${rawCoin}`
        : rawCoin

    let liquidationPrice: number | undefined
    if (pos.liquidationPx && pos.liquidationPx !== 'null' && pos.liquidationPx !== null) {
        const parsed = parseFloat(pos.liquidationPx)
        if (!Number.isNaN(parsed) && parsed > 0) {
            liquidationPrice = parsed
        }
    }

    const isHip3 = coin.includes(':')
    return {
        coin,
        size,
        entryPrice: parseFloat(pos.entryPx || 0),
        unrealizedPnl: parseFloat(pos.unrealizedPnl || 0),
        side: size > 0 ? 'LONG' : 'SHORT',
        leverage: parseFloat(pos.leverage?.value || 1),
        liquidationPrice,
        tp: null,
        sl: null,
        dex: isHip3 ? coin.split(':')[0] : (dexName || 'main'),
        isHip3
    }
}

export function PositionsTable({ onSignalClick, onAssetClick }: PositionsTableProps = {}) {
    const [activeTab, setActiveTab] = useState<TabId>('positions')
    const { positions, orders, accountSummary } = usePositionsStore()
    const { allTrades } = useSSEData()
    const { user } = useUserStore()
    const [showCloseAllModal, setShowCloseAllModal] = useState(false)
    const [showCancelAllModal, setShowCancelAllModal] = useState(false)
    const [historyStats, setHistoryStats] = useState({ totalFills: 0, totalVolume: 0, totalFees: 0, realizedPnl: 0 })
    
    // Calculate new signals count (signals from last 15 minutes)
    const newSignalsCount = useMemo(() => {
        const fifteenMinutesAgo = Date.now() - (15 * 60 * 1000)
        return allTrades.filter(signal => {
            const timestamp = signal.file_timestamp || signal.created_at || signal.timestamp
            if (!timestamp) return false
            return new Date(timestamp).getTime() > fifteenMinutesAgo
        }).length
    }, [allTrades])

    const renderTabContent = () => {
        switch (activeTab) {
            case 'signals':
                return <AISignalsContent onSignalClick={onSignalClick} />
            case 'positions':
                return <PositionsContent 
                    showCloseAllModal={showCloseAllModal}
                    setShowCloseAllModal={setShowCloseAllModal}
                    showCancelAllModal={showCancelAllModal}
                    setShowCancelAllModal={setShowCancelAllModal}
                    onAssetClick={onAssetClick}
                />
            // case 'copytrade':
            //     return <EmptyTabContent title="CopyTrade" description="Copy trading signals will appear here." />
            case 'balances':
                return <BalancesContent />
            case 'orders':
                return <OrdersContent 
                    showCancelAllModal={showCancelAllModal}
                    setShowCancelAllModal={setShowCancelAllModal}
                    onAssetClick={onAssetClick}
                />
            // case 'twap':
            //     return <EmptyTabContent title="TWAP Orders" description="Time-weighted average price orders will appear here." />
            case 'history':
                return <TradeHistoryContent userAddress={user?.wallet_address || null} onStatsChange={setHistoryStats} />
            default:
                return <PositionsContent 
                    showCloseAllModal={showCloseAllModal}
                    setShowCloseAllModal={setShowCloseAllModal}
                    showCancelAllModal={showCancelAllModal}
                    setShowCancelAllModal={setShowCancelAllModal}
                    onAssetClick={onAssetClick}
                />
        }
    }

    return (
        <div className="flex flex-col h-full w-full">
            {/* Tabs */}
            <div className="flex items-center gap-1 px-2 pt-2 border-b border-border bg-card">
                {TABS.map((tab) => {
                    const isActive = activeTab === tab.id
                    const Icon = tab.icon
                    
                    // Get badge count for each tab
                    let badgeCount = 0
                    if (tab.id === 'positions') badgeCount = positions.length
                    if (tab.id === 'orders') badgeCount = orders.length
                    if (tab.id === 'signals') badgeCount = newSignalsCount
                    if (tab.id === 'balances') {
                        // Count perps USDC + non-zero spot balances
                        const perpCount = (accountSummary?.accountValue && accountSummary.accountValue > 0) ? 1 : 0
                        const spotCount = accountSummary?.spotBalances?.filter(b => b.total > 0).length || 0
                        badgeCount = perpCount + spotCount
                    }

                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-t",
                                isActive
                                    ? "text-foreground border-b-2 border-primary bg-primary/5"
                                    : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                                tab.special && !isActive && "text-primary/70 hover:text-primary"
                            )}
                        >
                            <Icon className={cn(
                                "h-3.5 w-3.5",
                                tab.special && "text-primary"
                            )} />
                            {tab.label}
                            {(tab.id === 'positions' || tab.id === 'orders' || tab.id === 'signals' || tab.id === 'balances') && (
                                <span className={cn(
                                    "ml-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full",
                                    isActive 
                                        ? "bg-trade-green/10 text-trade-green" 
                                        : "bg-secondary text-muted-foreground"
                                )}>
                                    {badgeCount}
                                </span>
                            )}
                        </button>
                    )
                })}
                
                <div className="flex-1"></div>
                <div className="flex gap-2 mb-1">
                    {activeTab === 'positions' && positions.length > 0 && (
                        <button 
                            onClick={() => setShowCloseAllModal(true)}
                            className="px-3 py-1.5 text-xs font-medium bg-trade-red/20 border border-trade-red/30 rounded text-trade-red hover:bg-trade-red/30 transition-colors"
                        >
                            Close All
                        </button>
                    )}
                    {activeTab === 'orders' && orders.length > 0 && (
                        <button 
                            onClick={() => setShowCancelAllModal(true)}
                            className="px-3 py-1.5 text-xs font-medium bg-trade-red/20 border border-trade-red/30 rounded text-trade-red hover:bg-trade-red/30 transition-colors"
                        >
                            Cancel All
                        </button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col bg-card/50 overflow-hidden">
                {renderTabContent()}
            </div>
        </div>
    )
}

interface PositionsContentProps {
    showCloseAllModal: boolean
    setShowCloseAllModal: (show: boolean) => void
    showCancelAllModal: boolean
    setShowCancelAllModal: (show: boolean) => void
    onAssetClick?: (asset: string) => void
}

function PositionsContent({ showCloseAllModal, setShowCloseAllModal, showCancelAllModal, setShowCancelAllModal, onAssetClick }: PositionsContentProps) {
    const { positions, accountSummary, isUsingFallback, orders } = usePositionsStore()
    const { apiKeys, user } = useUserStore()
    const spotPrices = useSpotPricesStore(state => state.prices)
    const { startChase } = useChaseTracker()
    
    const [showCloseModal, setShowCloseModal] = useState(false)
    const [selectedPosition, setSelectedPosition] = useState<string | null>(null)
    const [showModifyOrderModal, setShowModifyOrderModal] = useState(false)
    const [selectedOrderForModify, setSelectedOrderForModify] = useState<Order | null>(null)
    const [showModifyPositionModal, setShowModifyPositionModal] = useState(false)
    const [selectedPositionForModify, setSelectedPositionForModify] = useState<Position | null>(null)
    const [orderClient, setOrderClient] = useState<HyperliquidOrderClient | null>(null)
    const [cancelAllOrdersData, setCancelAllOrdersData] = useState<Order[]>(orders)
    const [closeAllPositionsData, setCloseAllPositionsData] = useState<Position[]>(positions)
    
    useEffect(() => {
        if (apiKeys?.hyperliquid?.apiKey) {
            const client = new HyperliquidOrderClient()
            client.initialize(apiKeys.hyperliquid.apiKey).then(() => {
                setOrderClient(client)
                console.log('[PositionsTable] Order client initialized')
            }).catch(err => {
                console.error('[PositionsTable] Failed to initialize client:', err)
            })
        }
    }, [apiKeys])

    useEffect(() => {
        if (!showCancelAllModal) {
            setCancelAllOrdersData(orders)
        }
    }, [orders, showCancelAllModal])

    useEffect(() => {
        if (!showCloseAllModal) {
            setCloseAllPositionsData(positions)
        }
    }, [positions, showCloseAllModal])

    useEffect(() => {
        if (!showCancelAllModal || !orderClient || !user?.wallet_address) return

        let isActive = true
        ;(async () => {
            try {
                const rawOrders = await orderClient.getAllUserOrdersAllDexs()
                const mapped = rawOrders.map(mapRawOrderToOrder).filter(order => order.coin)
                if (isActive && mapped.length > 0) {
                    setCancelAllOrdersData(mapped)
                }
            } catch (error) {
                console.warn('[PositionsTable] Failed to fetch cross-DEX orders:', error)
            }
        })()

        return () => {
            isActive = false
        }
    }, [showCancelAllModal, orderClient, user?.wallet_address])

    useEffect(() => {
        const client = orderClient
        const walletAddress = user?.wallet_address
        if (!showCloseAllModal || !client || !walletAddress) return

        let isActive = true
        ;(async () => {
            try {
                const states = await client.getAllUserStates(walletAddress)
                const mapped = states.reduce<Position[]>((acc, { dex, state }) => {
                    const assetPositions = state?.assetPositions || []
                    assetPositions.forEach((assetPos: any) => {
                        const mappedPos = mapRawPositionToPosition(assetPos, dex || '')
                        if (mappedPos) {
                            acc.push(mappedPos)
                        }
                    })
                    return acc
                }, [])

                if (isActive && mapped.length > 0) {
                    setCloseAllPositionsData(mapped)
                }
            } catch (error) {
                console.warn('[PositionsTable] Failed to fetch cross-DEX positions:', error)
            }
        })()

        return () => {
            isActive = false
        }
    }, [showCloseAllModal, orderClient, user?.wallet_address])
    
    // Debug TP/SL detection
    useEffect(() => {
        if (positions.length > 0 && orders.length > 0) {
            const pos = positions[0]
            const assetOrders = orders.filter(o => o.coin === pos.coin)
            const reduceOnlyOrders = assetOrders.filter(o => o.reduceOnly)
            console.log('[PositionsTable] TP/SL Detection Debug:', {
                asset: pos.coin,
                positionSide: pos.side,
                positionSize: Math.abs(pos.size),
                totalOrders: orders.length,
                assetOrders: assetOrders.length,
                reduceOnlyCount: reduceOnlyOrders.length,
                allOrdersSample: assetOrders.map(o => ({
                    side: o.side,
                    size: o.size,
                    reduceOnly: o.reduceOnly,
                    limitPx: o.limitPx
                }))
            })
        }
    }, [positions, orders])
    
    const handleCloseClick = (asset: string) => {
        setSelectedPosition(asset)
        setShowCloseModal(true)
    }
    
    const handleModifyPosition = (position: Position) => {
        setSelectedPositionForModify(position)
        setShowModifyPositionModal(true)
    }
    
    // Helper to detect TP/SL orders for a position (based on ModifyOrderModal logic)
    const detectPositionTPSL = (position: Position): { tp: number | null, sl: number | null } => {
        const positionSize = Math.abs(position.size)
        const entryPrice = position.entryPrice
        const isLong = position.side === 'LONG'
        
        // Get ALL orders for this asset first to debug
        const assetOrders = orders.filter(o => o.coin === position.coin)
        
        // Filter reduce-only orders for this asset
        const reduceOnlyOrders = assetOrders.filter(o => o.reduceOnly)
        
        // Then filter by opposite side
        const relatedOrders = reduceOnlyOrders.filter(o => {
            const orderIsSell = o.side === 'SELL'
            const correctSide = isLong ? orderIsSell : !orderIsSell
            return correctSide
        })
        
        // Classify TP/SL based on price direction relative to entry
        let tp: number | null = null
        let sl: number | null = null
        
        for (const order of relatedOrders) {
            const orderPrice = order.limitPx
            
            if (isLong) {
                // LONG: TP above entry, SL below entry
                if (orderPrice > entryPrice) {
                    tp = orderPrice
                } else if (orderPrice <= entryPrice) {
                    sl = orderPrice
                }
            } else {
                // SHORT: TP below entry, SL above entry
                if (orderPrice < entryPrice) {
                    tp = orderPrice
                } else if (orderPrice >= entryPrice) {
                    sl = orderPrice
                }
            }
        }
        
        return { tp, sl }
    }
    
    const handleModifyPositionConfirm = async (params: ModifyTPSLParams) => {
        if (!orderClient || !user?.wallet_address) return
        
        try {
            // Cancel existing TP/SL orders
            for (const oid of params.ordersToCancel) {
                await orderClient.cancelOrder(oid, params.asset)
            }
            
            // Place new TP/SL orders
            const result = await orderClient.setTPSL({
                asset: params.asset,
                positionSize: params.positionSize,
                side: params.positionSide,
                userAddress: user.wallet_address,
                tp: params.tp,
                sl: params.sl
            })
            
            if (result.success) {
                console.log('[PositionsTable] TP/SL modified:', result.message)
            } else {
                console.error('[PositionsTable] Modify TP/SL failed:', result.error)
                toast.error(result.error || 'Modify TP/SL failed')
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error modifying TP/SL:', error)
            toast.error(error.message)
        }
    }
    
    const handleCloseConfirm = async (method: 'market' | 'limit' | 'chase') => {
        if (!orderClient || !selectedPosition) {
            console.error('[PositionsTable] Order client or position not available')
            return
        }
        
        try {
            if (method === 'market') {
                console.log(`[PositionsTable] Closing ${selectedPosition} with market order...`)
                const userAddress = user?.wallet_address
                if (!userAddress) {
                    toast.error('Wallet address not found')
                    return
                }
                const result = await orderClient.closePosition(selectedPosition, userAddress)
                
                if (result.success) {
                    console.log('[PositionsTable] Position closed:', result.message)
                } else {
                    console.error('[PositionsTable] Close failed:', result.error)
                    toast.error(`Close failed: ${result.error}`)
                }
            } else if (method === 'limit') {
                const userAddress = user?.wallet_address
                if (!userAddress) {
                    toast.error('Wallet address not found')
                    return
                }
                const result = await orderClient.closePositionLimit(selectedPosition, userAddress)
                if (result.success) {
                    console.log('[PositionsTable] Limit close submitted:', result.message)
                } else {
                    console.error('[PositionsTable] Limit close failed:', result.error)
                    toast.error(`Limit close failed: ${result.error}`)
                }
            } else if (method === 'chase') {
                const position = positions.find(p => p.coin === selectedPosition)
                if (!position) {
                    toast.error('Position not found')
                    return
                }

                const isLong = position.side === 'LONG'
                const size = Math.abs(position.size)
                const { bestBid, bestAsk } = await orderClient.getBestBidAsk(selectedPosition)
                const price = isLong ? bestBid : bestAsk

                if (!price || price <= 0) {
                    toast.error('Could not fetch price for chase close')
                    return
                }

                const orderResult = await orderClient.executeTradingOrder({
                    asset: selectedPosition,
                    orderSide: isLong ? 'sell' : 'buy',
                    size,
                    price,
                    orderType: 'limit',
                    timeInForce: 'GTC',
                    reduceOnly: true,
                    leverage: null,
                    isCrossMargin: true,
                    tpslEnabled: false,
                    tpPrice: null,
                    slPrice: null
                })

                if (!orderResult.success) {
                    toast.error(`Chase close order failed: ${orderResult.error || 'Unknown'}`)
                    return
                }

                const status = orderResult.result?.response?.data?.statuses?.[0]
                const oid = orderResult.oid || status?.resting?.oid || status?.filled?.oid
                const wasFilledImmediately = Boolean(status?.filled?.oid)

                if (oid && !wasFilledImmediately) {
                    const chaseSettings: ChaseSettings = {
                        tickDistance: 1,
                        percentDistance: undefined,
                        isPercent: false,
                        frequencyRangeMin: 5,
                        frequencyRangeMax: 5,
                        aggressive: true,
                        useAnchor: false,
                        tpslEnabled: false,
                        tpAtrMultiple: 0,
                        slAtrMultiple: 0
                    }

                    const posIsHip3 = selectedPosition.includes(':')
                    const chaseOrder: Order = {
                        oid: parseInt(String(oid), 10),
                        coin: selectedPosition,
                        side: isLong ? 'SELL' : 'BUY',
                        size,
                        limitPx: price,
                        isPositionTpsl: false,
                        reduceOnly: true,
                        dex: posIsHip3 ? selectedPosition.split(':')[0] : 'main',
                        isHip3: posIsHip3
                    }

                    const chaseResult = await startChase(String(oid), chaseOrder, chaseSettings)
                    if (!chaseResult.success) {
                        toast.error(`Chase close failed: ${chaseResult.error || 'Unknown'}`)
                    }
                }
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error closing position:', error)
            toast.error(error.message)
        } finally {
            setSelectedPosition(null)
        }
    }
    
    const handleCancelAllConfirm = async () => {
        if (!orderClient || !user?.wallet_address) return
        
        try {
            const ordersToCancel = cancelAllOrdersData.length > 0 ? cancelAllOrdersData : orders
            const orderData = ordersToCancel.map(order => ({
                orderId: String(order.oid || order.cloid),
                asset: order.coin,
                reduceOnly: order.reduceOnly || false
            }))
            
            const result = await orderClient.cancelMultipleOrders(orderData)
            
            if (result.success) {
                toast.success(`Cancelled ${result.successCount}/${result.totalOrders} orders`)
            } else {
                toast.error(`Cancel failed: ${result.errors.join(', ')}`)
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error cancelling all orders:', error)
            toast.error(`Cancel failed: ${error.message}`)
        }
    }
    
    const handleCloseAllConfirm = async (method: 'market' | 'limit') => {
        if (!orderClient || !user?.wallet_address) return
        
        try {
            const positionsToClose = closeAllPositionsData.length > 0 ? closeAllPositionsData : positions
            const positionData = positionsToClose.map(position => ({
                asset: position.coin,
                userAddress: user.wallet_address!
            }))
            
            let result
            if (method === 'limit') {
                result = await orderClient.closeMultiplePositionsLimit(positionData)
            } else {
                result = await orderClient.closeMultiplePositions(positionData)
            }
            
            if (result.success) {
                toast.success(`Closed ${result.successCount}/${result.totalPositions} positions (${method})`)
            } else {
                toast.error(`Close failed: ${result.errors.join(', ')}`)
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error closing all positions:', error)
            toast.error(`Close failed: ${error.message}`)
        }
    }
    
    if (positions.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <svg className="w-12 h-12 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
                <h3 className="text-sm font-medium">No Open Positions</h3>
                <p className="text-xs opacity-70">Your active perpetual positions will appear here when opened.</p>
                {isUsingFallback && (
                    <p className="text-xs text-yellow-500 mt-2">⚠️ Using backup mode (slower updates)</p>
                )}
            </div>
        )
    }
    
    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
                <thead className="sticky top-0 bg-secondary/40 border-b border-border">
                    <tr className="text-muted-foreground">
                        <th className="text-left px-3 py-2 font-medium">Symbol</th>
                        <th className="text-right px-3 py-2 font-medium">Side</th>
                        <th className="text-right px-3 py-2 font-medium">Size</th>
                        <th className="text-right px-3 py-2 font-medium">Entry</th>
                        <th className="text-right px-3 py-2 font-medium">PnL</th>
                        <th className="text-right px-3 py-2 font-medium">TP</th>
                        <th className="text-right px-3 py-2 font-medium">SL</th>
                        <th className="text-right px-3 py-2 font-medium">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {positions.map((position: Position) => {
                        const hip3Badge = getHip3Badge(position.coin)
                        return (<tr 
                            key={position.coin}
                            className="border-b border-border/50 hover:bg-white/5 transition-colors"
                        >
                            <td className="px-3 py-2 font-medium text-foreground">
                                <span 
                                    onClick={() => onAssetClick?.(position.coin)}
                                    className="cursor-pointer hover:text-primary transition-colors"
                                >
                                    {getAssetDisplayName(position.coin)}
                                    {hip3Badge && (
                                        <span className="ml-1 px-1 py-0.5 rounded text-[8px] bg-violet-500/20 text-violet-400 font-medium">
                                            {hip3Badge}
                                        </span>
                                    )}
                                </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                                <span className={cn(
                                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                    position.side === 'LONG' 
                                        ? "bg-green-500/20 text-green-400" 
                                        : "bg-red-500/20 text-red-400"
                                )}>
                                    {position.side}
                                </span>
                            </td>
                            <td className="px-3 py-2 text-right text-foreground">
                                {Math.abs(position.size).toFixed(hyperliquid.getSzDecimalsSync(position.coin))}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                                ${formatPrice(position.entryPrice)}
                            </td>
                            <td className={cn(
                                "px-3 py-2 text-right font-medium",
                                position.unrealizedPnl >= 0 ? "text-green-400" : "text-red-400"
                            )}>
                                ${position.unrealizedPnl.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                                {(() => {
                                    const detected = detectPositionTPSL(position)
                                    return detected.tp ? `$${formatPrice(detected.tp)}` : '-'
                                })()}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                                {(() => {
                                    const detected = detectPositionTPSL(position)
                                    return detected.sl ? `$${formatPrice(detected.sl)}` : '-'
                                })()}
                            </td>
                            <td className="px-3 py-2 text-right">
                                <button 
                                    onClick={() => handleModifyPosition(position)}
                                    className="px-2 py-0.5 text-[10px] bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30 transition-colors mr-1"
                                >
                                    Modify
                                </button>
                                <button 
                                    onClick={() => handleCloseClick(position.coin)}
                                    className="px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                                >
                                    Close
                                </button>
                            </td>
                        </tr>)
                    })}
                </tbody>
            </table>
            
            <ClosePositionModal
                isOpen={showCloseModal}
                onClose={() => setShowCloseModal(false)}
                asset={selectedPosition || ''}
                onConfirm={handleCloseConfirm}
            />
            
            <ModifyPositionModal
                isOpen={showModifyPositionModal}
                onClose={() => {
                    setShowModifyPositionModal(false)
                    setSelectedPositionForModify(null)
                }}
                position={selectedPositionForModify}
                currentPrice={selectedPositionForModify ? spotPrices[selectedPositionForModify.coin] || 0 : 0}
                orders={orders}
                onConfirm={handleModifyPositionConfirm}
            />
            
            <CancelAllOrdersModal
                isOpen={showCancelAllModal}
                onClose={() => setShowCancelAllModal(false)}
                orders={cancelAllOrdersData.length > 0 ? cancelAllOrdersData : orders}
                onConfirm={handleCancelAllConfirm}
            />
            
            <CloseAllPositionsModal
                isOpen={showCloseAllModal}
                onClose={() => setShowCloseAllModal(false)}
                positions={closeAllPositionsData.length > 0 ? closeAllPositionsData : positions}
                onConfirm={handleCloseAllConfirm}
            />
        </div>
    )
}

interface OrdersContentProps {
    showCancelAllModal: boolean
    setShowCancelAllModal: (show: boolean) => void
    onAssetClick?: (asset: string) => void
}

function OrdersContent({ showCancelAllModal, setShowCancelAllModal, onAssetClick }: OrdersContentProps) {
    const { orders, isUsingFallback } = usePositionsStore()
    const { apiKeys, user } = useUserStore()
    const spotPrices = useSpotPricesStore(state => state.prices)
    
    const [orderClient, setOrderClient] = useState<HyperliquidOrderClient | null>(null)
    const [showModifyOrderModal, setShowModifyOrderModal] = useState(false)
    const [selectedOrderForModify, setSelectedOrderForModify] = useState<Order | null>(null)
    const [showChaseModal, setShowChaseModal] = useState(false)
    const [selectedOrderForChase, setSelectedOrderForChase] = useState<Order | null>(null)
    const [cancelAllOrdersData, setCancelAllOrdersData] = useState<Order[]>(orders)
    const { startChase, stopChase, isOrderChased, getChaseForOrder } = useChaseTracker()
    
    useEffect(() => {
        if (apiKeys?.hyperliquid?.apiKey) {
            const client = new HyperliquidOrderClient()
            client.initialize(apiKeys.hyperliquid.apiKey).then(() => {
                setOrderClient(client)
            }).catch(console.error)
        }
    }, [apiKeys])

    useEffect(() => {
        if (!showCancelAllModal) {
            setCancelAllOrdersData(orders)
        }
    }, [orders, showCancelAllModal])

    useEffect(() => {
        if (!showCancelAllModal || !orderClient || !user?.wallet_address) return

        let isActive = true
        ;(async () => {
            try {
                const rawOrders = await orderClient.getAllUserOrdersAllDexs()
                const mapped = rawOrders.map(mapRawOrderToOrder).filter(order => order.coin)
                if (isActive && mapped.length > 0) {
                    setCancelAllOrdersData(mapped)
                }
            } catch (error) {
                console.warn('[PositionsTable] Failed to fetch cross-DEX orders:', error)
            }
        })()

        return () => {
            isActive = false
        }
    }, [showCancelAllModal, orderClient, user?.wallet_address])
    
    const handleCancelAllConfirm = async () => {
        if (!orderClient || !user?.wallet_address) return
        
        try {
            const ordersToCancel = cancelAllOrdersData.length > 0 ? cancelAllOrdersData : orders
            const orderData = ordersToCancel.map(order => ({
                asset: order.coin,
                orderId: String(order.oid || order.cloid),
                reduceOnly: order.reduceOnly || false
            }))
            
            const result = await orderClient.cancelMultipleOrders(orderData)
            
            if (result.success) {
                toast.success(`Cancelled ${result.successCount}/${result.totalOrders} orders`)
            } else {
                toast.error(`Cancel failed: ${result.errors.join(', ')}`)
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error cancelling all orders:', error)
            toast.error(`Cancel failed: ${error.message}`)
        }
    }
    
    const handleModifyOrder = (order: Order) => {
        if (order.reduceOnly || order.isPositionTpsl) {
            toast.warning('Cannot modify TP/SL orders directly. Modify from the position.')
            return
        }
        setSelectedOrderForModify(order)
        setShowModifyOrderModal(true)
    }
    
    const handleModifyOrderConfirm = async (params: ModifyOrderParams) => {
        if (!orderClient || !user?.wallet_address) return
        
        try {
            // Cancel old orders
            for (const oid of params.ordersToCancel) {
                await orderClient.cancelOrder(oid, params.asset)
            }
            
            // Place new order with TP/SL
            const result = await orderClient.modifyOrder({
                asset: params.asset,
                price: params.newPrice,
                size: params.newSize,
                side: params.side,
                userAddress: user.wallet_address,
                tp: params.tp,
                sl: params.sl
            })
            
            if (result.success) {
                console.log('[PositionsTable] Order modified:', result.message)
            } else {
                console.error('[PositionsTable] Modify order failed:', result.error)
                toast.error(result.error || 'Modify TP/SL failed')
            }
        } catch (error: any) {
            console.error('[PositionsTable] Error modifying order:', error)
            toast.error(error.message)
        }
    }
    
    const handleCancelOrder = async (orderId: number, asset: string) => {
        if (!orderClient) {
            console.error('[PositionsTable] Order client not initialized')
            return
        }
        
        try {
            console.log(`[PositionsTable] Cancelling order ${orderId} for ${asset}...`)
            const result = await orderClient.cancelOrder(orderId, asset)
            
            if (result.success) {
                console.log('[PositionsTable] Order cancelled:', result.message)
            } else {
                console.error('[PositionsTable] Cancel failed:', result.error)
                toast.error(`Cancel failed: ${result.error}`)
            }
        } catch (error: any) {
            toast.error(error.message)
        }
    }
    
    const handleChaseClick = (order: Order) => {
        const chase = getChaseForOrder(String(order.oid))
        
        if (chase) {
            // Already chasing - stop it
            stopChase(chase.chaseId)
        } else {
            // Start chase - open modal
            setSelectedOrderForChase(order)
            setShowChaseModal(true)
        }
    }
    
    const handleChaseConfirm = async (settings: ChaseSettings) => {
        if (!selectedOrderForChase) return
        
        const result = await startChase(
            String(selectedOrderForChase.oid),
            selectedOrderForChase,
            settings
        )
        
        if (result.success) {
            console.log(`[PositionsTable] Chase started for ${selectedOrderForChase.coin}`)
        } else {
            toast.error(`Chase failed: ${result.error}`)
        }
    }
    
    if (orders.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <svg className="w-12 h-12 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h3 className="text-sm font-medium">No Open Orders</h3>
                <p className="text-xs opacity-70">Your open orders will appear here.</p>
                {isUsingFallback && (
                    <div className="mt-2 px-2 py-1 bg-orange-500/20 text-orange-400 rounded text-xs">
                        Using fallback mode - data may be delayed
                    </div>
                )}
            </div>
        )
    }
    
    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
                <thead className="sticky top-0 bg-secondary/40 border-b border-border">
                    <tr className="text-muted-foreground">
                        <th colSpan={6} className="p-0">
                            <div className="grid items-center" style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 1.5fr 1.5fr' }}>
                                <div className="text-left px-3 py-2 font-medium">Symbol</div>
                                <div className="text-right px-3 py-2 font-medium">Side</div>
                                <div className="text-right px-3 py-2 font-medium">Size</div>
                                <div className="text-right px-3 py-2 font-medium">Price</div>
                                <div className="text-center px-3 py-2 font-medium">Type</div>
                                <div className="text-right px-3 py-2 font-medium">Actions</div>
                            </div>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map((order) => {
                        const isChasing = isOrderChased(String(order.oid))
                        const chaseData = isChasing ? getChaseForOrder(String(order.oid)) : null
                        const orderHip3Badge = getHip3Badge(order.coin)
                        return (
                        <tr 
                            key={order.oid}
                            className={cn(
                                "border-b border-border/50 hover:bg-white/5 transition-colors"
                            )}
                        >
                            <td colSpan={6} className="p-0">
                                <div
                                    className="group/row relative grid items-center"
                                    style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 1.5fr 1.5fr' }}
                                >
                                    {isChasing && (
                                        <span
                                            className="absolute left-0 top-0 bottom-0 w-[2px] rounded-full bg-chart-4"
                                            style={{ animation: 'chase-pulse 1.5s ease-in-out infinite' }}
                                            aria-hidden="true"
                                        />
                                    )}

                                    {isChasing && (
                                        <span
                                            className="pointer-events-none absolute inset-0 overflow-hidden opacity-0 group-hover/row:opacity-100"
                                            aria-hidden="true"
                                        >
                                            <span
                                                className="absolute inset-y-0 -left-1/2 w-[40%] rotate-[16deg] bg-gradient-to-r from-transparent via-chart-4/10 to-transparent"
                                                style={{ animation: 'chase-scan 1.2s linear infinite' }}
                                            />
                                        </span>
                                    )}

                                    <div className={cn(
                                        "px-3 py-2 font-medium text-foreground",
                                        isChasing && "pl-6"
                                    )}>
                                        <span 
                                            onClick={() => onAssetClick?.(order.coin)}
                                            className="cursor-pointer hover:text-primary transition-colors"
                                        >
                                            {getAssetDisplayName(order.coin)}
                                            {orderHip3Badge && (
                                                <span className="ml-1 px-1 py-0.5 rounded text-[8px] bg-violet-500/20 text-violet-400 font-medium">
                                                    {orderHip3Badge}
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="px-3 py-2 text-right">
                                        <span
                                            className={cn(
                                                "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                                (['BUY', 'LONG'].includes(order.side))
                                                    ? "bg-trade-green/20 text-trade-green"
                                                    : "bg-trade-red/20 text-trade-red"
                                            )}
                                        >
                                            {order.side}
                                        </span>
                                    </div>
                                    <div className="px-3 py-2 text-right text-foreground">
                                        {order.size.toFixed(hyperliquid.getSzDecimalsSync(order.coin))}
                                    </div>
                                    <div className="px-3 py-2 text-right text-muted-foreground">
                                        ${formatPrice(order.limitPx)}
                                    </div>
                                    <div className="px-3 py-2 flex items-center justify-center">
                                        <div className="inline-flex items-center gap-1">
                                            {order.isPositionTpsl && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400">
                                                    TP/SL
                                                </span>
                                            )}
                                            {order.reduceOnly && !order.isPositionTpsl && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400">
                                                    Reduce
                                                </span>
                                            )}
                                            {!order.isPositionTpsl && !order.reduceOnly && (
                                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-chart-1/20 text-chart-1">
                                                    Limit
                                                </span>
                                            )}
                                            {isChasing && chaseData && (
                                                <>
                                                    <span 
                                                        className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-chart-4/20 text-chart-4 border border-chart-4/40"
                                                        style={{ animation: 'chase-pulse 1.5s ease-in-out infinite' }}
                                                    >
                                                        CHASE
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-chart-4/20 text-chart-4 border border-chart-4/40 whitespace-nowrap">
                                                        Mods: {chaseData.modificationCount}x
                                                        {(() => {
                                                            const midPrice = spotPrices[order.coin] || 0;
                                                            const orderPrice = order.limitPx;
                                                            // Use tickSize from chase metadata (consistent with ChaseService)
                                                            const tickSize = chaseData.tickSize || 1;
                                                            const ticksAway = midPrice > 0 && tickSize > 0
                                                                ? Math.round(Math.abs(orderPrice - midPrice) / tickSize)
                                                                : null;
                                                            return ticksAway !== null ? ` | Distance: ${ticksAway} Ticks` : '';
                                                        })()}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="px-3 py-2 text-right">
                                        {!order.isPositionTpsl && !order.reduceOnly && !isSpotStablecoin(order.coin) && (
                                            <button
                                                onClick={() => handleChaseClick(order)}
                                                className={cn(
                                                    "px-2 py-0.5 text-[10px] rounded transition-colors mr-1",
                                                    isChasing
                                                        ? "bg-chart-4 text-black border border-chart-4 hover:bg-chart-4/90"
                                                        : "bg-chart-4/20 text-chart-4 border border-chart-4/40 hover:bg-chart-4/30"
                                                )}
                                            >
                                                {isChasing ? 'Stop' : 'Chase'}
                                            </button>
                                        )}
                                        {!order.isPositionTpsl && !order.reduceOnly && !isSpotStablecoin(order.coin) && (
                                        <button
                                            onClick={() => handleModifyOrder(order)}
                                            className="px-2 py-0.5 text-[10px] bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30 transition-colors mr-1"
                                        >
                                            Modify
                                        </button>
                                        )}
                                        <button
                                            onClick={() => handleCancelOrder(order.oid, order.coin)}
                                            className="px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded hover:bg-red-500/30 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        )
                    })}
                </tbody>
            </table>
            
            <ModifyOrderModal
                isOpen={showModifyOrderModal}
                onClose={() => {
                    setShowModifyOrderModal(false)
                    setSelectedOrderForModify(null)
                }}
                order={selectedOrderForModify}
                orders={orders}
                currentPrice={selectedOrderForModify ? spotPrices[selectedOrderForModify.coin] || 0 : 0}
                onConfirm={handleModifyOrderConfirm}
            />
            
            <CancelAllOrdersModal
                isOpen={showCancelAllModal}
                onClose={() => setShowCancelAllModal(false)}
                orders={cancelAllOrdersData.length > 0 ? cancelAllOrdersData : orders}
                onConfirm={handleCancelAllConfirm}
            />
            
            <ChaseSettingsModal
                isOpen={showChaseModal}
                onClose={() => {
                    setShowChaseModal(false)
                    setSelectedOrderForChase(null)
                }}
                order={selectedOrderForChase}
                onConfirm={handleChaseConfirm}
            />
        </div>
    )
}

function BalancesContent() {
    const { accountSummary } = usePositionsStore()
    const prices = useSpotPricesStore(state => state.prices)
    
    // Spot tokens that map to perp prices
    const SPOT_TO_PERP_MAP: Record<string, string> = {
        'UBTC': 'BTC',
        'UETH': 'ETH',
        'USOL': 'SOL'
    }
    
    // Build complete balances array with USD values
    const allBalances: Array<{
        name: string;
        symbol: string;
        type: 'perp' | 'spot';
        amount: number;
        available: number;
        hold: number;
        usdValue: number;
        isStablecoin: boolean;
    }> = []
    
    // Add USDC (Perps)
    if (accountSummary?.accountValue && accountSummary.accountValue > 0) {
        allBalances.push({
            name: 'USDC (Perps)',
            symbol: 'USDC',
            type: 'perp',
            amount: accountSummary.accountValue,
            available: accountSummary.availableForTrading || 0,
            hold: accountSummary.accountValue - (accountSummary.availableForTrading || 0),
            usdValue: accountSummary.accountValue,
            isStablecoin: true
        })
    }
    
    // Add spot balances
    accountSummary?.spotBalances?.forEach(bal => {
        if (bal.total <= 0) return;
        
        // Calculate USD value
        let usdValue = 0;
        
        // Stablecoins are always $1 (USDC, USDH)
        if (bal.coin === 'USDC' || bal.coin === 'USDH') {
            usdValue = bal.total;
        } else {
            // Try to find price for this token
            // 1. First try coin name directly
            let price = prices[bal.coin];
            
            // 2. Try mapped perp name for spot tokens (UBTC->BTC, etc.)
            if (!price) {
                const perpName = SPOT_TO_PERP_MAP[bal.coin];
                if (perpName) {
                    price = prices[perpName];
                }
            }
            
            // 3. Fallback to @{token} format for other spot pairs
            if (!price && bal.token) {
                price = prices[`@${bal.token}`];
            }
            
            if (price) {
                usdValue = bal.total * price;
            }
        }
        
        allBalances.push({
            name: bal.coin,
            symbol: bal.coin,
            type: 'spot',
            amount: bal.total,
            available: bal.total - bal.hold,
            hold: bal.hold,
            usdValue: usdValue,
            isStablecoin: /^USD[A-Z]?$/i.test(bal.coin)
        })
    })
    
    // Sort: USDC (Perps) first, USDH second, alphabetically rest
    allBalances.sort((a, b) => {
        if (a.name === 'USDC (Perps)') return -1;
        if (b.name === 'USDC (Perps)') return 1;
        if (a.name === 'USDH') return -1;
        if (b.name === 'USDH') return 1;
        return a.name.localeCompare(b.name);
    })
    
    // Format token amount based on type
    const formatAmount = (amount: number, isStablecoin: boolean): string => {
        if (isStablecoin) {
            return amount.toFixed(2);
        }
        const formatted = amount.toFixed(6);
        return parseFloat(formatted).toString();
    }
    
    if (allBalances.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Wallet className="w-12 h-12 mb-2 opacity-50" />
                <h3 className="text-sm font-medium">No Balances</h3>
                <p className="text-xs opacity-70">Your asset balances will appear here.</p>
            </div>
        )
    }
    
    return (
        <div className="flex-1 overflow-auto">
            <table className="w-full text-xs">
                <thead className="sticky top-0 bg-secondary/40 border-b border-border">
                    <tr className="text-muted-foreground">
                        <th className="text-left px-3 py-2 font-medium">Asset</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-right px-3 py-2 font-medium">Available</th>
                        <th className="text-right px-3 py-2 font-medium">On Hold</th>
                        <th className="text-right px-3 py-2 font-medium">USD Value</th>
                    </tr>
                </thead>
                <tbody>
                    {allBalances.map((balance) => (
                        <tr 
                            key={balance.name}
                            className="border-b border-border/50 hover:bg-white/5 transition-colors"
                        >
                            <td className="px-3 py-2 font-medium text-foreground">
                                <div className="flex items-center gap-2">
                                    <span>{balance.symbol}</span>
                                    <span className={cn(
                                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                                        balance.type === 'perp'
                                            ? "bg-blue-500/20 text-blue-400"
                                            : "bg-purple-500/20 text-purple-400"
                                    )}>
                                        {balance.type === 'perp' ? 'PERP' : 'SPOT'}
                                    </span>
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right text-foreground">
                                {formatAmount(balance.amount, balance.isStablecoin)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                                {formatAmount(balance.available, balance.isStablecoin)}
                            </td>
                            <td className="px-3 py-2 text-right text-muted-foreground">
                                {balance.hold > 0 
                                    ? formatAmount(balance.hold, balance.isStablecoin) 
                                    : '-'
                                }
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-foreground">
                                {balance.usdValue > 0 
                                    ? `$${balance.usdValue.toFixed(2)}` 
                                    : '-'
                                }
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

function EmptyTabContent({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <h3 className="text-sm font-medium">{title}</h3>
            <p className="text-xs opacity-70">{description}</p>
        </div>
    )
}

function AISignalsContent({ onSignalClick }: { onSignalClick?: (signal: TradeSignal) => void }) {
    return (
        <div className="flex-1 flex flex-col w-full h-full p-2">
            <AISignalsPanel className="flex-1" onSignalClick={onSignalClick} />
        </div>
    )
}
