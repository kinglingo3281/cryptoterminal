"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { cn } from "@/lib/utils"
import { Modal } from "@/components/ui/Modal"
import { ChevronDown } from "lucide-react"
import { usePositionsStore } from "@/store/usePositionsStore"
import { useUserStore } from "@/store/useUserStore"
import { useSpotPricesStore } from "@/store/useSpotPricesStore"
import { useOrderbookPriceStore } from "@/store/useOrderbookPriceStore"
import { HyperliquidOrderClient } from "@/services/HyperliquidOrderClient"
import { hyperliquid } from "@/services/hyperliquid"
import { useTradingReadiness } from "@/hooks/useTradingReadiness"
import { atrService } from "@/services/ATRService"
import { useChaseTracker } from "@/hooks/useChaseTracker"
import { useGridTracker } from "@/hooks/useGridTracker"
import type { ChaseSettings } from "@/types/chase"
import type { GridConfig } from "@/types/grid"
import type { Order } from "@/types/positions"
import { toast } from "sonner"

export function TradeForm({ selectedAsset = "HYPE", maxLeverage = 50, displayName }: { selectedAsset?: string, maxLeverage?: number, displayName?: string }) {
    const uiName = displayName || selectedAsset
    const accountSummary = usePositionsStore(state => state.accountSummary)
    const positions = usePositionsStore(state => state.positions)
    const { apiKeys } = useUserStore()
    const spotPrices = useSpotPricesStore(state => state.prices)
    const { readyState, handleTradeAction } = useTradingReadiness()
    
    const [side, setSide] = useState<'long' | 'short'>('long')
    const [mode, setMode] = useState<'market' | 'limit' | 'pro'>('market')
    const [proMode, setProMode] = useState<'chase' | 'evgrid' | null>(null)
    const [leverage, setLeverage] = useState(20)
    const [tempLeverage, setTempLeverage] = useState(20)
    
    // Pro dropdown
    const [showProDropdown, setShowProDropdown] = useState(false)
    const proDropdownRef = useRef<HTMLDivElement>(null)
    
    // Chase settings
    const [chaseSettings, setChaseSettings] = useState<ChaseSettings>({
        tickDistance: 10,
        percentDistance: 1,
        isPercent: false,
        frequencyRangeMin: 5,
        frequencyRangeMax: 60,
        useAnchor: false,
        tpslEnabled: false,
        tpAtrMultiple: 2.0,
        slAtrMultiple: 1.5
    })
    const [chasePrice, setChasePrice] = useState('')
    
    // EVgrid settings
    const [evGridSettings, setEvGridSettings] = useState({
        levels: 3 as 3 | 6 | 10,
        baseTickDistance: 10,
        basePercentDistance: 1,
        isPercent: false,
        sizePerLevel: 0,
        useAnchor: false,
        anchor: undefined as number | undefined,
        frequency: 120
    })
    const [sizePerLevelInput, setSizePerLevelInput] = useState('')
    
    // Chase and Grid trackers
    const { startChase } = useChaseTracker()
    const { startGrid } = useGridTracker()
    
    // Order client and execution state
    const [orderClient, setOrderClient] = useState<HyperliquidOrderClient | null>(null)
    const [availableBalance, setAvailableBalance] = useState(0)
    const [currentPrice, setCurrentPrice] = useState(0)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [marginRequired, setMarginRequired] = useState(0)
    const [orderValue, setOrderValue] = useState(0)
    const [tickSize, setTickSize] = useState(1) // Tick size in dollars from metadata

    // Storage key for per-asset leverage persistence
    const LEVERAGE_STORAGE_KEY = 'asset-leverage-settings'

    // Auto-set leverage to asset's max (with per-asset persistence)
    // Reset mode to market when switching to spot (Pro modes don't apply to spot)
    useEffect(() => {
        if (selectedAsset.startsWith('@') && mode === 'pro') {
            setMode('market')
            setProMode(null)
        }
    }, [selectedAsset, mode])

    useEffect(() => {
        if (!maxLeverage || maxLeverage <= 0) return
        
        // Try to load saved leverage for this asset
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(LEVERAGE_STORAGE_KEY)
                if (stored) {
                    const leverageMap = JSON.parse(stored)
                    const savedLeverage = leverageMap[selectedAsset]
                    
                    // Use saved leverage if valid, otherwise use max
                    if (savedLeverage && savedLeverage > 0 && savedLeverage <= maxLeverage) {
                        setLeverage(savedLeverage)
                        setTempLeverage(savedLeverage)
                        console.log(`[TradeForm] Restored ${selectedAsset} leverage: ${savedLeverage}x`)
                        return
                    }
                }
            } catch (e) {
                console.warn('[TradeForm] Failed to load leverage settings:', e)
            }
        }
        
        // Fallback: Set to max leverage
        setLeverage(maxLeverage)
        setTempLeverage(maxLeverage)
        console.log(`[TradeForm] Leverage auto-set to ${maxLeverage}x for ${selectedAsset}`)
    }, [selectedAsset, maxLeverage])

    // Fetch tick size from Hyperliquid metadata when asset changes
    useEffect(() => {
        if (!orderClient || !selectedAsset) return
        
        const fetchTickSize = async () => {
            try {
                await (orderClient as any).getAssetIndex(selectedAsset)
                const szDecimals = (orderClient as any).assetSzDecimals
                if (szDecimals !== undefined && szDecimals !== null) {
                    const priceDecimals = 6 - szDecimals
                    const calculatedTickSize = Math.pow(10, -priceDecimals)
                    setTickSize(calculatedTickSize)
                    console.log(`[TradeForm] Tick size for ${selectedAsset}: $${calculatedTickSize} (szDecimals=${szDecimals})`)
                }
            } catch (e) {
                console.warn('[TradeForm] Failed to fetch tick size:', e)
                setTickSize(1) // Safe default
            }
        }
        
        fetchTickSize()
    }, [orderClient, selectedAsset])

    // Form States
    const [size, setSize] = useState('')
    const [limitPrice, setLimitPrice] = useState('')
    const [percent, setPercent] = useState(0)

    // Listen for orderbook price clicks → fill limit price & switch to limit mode
    const orderbookPrice = useOrderbookPriceStore(s => s.selectedPrice)
    const clearOrderbookPrice = useOrderbookPriceStore(s => s.clearSelectedPrice)
    useEffect(() => {
        if (orderbookPrice) {
            setLimitPrice(orderbookPrice)
            setMode('limit')
            clearOrderbookPrice()
        }
    }, [orderbookPrice, clearOrderbookPrice])

    // TP/SL States
    const [showTpSl, setShowTpSl] = useState(false)
    const [reduceOnly, setReduceOnly] = useState(false)
    const [tpPrice, setTpPrice] = useState('')
    const [slPrice, setSlPrice] = useState('')
    const [gainValue, setGainValue] = useState('')
    const [lossValue, setLossValue] = useState('')
    const [isUpdatingTPSL, setIsUpdatingTPSL] = useState(false) // Prevent feedback loop
    const [tpIsLimit, setTpIsLimit] = useState(true) // Limit by default
    const [slIsLimit, setSlIsLimit] = useState(true) // Limit by default

    // Size unit state
    const [sizeUnit, setSizeUnit] = useState<'%' | '$' | string>(uiName) // Default to asset mode
    const [showSizeDropdown, setShowSizeDropdown] = useState(false)
    const sizeDropdownRef = useRef<HTMLDivElement>(null)
    const [isUpdatingSize, setIsUpdatingSize] = useState(false) // Prevent feedback loop
    const [isSizeManuallySet, setIsSizeManuallySet] = useState(false) // Track user control

    // Modal States
    const [showMarginModal, setShowMarginModal] = useState(false)
    const [showLeverageModal, setShowLeverageModal] = useState(false)

    // Margin Mode State (persisted in localStorage)
    const [isCrossMargin, setIsCrossMargin] = useState(true)
    const [mounted, setMounted] = useState(false)
    
    // Load margin mode from localStorage after mount to prevent hydration errors
    useEffect(() => {
        setMounted(true)
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('marginMode')
            setIsCrossMargin(stored !== 'isolated')
        }
    }, [])

    const handleLeverageConfirm = () => {
        setLeverage(tempLeverage)
        
        // Save leverage preference for this asset
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(LEVERAGE_STORAGE_KEY)
                const leverageMap = stored ? JSON.parse(stored) : {}
                leverageMap[selectedAsset] = tempLeverage
                localStorage.setItem(LEVERAGE_STORAGE_KEY, JSON.stringify(leverageMap))
                console.log(`[TradeForm] Saved ${selectedAsset} leverage: ${tempLeverage}x`)
            } catch (e) {
                console.warn('[TradeForm] Failed to save leverage:', e)
            }
        }
        
        setShowLeverageModal(false)
    }

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(e.target as Node)) {
                setShowSizeDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])
    
    // Close Pro dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (proDropdownRef.current && !proDropdownRef.current.contains(e.target as Node)) {
                setShowProDropdown(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Initialize order client when API keys available
    useEffect(() => {
        if (apiKeys?.hyperliquid?.apiKey) {
            const client = new HyperliquidOrderClient()
            client.initialize(apiKeys.hyperliquid.apiKey).then(() => {
                setOrderClient(client)
                console.log('[TradeForm] Order client initialized')
                console.log('[TradeForm] Wallet address:', (client as any).wallet?.address)
                // Background: enable unified account + HIP-3 DEX abstraction on startup
                client.ensureUnifiedAccount().catch(() => {})
                client.ensureHip3DexAbstraction().catch(() => {})
            }).catch(err => {
                console.error('[TradeForm] Failed to initialize client:', err)
            })
        }
    }, [apiKeys])

    // Spot asset detection
    const isSpotAsset = selectedAsset.startsWith('@')

    // Resolve quote/base token for spot pairs from cached asset data
    const spotQuoteToken = isSpotAsset ? (displayName?.split('/')?.[1] || 'USDC') : null
    const spotBaseToken = isSpotAsset ? (displayName?.split('/')?.[0] || null) : null

    // Subscribe to balance updates — use spot token balance for spot, perps margin for perps
    // Buy: need quote token (USDC). Sell: need base token (HYPE etc.)
    useEffect(() => {
        if (!accountSummary) return
        if (isSpotAsset && accountSummary.spotBalances) {
            const tokenToCheck = side === 'long' ? spotQuoteToken : spotBaseToken
            const bal = accountSummary.spotBalances.find(
                (b: any) => b.coin === tokenToCheck
            )
            const available = bal ? (bal.total - bal.hold) : 0
            setAvailableBalance(Math.max(0, available))
        } else if (accountSummary.availableForTrading !== undefined) {
            setAvailableBalance(accountSummary.availableForTrading)
        }
    }, [accountSummary, isSpotAsset, spotQuoteToken, spotBaseToken, side])

    // Subscribe to real-time price updates from WebSocket
    useEffect(() => {
        const price = spotPrices[selectedAsset]
        if (price && price > 0) {
            setCurrentPrice(price)
            // console.log(`[TradeForm] Price updated for ${selectedAsset}: $${price}`)
        }
    }, [spotPrices, selectedAsset])

    // Calculate max size based on balance, leverage, and price
    const calculateMaxSize = useCallback(() => {
        if (!currentPrice || currentPrice <= 0 || !availableBalance || availableBalance <= 0) {
            return 0
        }
        // Spot buy: max tokens = quote balance / price. Spot sell: max tokens = base token balance directly.
        if (isSpotAsset) {
            return side === 'long' ? availableBalance / currentPrice : availableBalance
        }
        const marginToUse = availableBalance
        const maxSize = (marginToUse * leverage) / currentPrice
        return maxSize
    }, [currentPrice, availableBalance, leverage, isSpotAsset, side])

    // Get display size (converts asset to USD if needed)
    const getDisplaySize = useCallback(() => {
        if (!size) return ''
        
        if (sizeUnit === 'USD') {
            if (!currentPrice || currentPrice <= 0) return '0.00'
            const usdValue = parseFloat(size) * currentPrice
            return isNaN(usdValue) ? '0.00' : usdValue.toFixed(2)
        }
        
        return size  // Return asset amount
    }, [size, sizeUnit, currentPrice])

    // Handle size input with unit-aware conversion
    const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isUpdatingSize) return  // Prevent feedback loop
        
        const val = e.target.value
        setIsSizeManuallySet(true)
        
        if (sizeUnit === 'USD') {
            // User typing USD → convert to asset for storage
            if (!val || isNaN(parseFloat(val))) {
                setSize('0')
            } else if (currentPrice > 0) {
                const usdAmount = parseFloat(val)
                const assetSize = usdAmount / currentPrice
                setSize(assetSize.toFixed(4))  // Store in asset units
            }
        } else {
            // User typing asset → store directly
            setSize(val)
        }
    }

    // Handle unit toggle
    const handleUnitChange = (newUnit: string) => {
        setSizeUnit(newUnit)
        setShowSizeDropdown(false)
        // Display will auto-update on next render via getDisplaySize()
    }

    // Calculate order value and margin when size changes manually
    useEffect(() => {
        const sizeNum = parseFloat(size)
        if (!isNaN(sizeNum) && sizeNum > 0 && currentPrice > 0) {
            const orderVal = sizeNum * currentPrice
            setOrderValue(orderVal)
            // Spot: margin = full order value (no leverage). Perps: margin = orderVal / leverage
            setMarginRequired(isSpotAsset ? orderVal : orderVal / leverage)
        } else {
            setOrderValue(0)
            setMarginRequired(0)
        }
    }, [size, currentPrice, leverage, isSpotAsset])

    // Calculate size from percent slider (only if not manually set)
    useEffect(() => {
        if (isSizeManuallySet) return  // Don't override user input
        
        if (percent > 0 && currentPrice > 0 && availableBalance > 0) {
            const maxSize = calculateMaxSize()
            const calculatedSize = (maxSize * percent) / 100
            setSize(calculatedSize.toFixed(4))  // Always store in asset units
        } else if (percent === 0) {
            setSize('')
        }
    }, [percent, currentPrice, availableBalance, leverage, calculateMaxSize, isSizeManuallySet])

    // Calculate gain % from TP price
    useEffect(() => {
        if (isUpdatingTPSL || !tpPrice || !currentPrice || currentPrice <= 0) {
            return
        }
        
        const tp = parseFloat(tpPrice)
        if (isNaN(tp)) return
        
        const isLong = side === 'long'
        // Long: gain = (tp - current) / current * 100
        // Short: gain = (current - tp) / current * 100
        const gainPercent = isLong 
            ? ((tp - currentPrice) / currentPrice) * 100
            : ((currentPrice - tp) / currentPrice) * 100
        
        setIsUpdatingTPSL(true)
        setGainValue(gainPercent.toFixed(2))
        setTimeout(() => setIsUpdatingTPSL(false), 0)
    }, [tpPrice, currentPrice, side, isUpdatingTPSL])

    // Calculate loss % from SL price
    useEffect(() => {
        if (isUpdatingTPSL || !slPrice || !currentPrice || currentPrice <= 0) {
            return
        }
        
        const sl = parseFloat(slPrice)
        if (isNaN(sl)) return
        
        const isLong = side === 'long'
        // Long: loss = (current - sl) / current * 100
        // Short: loss = (sl - current) / current * 100
        const lossPercent = isLong
            ? ((currentPrice - sl) / currentPrice) * 100
            : ((sl - currentPrice) / currentPrice) * 100
        
        setIsUpdatingTPSL(true)
        setLossValue(lossPercent.toFixed(2))
        setTimeout(() => setIsUpdatingTPSL(false), 0)
    }, [slPrice, currentPrice, side, isUpdatingTPSL])

    // Reset reduce-only when switching away from limit or chase mode
    useEffect(() => {
        if (mode !== 'limit' && !(mode === 'pro' && proMode === 'chase')) {
            setReduceOnly(false)
        }
    }, [mode, proMode])

    // Handle gain % input to update TP price
    const handleGainChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isUpdatingTPSL) return
        
        const val = e.target.value
        setGainValue(val)
        
        const gainPercent = parseFloat(val)
        if (isNaN(gainPercent) || !currentPrice || currentPrice <= 0) return
        
        const isLong = side === 'long'
        // Long: tp = current * (1 + gain/100)
        // Short: tp = current * (1 - gain/100)
        const newTP = isLong
            ? currentPrice * (1 + gainPercent / 100)
            : currentPrice * (1 - gainPercent / 100)
        
        setIsUpdatingTPSL(true)
        setTpPrice(hyperliquid.formatPriceWithSigFigs(newTP))
        setTimeout(() => setIsUpdatingTPSL(false), 0)
    }

    // Handle loss % input to update SL price
    const handleLossChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isUpdatingTPSL) return
        
        const val = e.target.value
        setLossValue(val)
        
        const lossPercent = parseFloat(val)
        if (isNaN(lossPercent) || !currentPrice || currentPrice <= 0) return
        
        const isLong = side === 'long'
        // Long: sl = current * (1 - loss/100)
        // Short: sl = current * (1 + loss/100)
        const newSL = isLong
            ? currentPrice * (1 - lossPercent / 100)
            : currentPrice * (1 + lossPercent / 100)
        
        setIsUpdatingTPSL(true)
        setSlPrice(hyperliquid.formatPriceWithSigFigs(newSL))
        setTimeout(() => setIsUpdatingTPSL(false), 0)
    }

    // Handle TP price input
    const handleTPPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isUpdatingTPSL) return
        setTpPrice(e.target.value)
    }

    // Handle SL price input
    const handleSLPriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (isUpdatingTPSL) return
        setSlPrice(e.target.value)
    }

    // Quick-fill TP price (⚡ button)
    const handleQuickTP = async () => {
        if (!currentPrice || currentPrice <= 0) {
            console.log('[TradeForm] Cannot fill TP - no current price')
            return
        }
        
        const isLong = side === 'long'
        let tpValue: number
        
        try {
            // Try ATR-based calculation first
            const tpslData = await atrService.getTPSLRounded(selectedAsset, currentPrice, isLong)
            if (tpslData && !tpslData.isFallback) {
                tpValue = tpslData.tp
                console.log(`[TradeForm] ATR-based TP: $${tpValue} (ATR=${tpslData.atr?.toFixed(4)}, ${tpslData.atrPct?.toFixed(2)}%)`)
            } else {
                // Fallback to 2%
                tpValue = isLong ? currentPrice * 1.02 : currentPrice * 0.98
                console.log(`[TradeForm] Fallback 2% TP: $${tpValue}`)
            }
        } catch (error) {
            // Fallback to 2% on error
            tpValue = isLong ? currentPrice * 1.02 : currentPrice * 0.98
            console.log(`[TradeForm] Error fetching ATR, using 2% fallback: $${tpValue}`)
        }
        
        setTpPrice(await hyperliquid.formatPrice(tpValue, selectedAsset))
    }

    // Quick-fill SL price (⚡ button)
    const handleQuickSL = async () => {
        if (!currentPrice || currentPrice <= 0) {
            console.log('[TradeForm] Cannot fill SL - no current price')
            return
        }
        
        const isLong = side === 'long'
        let slValue: number
        
        try {
            // Try ATR-based calculation first
            const tpslData = await atrService.getTPSLRounded(selectedAsset, currentPrice, isLong)
            if (tpslData && !tpslData.isFallback) {
                slValue = tpslData.sl
                console.log(`[TradeForm] ATR-based SL: $${slValue} (ATR=${tpslData.atr?.toFixed(4)}, ${tpslData.atrPct?.toFixed(2)}%)`)
            } else {
                // Fallback to 2%
                slValue = isLong ? currentPrice * 0.98 : currentPrice * 1.02
                console.log(`[TradeForm] Fallback 2% SL: $${slValue}`)
            }
        } catch (error) {
            // Fallback to 2% on error
            slValue = isLong ? currentPrice * 0.98 : currentPrice * 1.02
            console.log(`[TradeForm] Error fetching ATR, using 2% fallback: $${slValue}`)
        }
        
        setSlPrice(await hyperliquid.formatPrice(slValue, selectedAsset))
    }

    // Fill mid price for limit orders
    const handleFillMidPrice = () => {
        if (!currentPrice || currentPrice <= 0) {
            console.log('[TradeForm] Cannot fill mid price - no current price')
            return
        }
        
        setLimitPrice(hyperliquid.formatPriceWithSigFigs(currentPrice))
        console.log(`[TradeForm] Filled mid price: $${hyperliquid.formatPriceWithSigFigs(currentPrice)}`)
    }

    // Submit order handler
    const handleSubmitOrder = async () => {
        // Handle Chase mode
        if (mode === 'pro' && proMode === 'chase') {
            if (!orderClient) {
                toast.error('Order client not initialized')
                return
            }

            const sizeNum = parseFloat(size)
            if (!sizeNum || sizeNum <= 0) {
                toast.warning('Invalid size')
                return
            }

            const priceNum = parseFloat(chasePrice)
            if (!priceNum || priceNum <= 0) {
                toast.warning('Invalid price — enter a limit price')
                return
            }

            setIsSubmitting(true)

            try {
                // Place initial limit order
                const orderResult = await orderClient.executeTradingOrder({
                    asset: selectedAsset,
                    orderSide: side === 'long' ? 'buy' : 'sell',
                    size: sizeNum,
                    price: priceNum,
                    orderType: 'limit',
                    timeInForce: 'GTC',
                    reduceOnly: reduceOnly,
                    leverage: leverage,
                    isCrossMargin: isCrossMargin,
                    tpslEnabled: false,
                    tpPrice: null,
                    slPrice: null
                })

                if (!orderResult.success || !orderResult.oid) {
                    toast.error(`Order failed: ${orderResult.error || 'Unknown'}`)
                    setIsSubmitting(false)
                    return
                }

                const oid = orderResult.oid
                console.log(`[TradeForm] Chase order placed: ${oid}`)
                
                // Wait for order to settle
                await new Promise(resolve => setTimeout(resolve, 500))
                
                // Start chase - merge TP/SL UI state into chase settings
                const mergedChaseSettings = {
                    ...chaseSettings,
                    tpslEnabled: showTpSl,
                    tpAtrMultiple: chaseSettings.tpAtrMultiple,
                    slAtrMultiple: chaseSettings.slAtrMultiple,
                    tpPrice: null,  // Calculated at fill time from ATR
                    slPrice: null,  // Calculated at fill time from ATR
                    tpIsLimit: showTpSl ? tpIsLimit : undefined,
                    slIsLimit: showTpSl ? slIsLimit : undefined
                }
                
                const tradeIsHip3 = selectedAsset.includes(':')
                const chaseResult = await startChase(
                    oid,
                    {
                        oid: parseInt(oid),
                        coin: selectedAsset,
                        side: side === 'long' ? 'BUY' : 'SELL',
                        size: sizeNum,
                        limitPx: priceNum,
                        isPositionTpsl: false,
                        reduceOnly: reduceOnly,
                        dex: tradeIsHip3 ? selectedAsset.split(':')[0] : 'main',
                        isHip3: tradeIsHip3
                    } as Order,
                    mergedChaseSettings
                )
                
                if (chaseResult.success) {
                    toast.success('Chase started', { description: `ID: ${chaseResult.chaseId}` })
                    setSize('')
                    setChasePrice('')
                } else {
                    toast.error(`Chase failed: ${chaseResult.error || 'Unknown'}`)
                }
            } catch (error: any) {
                console.error('Chase submission error:', error)
                toast.error(error.message)
            } finally {
                setIsSubmitting(false)
            }
            return
        }
        
        // Handle EVgrid mode
        if (mode === 'pro' && proMode === 'evgrid') {
            if (!orderClient) {
                toast.error('Order client not initialized')
                return
            }
            
            if (evGridSettings.sizePerLevel <= 0) {
                toast.warning('Invalid size per level')
                return
            }
            
            setIsSubmitting(true)
            try {
                const gridConfig: GridConfig = {
                    asset: selectedAsset,
                    levels: evGridSettings.levels,
                    baseTickDistance: evGridSettings.baseTickDistance,
                    basePercentDistance: evGridSettings.basePercentDistance,
                    isPercent: evGridSettings.isPercent,
                    sizePerLevel: evGridSettings.sizePerLevel,
                    anchor: evGridSettings.useAnchor ? evGridSettings.anchor : undefined,
                    useAnchor: evGridSettings.useAnchor,
                    frequency: evGridSettings.frequency,
                    leverage: leverage,
                    isCrossMargin: isCrossMargin,
                    chaseSettings: {
                        tickDistance: evGridSettings.isPercent ? undefined : evGridSettings.baseTickDistance,
                        percentDistance: evGridSettings.isPercent ? evGridSettings.basePercentDistance : undefined,
                        isPercent: evGridSettings.isPercent,
                        frequencyRangeMin: evGridSettings.frequency,
                        frequencyRangeMax: evGridSettings.frequency,
                        aggressive: false,
                        useAnchor: evGridSettings.useAnchor,
                        anchorPrice: evGridSettings.anchor,
                        tpslEnabled: true, // Grid ALWAYS has TP/SL as automatic safety
                        tpAtrMultiple: chaseSettings.tpAtrMultiple,
                        slAtrMultiple: chaseSettings.slAtrMultiple,
                        tpPrice: null,
                        slPrice: null
                    }
                }
                
                const gridResult = await startGrid(gridConfig)
                
                if (gridResult.success) {
                    toast.success('EV Grid started', { description: `${gridResult.ordersPlaced} orders placed` })
                    setEvGridSettings(prev => ({ ...prev, sizePerLevel: 0 }))
                } else {
                    toast.error(`EV Grid failed: ${gridResult.error || 'Unknown'}`)
                }
            } catch (error: any) {
                console.error('EVgrid submission error:', error)
                toast.error(error.message)
            } finally {
                setIsSubmitting(false)
            }
            return
        }
        
        // Original submission logic for market/limit modes
        if (!orderClient || isSubmitting) {
            console.log('[TradeForm] Cannot submit - client not ready or already submitting')
            return
        }

        // Validate size
        const sizeNum = parseFloat(size)
        if (!size || isNaN(sizeNum) || sizeNum <= 0) {
            toast.warning('Please enter a valid size')
            return
        }

        // Check margin / balance
        if (isSpotAsset) {
            const relevantToken = side === 'long' ? spotQuoteToken : spotBaseToken
            if (side === 'long') {
                // Buy: need quote token to pay
                const orderCost = sizeNum * currentPrice
                if (orderCost > availableBalance && availableBalance > 0) {
                    toast.error(`Insufficient ${relevantToken} balance`, {
                        description: `Need ~${orderCost.toFixed(2)} ${relevantToken}, have ${availableBalance.toFixed(2)} ${relevantToken}`
                    })
                    return
                }
            } else {
                // Sell: need base token to sell
                if (sizeNum > availableBalance && availableBalance > 0) {
                    toast.error(`Insufficient ${relevantToken} balance`, {
                        description: `Need ${sizeNum} ${relevantToken}, have ${availableBalance.toFixed(4)} ${relevantToken}`
                    })
                    return
                }
            }
            if (availableBalance <= 0) {
                toast.error(`No ${relevantToken} balance for spot trading`, {
                    description: `This pair requires ${relevantToken}. Check your spot wallet balance.`
                })
                return
            }
        } else if (mode !== 'market' && !reduceOnly && marginRequired > availableBalance) {
            toast.error('Insufficient margin')
            return
        }

        setIsSubmitting(true)

        try {
            // Parse and validate limit price for limit orders
            let orderPrice: number | null = null
            if (mode === 'limit') {
                orderPrice = parseFloat(limitPrice)
                if (isNaN(orderPrice) || orderPrice <= 0) {
                    toast.warning('Enter a valid limit price')
                    setIsSubmitting(false)
                    return
                }
            }

            const orderData = {
                asset: selectedAsset,
                orderSide: side === 'long' ? 'buy' as const : 'sell' as const,
                orderType: mode === 'pro' ? 'market' as const : mode as 'market' | 'limit',
                price: orderPrice,
                size: sizeNum,
                leverage: isSpotAsset ? null : leverage,
                isCrossMargin: isCrossMargin,
                reduceOnly: isSpotAsset ? false : reduceOnly,
                timeInForce: mode === 'market' || mode === 'pro' ? 'IOC' : 'GTC',
                tpslEnabled: isSpotAsset ? false : showTpSl,
                tpPrice: tpPrice ? parseFloat(tpPrice) : null,
                slPrice: slPrice ? parseFloat(slPrice) : null,
                tpIsLimit: tpIsLimit,
                slIsLimit: slIsLimit
            }

            console.log('[TradeForm] Submitting order:', orderData)
            const result = await orderClient.executeTradingOrder(orderData)

            if (result.success) {
                console.log('[TradeForm] Order placed successfully:', result)
                const sideLabel = isSpotAsset ? (side === 'long' ? 'BUY' : 'SELL') : side.toUpperCase()
                toast.success(`${sideLabel} ${sizeNum} ${uiName}`, { description: 'Order placed successfully' })
                
                // Reset form
                setSize('')
                setPercent(0)
                setTpPrice('')
                setSlPrice('')
            } else {
                console.error('[TradeForm] Order failed:', result.error)
                const errMsg = result.error || 'Unknown error'
                // Spot-specific error enrichment
                if (isSpotAsset && (errMsg.includes('zero size') || errMsg.includes('insufficient') || errMsg.includes('Order has zero'))) {
                    const token = side === 'long' ? spotQuoteToken : spotBaseToken
                    toast.error(`Spot order failed: Insufficient ${token}`, {
                        description: `Available: ${availableBalance.toFixed(4)} ${token}. This pair requires ${token} in your spot wallet.`
                    })
                } else {
                    toast.error(`Order failed: ${errMsg}`)
                }
            }
        } catch (error: any) {
            console.error('[TradeForm] Order error:', error)
            const errMsg = error?.message || ''
            if (isSpotAsset && (errMsg.includes('zero size') || errMsg.includes('insufficient') || errMsg.includes('Order has zero'))) {
                const token = side === 'long' ? spotQuoteToken : spotBaseToken
                toast.error(`Spot order failed: Insufficient ${token}`, {
                    description: `Available: ${availableBalance.toFixed(4)} ${token}. This pair requires ${token} in your spot wallet.`
                })
            } else {
                toast.error(errMsg || 'Order failed')
            }
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="flex flex-col h-full bg-card text-sm font-sans select-none">
            {/* Headers / Tabs */}
            <div className="p-3 pb-0 flex flex-col gap-3">
                {/* Margin & Leverage (hidden for spot — spot has no leverage) */}
                {isSpotAsset ? (
                    <div className="flex items-center justify-center py-1.5 rounded text-sm font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Spot Trading {spotQuoteToken ? `· ${spotQuoteToken}` : ''}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={() => setShowMarginModal(true)}
                            className="btn-layered-grey py-1.5 rounded text-sm font-medium"
                        >
                            {!mounted ? 'Cross' : (isCrossMargin ? 'Cross' : 'Isolated')}
                        </button>
                        <button
                            onClick={() => { setTempLeverage(leverage); setShowLeverageModal(true) }}
                            className="btn-layered-grey py-1.5 rounded text-sm font-medium"
                        >
                            {leverage}x
                        </button>
                    </div>
                )}

                {/* Order Type Tabs */}
                <div className="flex border-b border-border/50 text-xs font-medium text-muted-foreground">
                    <button
                        className={cn("flex-1 pb-2 border-b-2 transition-all uppercase", mode === 'market' ? "text-foreground border-trade-orange" : "border-transparent hover:text-foreground/80")}
                        onClick={() => setMode('market')}
                    >
                        Market
                    </button>
                    <button
                        className={cn("flex-1 pb-2 border-b-2 transition-all uppercase", mode === 'limit' ? "text-foreground border-trade-orange" : "border-transparent hover:text-foreground/80")}
                        onClick={() => setMode('limit')}
                    >
                        Limit
                    </button>
                    {/* Pro modes (Chase/EVgrid) — not available for spot */}
                    {!isSpotAsset && (
                        <div className="flex-1 relative" ref={proDropdownRef}>
                            <button 
                                className={cn("w-full pb-2 border-b-2 transition-all uppercase flex items-center justify-center gap-1", 
                                    mode === 'pro' ? "text-foreground border-trade-orange" : "border-transparent hover:text-foreground/80"
                                )}
                                onClick={() => setShowProDropdown(!showProDropdown)}
                            >
                                {proMode ? (proMode === 'chase' ? 'Chase' : 'EV Grid') : 'Pro'} <ChevronDown className="h-3 w-3" />
                            </button>
                            {showProDropdown && (
                                <div className="absolute top-full left-0 mt-1 w-full bg-card border border-border rounded-lg shadow-xl z-50 py-1 overflow-hidden">
                                    <button
                                        onClick={() => {
                                            setMode('pro')
                                            setProMode('chase')
                                            setShowProDropdown(false)
                                        }}
                                        className="w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors text-foreground"
                                    >
                                        Chase
                                    </button>
                                    <button
                                        onClick={() => {
                                            setMode('pro')
                                            setProMode('evgrid')
                                            setShowProDropdown(false)
                                        }}
                                        className="w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors text-foreground"
                                    >
                                        EV Grid
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4">

                {/* Info Row */}
                <div className="flex justify-between text-[11px] text-muted-foreground font-medium font-mono uppercase tracking-wide">
                    <span className="flex flex-col gap-0.5">
                        <span className="opacity-70">{isSpotAsset ? `Available ${side === 'long' ? spotQuoteToken : spotBaseToken}` : 'Available to Trade'}</span>
                        <span className="text-foreground text-xs">{isSpotAsset ? `${availableBalance.toFixed(4)} ${side === 'long' ? spotQuoteToken : spotBaseToken}` : `$${availableBalance.toFixed(2)}`}</span>
                    </span>
                    <span className="flex flex-col gap-0.5 text-right">
                        <span className="opacity-70">Current Position</span>
                        {(() => {
                            const pos = positions.find(p => p.coin === selectedAsset)
                            if (!pos) return <span className="text-foreground text-xs">0 {uiName}</span>
                            const absSize = Math.abs(pos.size)
                            const sizeStr = absSize < 0.001 ? absSize.toPrecision(4) : absSize.toFixed(4)
                            return (
                                <span className={cn("text-xs font-medium", pos.side === 'LONG' ? "text-trade-green" : "text-trade-red")}>
                                    {pos.side === 'LONG' ? '+' : '-'}{sizeStr} {uiName}
                                </span>
                            )
                        })()}
                    </span>
                </div>

                {/* Side Selector (Long/Short or Buy/Sell for spot) - Hidden in EVgrid mode */}
                {!(mode === 'pro' && proMode === 'evgrid') && (
                    <div className="grid grid-cols-2 bg-black/20 rounded-md p-0.5 border border-border/30">
                        <button
                            onClick={() => setSide('long')}
                            className={cn(
                                "py-1.5 rounded text-xs font-bold transition-all border",
                                side === 'long'
                                    ? "bg-trade-green/10 text-trade-green border-trade-green/20 shadow-sm"
                                    : "text-muted-foreground hover:text-foreground border-transparent"
                            )}
                        >
                            {isSpotAsset ? 'Buy' : 'Long'}
                        </button>
                        <button
                            onClick={() => setSide('short')}
                            className={cn(
                                "py-1.5 rounded text-xs font-bold transition-all border",
                                side === 'short'
                                    ? "bg-trade-red/10 text-trade-red border-trade-red/20 shadow-sm"
                                    : "text-muted-foreground hover:text-foreground border-transparent"
                            )}
                        >
                            {isSpotAsset ? 'Sell' : 'Short'}
                        </button>
                    </div>
                )}

                {/* Chase Settings */}
                {mode === 'pro' && proMode === 'chase' && (
                    <div className="bg-secondary/30 border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-medium text-muted-foreground">Chase Settings</h4>
                            <span className="text-xs text-muted-foreground/60 font-mono">
                                1 tick = ${tickSize < 0.01 ? tickSize.toPrecision(2) : tickSize.toFixed(2)}
                            </span>
                        </div>
                        
                        <div className="space-y-3">
                            {/* Tick/Percent Toggle */}
                            <div className="grid grid-cols-2 bg-black/20 rounded-md p-0.5 border border-border/30">
                                <button
                                    onClick={() => setChaseSettings(prev => ({ ...prev, isPercent: false }))}
                                    className={cn("py-1.5 rounded text-xs font-medium transition-all", !chaseSettings.isPercent ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    Ticks
                                </button>
                                <button
                                    onClick={() => setChaseSettings(prev => ({ ...prev, isPercent: true }))}
                                    className={cn("py-1.5 rounded text-xs font-medium transition-all", chaseSettings.isPercent ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
                                >
                                    Percent
                                </button>
                            </div>

                            {/* Distance Input */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Distance</label>
                                <input
                                    type="number"
                                    value={chaseSettings.isPercent ? chaseSettings.percentDistance : chaseSettings.tickDistance}
                                    onChange={(e) => {
                                        const val = parseFloat(e.target.value) || 0
                                        setChaseSettings(prev => chaseSettings.isPercent ? { ...prev, percentDistance: val } : { ...prev, tickDistance: val })
                                    }}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    placeholder={chaseSettings.isPercent ? "1.0%" : "10 ticks"}
                                />
                            </div>

                            {/* Frequency Range */}
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1.5 block">Freq Min (s)</label>
                                    <input
                                        type="number"
                                        value={chaseSettings.frequencyRangeMin}
                                        onChange={(e) => setChaseSettings(prev => ({ ...prev, frequencyRangeMin: parseInt(e.target.value) || 5 }))}
                                        className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-muted-foreground mb-1.5 block">Freq Max (s)</label>
                                    <input
                                        type="number"
                                        value={chaseSettings.frequencyRangeMax}
                                        onChange={(e) => setChaseSettings(prev => ({ ...prev, frequencyRangeMax: parseInt(e.target.value) || 60 }))}
                                        className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    />
                                </div>
                            </div>

                            {/* Price Input */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Limit Price (USD)</label>
                                <input
                                    type="number"
                                    value={chasePrice}
                                    onChange={(e) => setChasePrice(e.target.value)}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    placeholder={currentPrice > 0 ? currentPrice.toFixed(2) : "0.00"}
                                    step="0.01"
                                />
                            </div>

                            {/* Reduce Only Checkbox */}
                            <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() => setReduceOnly(!reduceOnly)}
                            >
                                <div className={cn(
                                    "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                                    reduceOnly 
                                        ? "border-trade-orange bg-trade-orange" 
                                        : "border-muted-foreground/50 bg-transparent hover:border-foreground"
                                )}>
                                    {reduceOnly && <div className="h-2 w-2 rounded-full bg-white" />}
                                </div>
                                <span className="text-xs text-muted-foreground/80">Reduce Only</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* EVgrid Settings */}
                {mode === 'pro' && proMode === 'evgrid' && (
                    <div className="bg-secondary/30 border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-medium text-muted-foreground">EV Grid Configuration</h4>
                            <span className="text-xs text-muted-foreground/60 font-mono">
                                1 tick = ${tickSize < 0.01 ? tickSize.toPrecision(2) : tickSize.toFixed(2)}
                            </span>
                        </div>
                        
                        <div className="space-y-3">
                            {/* Levels Selector */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Levels per Side</label>
                                <select
                                    value={evGridSettings.levels}
                                    onChange={(e) => setEvGridSettings(prev => ({ ...prev, levels: parseInt(e.target.value) as 3 | 6 | 10 }))}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                >
                                    <option value="3">3 levels (6 orders)</option>
                                    <option value="6">6 levels (12 orders)</option>
                                    <option value="10">10 levels (20 orders)</option>
                                </select>
                            </div>

                            {/* Base Distance */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Base Tick/% Distance</label>
                                <input
                                    type="text"
                                    value={evGridSettings.isPercent ? `${evGridSettings.basePercentDistance}%` : evGridSettings.baseTickDistance}
                                    onChange={(e) => {
                                        const val = e.target.value.replace('%', '')
                                        const isPercent = e.target.value.includes('%')
                                        const num = parseFloat(val) || (isPercent ? 1 : 10)
                                        setEvGridSettings(prev => ({ ...prev, isPercent, baseTickDistance: isPercent ? 10 : num, basePercentDistance: isPercent ? num : 1 }))
                                    }}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    placeholder="10 or 1%"
                                />
                            </div>

                            {/* Levels Preview */}
                            <div className="text-xs text-muted-foreground bg-secondary/50 rounded p-2">
                                Levels: {Array.from({ length: evGridSettings.levels }, (_, i) => {
                                    const mult = i + 1
                                    return evGridSettings.isPercent 
                                        ? `${(evGridSettings.basePercentDistance * mult).toFixed(1)}%`
                                        : `${evGridSettings.baseTickDistance * mult}`
                                }).join(', ')}
                            </div>

                            {/* Size per Level */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Size per Level ({uiName})</label>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    value={sizePerLevelInput}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '' || /^\d*\.?\d*$/.test(val)) {
                                            setSizePerLevelInput(val);
                                            const num = parseFloat(val);
                                            setEvGridSettings(prev => ({ ...prev, sizePerLevel: isNaN(num) ? 0 : num }));
                                        }
                                    }}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                    placeholder="0.0002"
                                />
                            </div>

                            {/* Anchor Price */}
                            <div>
                                <div className="flex items-center gap-2 mb-1.5">
                                    <input
                                        type="checkbox"
                                        id="evgrid-use-anchor"
                                        checked={evGridSettings.useAnchor}
                                        onChange={(e) => setEvGridSettings(prev => ({ ...prev, useAnchor: e.target.checked }))}
                                        className="rounded border-border"
                                    />
                                    <label htmlFor="evgrid-use-anchor" className="text-xs text-muted-foreground cursor-pointer">Use Anchor Price</label>
                                </div>
                                <input
                                    type="number"
                                    value={evGridSettings.anchor || ''}
                                    onChange={(e) => setEvGridSettings(prev => ({ ...prev, anchor: parseFloat(e.target.value) || undefined }))}
                                    disabled={!evGridSettings.useAnchor}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange disabled:opacity-50"
                                    placeholder={`Mid price (~${currentPrice.toFixed(2)})`}
                                    step="any"
                                />
                            </div>

                            {/* Frequency */}
                            <div>
                                <label className="text-xs text-muted-foreground mb-1.5 block">Frequency (seconds)</label>
                                <input
                                    type="number"
                                    value={evGridSettings.frequency}
                                    onChange={(e) => setEvGridSettings(prev => ({ ...prev, frequency: parseInt(e.target.value) || 120 }))}
                                    className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-trade-orange"
                                />
                            </div>

                            {/* Summary */}
                            <div className="text-xs bg-secondary/50 rounded p-2 space-y-1">
                                <div>• {evGridSettings.levels * 2} orders ({evGridSettings.levels} buy, {evGridSettings.levels} sell)</div>
                                <div>• Total size: {(evGridSettings.sizePerLevel * evGridSettings.levels * 2).toFixed(4)} {uiName}</div>
                                <div>• Range: ±{evGridSettings.isPercent ? `${evGridSettings.basePercentDistance * evGridSettings.levels}%` : `${evGridSettings.baseTickDistance * evGridSettings.levels} ticks`}</div>
                            </div>

                            {/* Start EV Grid Button */}
                            <button
                                onClick={() => {
                                    if (readyState !== 'ready') { handleTradeAction(); return }
                                    handleSubmitOrder()
                                }}
                                disabled={readyState === 'ready' && (isSubmitting || !orderClient || evGridSettings.sizePerLevel <= 0)}
                                className={cn(
                                    "w-full py-3.5 rounded-md font-bold text-sm btn-layered mt-2 uppercase tracking-wide transition-opacity",
                                    readyState !== 'ready'
                                        ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
                                        : side === 'long'
                                            ? "bg-trade-green/10 text-trade-green border-trade-green/50 hover:bg-trade-green/20"
                                            : "bg-trade-red/10 text-trade-red border-trade-red/50 hover:bg-trade-red/20",
                                    readyState === 'ready' && (isSubmitting || !orderClient || evGridSettings.sizePerLevel <= 0) && "opacity-50 cursor-not-allowed"
                                )}
                            >
                                {readyState === 'not_logged_in' ? 'Login to Trade' :
                                 readyState === 'needs_setup' ? 'Enable Trading' :
                                 isSubmitting ? 'Starting...' : 'Start EV Grid'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Inputs - Hidden in EVgrid mode */}
                {!(mode === 'pro' && proMode === 'evgrid') && (
                <div className="flex flex-col gap-3">

                    {/* Limit Price Input (Only in Limit Mode) */}
                    {mode === 'limit' && (
                        <div className="flex bg-secondary/30 rounded border border-border/50 h-10 items-center px-3 relative focus-within:border-trade-orange/50 transition-colors">
                            <span className="text-muted-foreground text-xs font-medium shrink-0">Limit Price (USD)</span>
                            <div className="flex-1 flex justify-end items-center gap-2 h-full">
                                <input
                                    type="text"
                                    value={limitPrice}
                                    onChange={(e) => setLimitPrice(e.target.value)}
                                    className="bg-transparent border-0 text-right text-sm font-mono focus:outline-none w-full h-full text-foreground placeholder:text-muted-foreground/30"
                                    placeholder="0.00"
                                />
                                {/* <button 
                                    onClick={handleFillMidPrice}
                                    className="text-[10px] text-trade-orange hover:text-trade-orange/80 font-bold px-1"
                                    title="Fill mid price"
                                >
                                    ⚡
                                </button> */}
                            </div>
                        </div>
                    )}

                    {/* Size Input - Shared but styled differently in Limit possibly? Matching image for Limit */}
                    <div className="flex bg-secondary/30 rounded border border-border/50 h-10 items-center px-3 relative focus-within:border-trade-orange/50 transition-colors">
                        <span className="text-muted-foreground text-xs font-medium shrink-0">Size</span>
                        <div className="flex-1 flex justify-end items-center gap-2 h-full">
                            <input
                                type="text"
                                value={getDisplaySize()}
                                onChange={handleSizeChange}
                                className="bg-transparent border-0 text-right text-sm font-mono focus:outline-none w-full h-full text-foreground placeholder:text-muted-foreground/30"
                                placeholder={mode === 'limit' ? "NaN" : "0"}
                            />
                            <div className="relative h-full flex items-center" ref={sizeDropdownRef}>
                                <button
                                    onClick={() => setShowSizeDropdown(!showSizeDropdown)}
                                    className="flex items-center gap-1 text-xs font-medium text-foreground hover:text-white transition-colors pl-2 border-l border-white/10 h-1/2"
                                >
                                    {sizeUnit === 'USD' ? 'USD' : uiName} <ChevronDown className="h-3 w-3 opacity-50" />
                                </button>
                                {showSizeDropdown && (
                                    <div className="absolute top-full right-0 mt-1 bg-[#18191C] border border-white/10 rounded shadow-xl z-50 overflow-hidden min-w-[80px]">
                                        <button
                                            onClick={() => handleUnitChange(selectedAsset)}
                                            className="w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-white/5"
                                        >
                                            {uiName}
                                        </button>
                                        <button
                                            onClick={() => handleUnitChange('USD')}
                                            className="w-full px-3 py-2 text-xs flex items-center justify-between hover:bg-white/5"
                                        >
                                            USD
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Percent Visual Slider + Input (Limit Style) */}
                    <div className="flex gap-2">
                        <div className="flex-1 relative h-9 bg-secondary/30 rounded border border-border/50 flex items-center px-1 overflow-hidden">
                            {/* Visual fill bar */}
                            <div
                                className="absolute inset-y-0 left-0 bg-trade-orange/20 transition-[width] duration-75 ease-linear pointer-events-none z-0"
                                style={{ width: `${percent}%` }}
                            />
                            {/* Label */}
                            <span className="text-xs text-muted-foreground ml-2 relative z-10 pointer-events-none">Percent</span>

                            {/* Actual Range Input */}
                            <input
                                type="range"
                                min="0"
                                max="100"
                                value={percent}
                                onChange={(e) => {
                                    setIsSizeManuallySet(false)  // Slider takes control
                                    setPercent(Number(e.target.value))
                                }}
                                className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-ew-resize z-30 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:h-full [&::-webkit-slider-thumb]:bg-trade-orange [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent"
                            />
                        </div>

                        {/* Percent Input Box */}
                        <div className="flex w-20 h-9 bg-secondary/30 rounded border border-border/50 items-center justify-center px-2 relative focus-within:border-trade-orange/50">
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={percent}
                                onChange={(e) => {
                                    setIsSizeManuallySet(false)  // Slider takes control
                                    setPercent(Math.min(100, Math.max(0, Number(e.target.value))))
                                }}
                                className="w-full h-full bg-transparent border-0 text-right text-sm font-mono focus:outline-none pr-3 appearance-none"
                            />
                            <span className="absolute right-2 text-xs text-muted-foreground pointer-events-none">%</span>
                        </div>
                    </div>

                    {/* TP/SL Checkbox — perps only (spot doesn't support TP/SL grouping) */}
                    {!isSpotAsset && (
                        <div
                            className="flex items-center gap-2 mt-1 cursor-pointer"
                            onClick={() => setShowTpSl(!showTpSl)}
                        >
                            <div className={cn(
                                "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                                showTpSl
                                    ? "border-trade-green bg-trade-green"
                                    : "border-muted-foreground/50 bg-transparent hover:border-foreground"
                            )}>
                                {showTpSl && <div className="h-2 w-2 rounded-full bg-white" />}
                            </div>
                            <span className="text-xs text-muted-foreground/80">Take Profit / Stop Loss</span>
                        </div>
                    )}

                    {/* Reduce Only Checkbox - Only show in limit mode for perps */}
                    {mode === 'limit' && !isSpotAsset && (
                        <div
                            className="flex items-center gap-2 mt-1 cursor-pointer"
                            onClick={() => setReduceOnly(!reduceOnly)}
                        >
                            <div className={cn(
                                "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                                reduceOnly 
                                    ? "border-trade-orange bg-trade-orange" 
                                    : "border-muted-foreground/50 bg-transparent hover:border-foreground"
                            )}>
                                {reduceOnly && <div className="h-2 w-2 rounded-full bg-white" />}
                            </div>
                            <span className="text-xs text-muted-foreground/80">Reduce Only</span>
                        </div>
                    )}

                    {/* TP/SL Inputs - Shown when toggled (perps only) */}
                    {!isSpotAsset && showTpSl && (mode === 'pro' && proMode === 'chase' ? (
                        <div className="flex flex-col gap-3 p-3 bg-secondary/20 rounded-lg border border-border/30">
                            <div className="text-[10px] text-muted-foreground/60 font-medium">TP/SL placed on fill using ATR</div>
                            {/* TP ATR Row */}
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    <span className="text-[9px] text-muted-foreground font-medium">Limit</span>
                                    <div 
                                        className="h-5 w-5 rounded-md border border-border/60 bg-secondary/50 p-0.5 shadow-sm flex items-center justify-center transition-colors cursor-pointer hover:bg-secondary/70 hover:border-border"
                                        onClick={() => setTpIsLimit(!tpIsLimit)}
                                        title={tpIsLimit ? "Limit order" : "Market order"}
                                    >
                                        <div className={cn(
                                            "h-full w-full rounded-[4px] border flex items-center justify-center transition-colors",
                                            tpIsLimit
                                                ? "border-trade-green bg-trade-green/90 text-white"
                                                : "border-muted-foreground/40 bg-black/10"
                                        )}>
                                            {tpIsLimit && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-1 bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium shrink-0">TP</span>
                                    <input
                                        type="number"
                                        value={chaseSettings.tpAtrMultiple}
                                        onChange={(e) => setChaseSettings(prev => ({ ...prev, tpAtrMultiple: parseFloat(e.target.value) || 2.0 }))}
                                        className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                        placeholder="2.0"
                                        step="0.1"
                                        min="0.1"
                                    />
                                    <span className="text-[10px] text-muted-foreground font-medium shrink-0">× ATR</span>
                                </div>
                            </div>
                            {/* SL ATR Row */}
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    <span className="text-[9px] text-muted-foreground font-medium">Limit</span>
                                    <div 
                                        className="h-5 w-5 rounded-md border border-border/60 bg-secondary/50 p-0.5 shadow-sm flex items-center justify-center transition-colors cursor-pointer hover:bg-secondary/70 hover:border-border"
                                        onClick={() => setSlIsLimit(!slIsLimit)}
                                        title={slIsLimit ? "Limit order" : "Market order"}
                                    >
                                        <div className={cn(
                                            "h-full w-full rounded-[4px] border flex items-center justify-center transition-colors",
                                            slIsLimit
                                                ? "border-trade-green bg-trade-green/90 text-white"
                                                : "border-muted-foreground/40 bg-black/10"
                                        )}>
                                            {slIsLimit && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-1 bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 gap-1">
                                    <span className="text-[10px] text-muted-foreground font-medium shrink-0">SL</span>
                                    <input
                                        type="number"
                                        value={chaseSettings.slAtrMultiple}
                                        onChange={(e) => setChaseSettings(prev => ({ ...prev, slAtrMultiple: parseFloat(e.target.value) || 1.5 }))}
                                        className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                        placeholder="1.5"
                                        step="0.1"
                                        min="0.1"
                                    />
                                    <span className="text-[10px] text-muted-foreground font-medium shrink-0">× ATR</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 p-3 bg-secondary/20 rounded-lg border border-border/30">
                            {/* TP Row */}
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    <span className="text-[9px] text-muted-foreground font-medium">Limit</span>
                                    <div 
                                        className="h-5 w-5 rounded-md border border-border/60 bg-secondary/50 p-0.5 shadow-sm flex items-center justify-center transition-colors cursor-pointer hover:bg-secondary/70 hover:border-border"
                                        onClick={() => setTpIsLimit(!tpIsLimit)}
                                        title={tpIsLimit ? "Limit order" : "Market order"}
                                    >
                                        <div className={cn(
                                            "h-full w-full rounded-[4px] border flex items-center justify-center transition-colors",
                                            tpIsLimit
                                                ? "border-trade-green bg-trade-green/90 text-white"
                                                : "border-muted-foreground/40 bg-black/10"
                                        )}>
                                            {tpIsLimit && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-1 gap-2">
                                    <div className="flex flex-[1.2] bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 relative gap-1">
                                        <span className="text-[10px] text-muted-foreground font-medium shrink-0">TP</span>
                                        <input
                                            type="text"
                                            value={tpPrice}
                                            onChange={handleTPPriceChange}
                                            className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                            placeholder="0.00"
                                        />
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleQuickTP(); }}
                                            className="text-[10px] text-trade-orange hover:text-trade-orange/80 font-bold px-1"
                                            title="Auto-fill TP (ATR-based, ~2x ATR)">
                                            ⚡
                                        </button>
                                    </div>
                                    <div className="flex flex-1 bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 relative">
                                        <span className="text-[10px] text-muted-foreground font-medium shrink-0">Gain</span>
                                        <div className="flex-1 flex justify-end items-center h-full gap-1">
                                            <input
                                                type="text"
                                                value={gainValue}
                                                onChange={handleGainChange}
                                                className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                                placeholder="0"
                                            />
                                            <button className="text-[10px] px-1 py-0.5 rounded bg-white/5 text-muted-foreground hover:text-foreground flex items-center gap-0.5 h-5">
                                                % <ChevronDown className="h-2 w-2" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {/* SL Row */}
                            <div className="flex gap-2">
                                <div className="flex flex-col items-center gap-0.5 shrink-0">
                                    <span className="text-[9px] text-muted-foreground font-medium">Limit</span>
                                    <div 
                                        className="h-5 w-5 rounded-md border border-border/60 bg-secondary/50 p-0.5 shadow-sm flex items-center justify-center transition-colors cursor-pointer hover:bg-secondary/70 hover:border-border"
                                        onClick={() => setSlIsLimit(!slIsLimit)}
                                        title={slIsLimit ? "Limit order" : "Market order"}
                                    >
                                        <div className={cn(
                                            "h-full w-full rounded-[4px] border flex items-center justify-center transition-colors",
                                            slIsLimit
                                                ? "border-trade-green bg-trade-green/90 text-white"
                                                : "border-muted-foreground/40 bg-black/10"
                                        )}>
                                            {slIsLimit && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-1 gap-2">
                                    <div className="flex flex-[1.2] bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 relative gap-1">
                                        <span className="text-[10px] text-muted-foreground font-medium shrink-0">SL</span>
                                        <input
                                            type="text"
                                            value={slPrice}
                                            onChange={handleSLPriceChange}
                                            className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                            placeholder="0.00"
                                        />
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleQuickSL(); }}
                                            className="text-[10px] text-trade-orange hover:text-trade-orange/80 font-bold px-1"
                                            title="Auto-fill SL (ATR-based, ~1.5x ATR)">
                                            ⚡
                                        </button>
                                    </div>
                                    <div className="flex flex-1 bg-secondary/50 border border-border/50 rounded h-9 items-center px-2 relative">
                                        <span className="text-[10px] text-muted-foreground font-medium shrink-0">Loss</span>
                                        <div className="flex-1 flex justify-end items-center h-full gap-1">
                                            <input
                                                type="text"
                                                value={lossValue}
                                                onChange={handleLossChange}
                                                className="bg-transparent border-0 text-right text-xs font-mono w-full h-full focus:outline-none text-foreground placeholder-muted-foreground/30"
                                                placeholder="0"
                                            />
                                            <button className="text-[10px] px-1 py-0.5 rounded bg-white/5 text-muted-foreground hover:text-foreground flex items-center gap-0.5 h-5">
                                                % <ChevronDown className="h-2 w-2" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Data Grid */}
                    <div className="flex flex-col gap-2 mt-2 text-[11px]">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground tracking-wide font-medium">{isSpotAsset ? (side === 'long' ? 'ORDER COST' : 'ORDER VALUE') : 'ORDER VALUE'}</span>
                            <span className="font-mono text-foreground">{isSpotAsset ? `${orderValue.toFixed(2)} ${spotQuoteToken}` : `$${orderValue.toFixed(2)}`}</span>
                        </div>
                        {/* Margin Required — perps only */}
                        {!isSpotAsset && (
                            <div className="flex justify-between items-center">
                                <span className="text-muted-foreground tracking-wide font-medium">MARGIN REQUIRED</span>
                                <span className="font-mono text-foreground">{`$${marginRequired.toFixed(2)}`}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground tracking-wide font-medium">SLIPPAGE</span>
                            <span className={cn("font-mono font-medium", mode === 'limit' ? 'text-foreground' : 'text-trade-red')}>
                                {mode === 'limit' ? 'None (Limit)' : isSpotAsset ? 'Max 3%' : 'Max 10%'}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground tracking-wide font-medium">FEES</span>
                            <span className="font-mono text-foreground flex items-center gap-1">
                                <span className="h-2 w-2 bg-white rounded-full inline-block" />
                                {isSpotAsset
                                    ? '0.0700% / 0.0400%'
                                    : selectedAsset.includes(':')
                                        ? '0.0450%+ (Varies)'
                                        : '0.0450% / 0.0150%'}
                            </span>
                        </div>
                    </div>

                    {/* Action Button */}
                    <button
                        onClick={() => {
                            if (readyState !== 'ready') { handleTradeAction(); return }
                            handleSubmitOrder()
                        }}
                        disabled={readyState === 'ready' && (isSubmitting || !orderClient || (!isSpotAsset && marginRequired > availableBalance && mode !== 'market'))}
                        className={cn(
                            "w-full py-3.5 rounded-md font-bold text-sm btn-layered mt-2 uppercase tracking-wide transition-opacity",
                            readyState !== 'ready'
                                ? "bg-primary/10 text-primary border-primary/50 hover:bg-primary/20"
                                : side === 'long'
                                    ? "bg-trade-green/10 text-trade-green border-trade-green/50 hover:bg-trade-green/20"
                                    : "bg-trade-red/10 text-trade-red border-trade-red/50 hover:bg-trade-red/20",
                            readyState === 'ready' && (isSubmitting || !orderClient) && "opacity-50 cursor-not-allowed"
                        )}
                    >
                        {readyState === 'not_logged_in' ? 'Login to Trade' :
                         readyState === 'needs_setup' ? 'Enable Trading' :
                         isSubmitting ? 'Submitting...' : (
                            mode === 'pro' && proMode === 'chase' ? `Start Chase (${side === 'long' ? 'Buy' : 'Sell'})` :
                            mode === 'pro' && proMode === 'evgrid' ? 'Start EV Grid' :
                            isSpotAsset ? (side === 'long' ? 'Buy Spot' : 'Sell Spot') :
                            side === 'long' ? 'Buy / Long' : 'Sell / Short'
                        )}
                    </button>

                    {/* Account Equity Footer */}
                    <div className="mt-4 pt-4 border-t border-border/50 flex flex-col gap-3">
                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Account Equity</div>

                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground">SPOT</span>
                            <span className="text-foreground">{`$${(accountSummary?.spotBalance || 0).toFixed(2)}`}</span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">PERPS</span>
                            <span className="text-foreground">{`$${(accountSummary?.perpsBalance || 0).toFixed(2)}`}</span>
                        </div>

                        <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mt-2 mb-1">Perps Overview</div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">AVAILABLE BALANCE</span>
                            <span className="text-foreground">{`$${(accountSummary?.availableForTrading || 0).toFixed(2)}`}</span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">UNREALIZED PNL</span>
                            <span className={cn(
                                "font-medium",
                                (accountSummary?.totalUnrealizedPnl || 0) >= 0 ? "text-trade-green" : "text-red-400"
                            )}>
                                {`${(accountSummary?.totalUnrealizedPnl || 0) >= 0 ? '+' : ''}$${(accountSummary?.totalUnrealizedPnl || 0).toFixed(2)}`}
                            </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">CROSS MARGIN RATIO</span>
                            <span className={cn(
                                "font-medium",
                                (accountSummary?.crossMarginRatio || 0) < 80 
                                    ? "text-trade-green" 
                                    : (accountSummary?.crossMarginRatio || 0) < 95
                                        ? "text-yellow-400"
                                        : "text-red-400"
                            )}>
                                {(accountSummary?.crossMarginRatio || 0).toFixed(2)}%
                            </span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">MAINTENANCE MARGIN</span>
                            <span className="text-foreground">{`$${(accountSummary?.maintenanceMargin || 0).toFixed(2)}`}</span>
                        </div>
                        <div className="flex justify-between text-xs font-mono">
                            <span className="text-muted-foreground border-b border-dotted border-muted-foreground/50">CROSS ACCOUNT LEVERAGE</span>
                            <span className="text-foreground">{(accountSummary?.crossAccountLeverage || 0).toFixed(2)}×</span>
                        </div>
                    </div>
                </div>
                )}
            </div>

            {/* Margin Mode Modal - Functional */}
            <Modal isOpen={showMarginModal} onClose={() => setShowMarginModal(false)} title={`${uiName} Margin Mode`}>
                <div className="flex flex-col gap-4">
                    {/* Cross Margin Option */}
                    <div 
                        onClick={() => {
                            setIsCrossMargin(true)
                            localStorage.setItem('marginMode', 'cross')
                            setShowMarginModal(false)
                            console.log('[TradeForm] Margin mode changed to: Cross')
                        }}
                        className={cn(
                            "flex flex-col gap-2 p-4 rounded border cursor-pointer transition-colors",
                            isCrossMargin 
                                ? "border-primary bg-primary/5" 
                                : "border-border hover:bg-muted/50"
                        )}
                    >
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-sm">Cross</span>
                            {isCrossMargin && (
                                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                    <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            All cross positions share the same cross margin as collateral. In the event of liquidation, 
                            your cross margin balance and any remaining open positions under assets in this mode may be forfeited.
                        </p>
                    </div>

                    {/* Isolated Margin Option */}
                    <div 
                        onClick={() => {
                            setIsCrossMargin(false)
                            localStorage.setItem('marginMode', 'isolated')
                            setShowMarginModal(false)
                            console.log('[TradeForm] Margin mode changed to: Isolated')
                        }}
                        className={cn(
                            "flex flex-col gap-2 p-4 rounded border cursor-pointer transition-colors",
                            !isCrossMargin 
                                ? "border-primary bg-primary/5" 
                                : "border-border hover:bg-muted/50"
                        )}
                    >
                        <div className="flex justify-between items-center">
                            <span className="font-semibold text-sm">Isolated</span>
                            {!isCrossMargin && (
                                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                                    <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                            Use a portion of the cross collateral balance to open an isolated position under this asset. 
                            Margin is isolated and liquidation will not affect other positions.
                        </p>
                    </div>

                    {/* Info Text */}
                    <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                        This setting applies globally across all assets until changed.
                    </p>
                </div>
            </Modal>

            <Modal isOpen={showLeverageModal} onClose={() => setShowLeverageModal(false)} title="Adjust Leverage">
                <div className="flex flex-col gap-6">
                    <p className="text-sm text-muted-foreground">Set your trading leverage for {uiName}. The maximum leverage is {maxLeverage}x.</p>

                    <div className="flex justify-between items-center">
                        <span className="text-sm font-medium">Leverage</span>
                        <span className="text-2xl font-bold">{tempLeverage}x</span>
                    </div>

                    <div className="relative h-12 flex items-center px-2 bg-secondary rounded border border-border">
                        <input
                            type="range"
                            min="1"
                            max={maxLeverage}
                            value={tempLeverage}
                            onChange={(e) => setTempLeverage(parseInt(e.target.value))}
                            className="w-full h-1 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                        />
                        <div className="absolute left-0 bottom-0 text-[10px] text-muted-foreground px-2 pb-1">1x</div>
                        <div className="absolute right-0 bottom-0 text-[10px] text-muted-foreground px-2 pb-1">{maxLeverage}x</div>
                    </div>

                    <button onClick={handleLeverageConfirm} className="w-full py-3 bg-trade-red rounded font-bold text-white hover:bg-trade-red/90">Confirm</button>
                </div>
            </Modal>
        </div>
    )
}
