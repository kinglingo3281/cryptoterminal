"use client"

import { ChevronDown, BarChart2, Newspaper, DollarSign, Zap, Activity } from "lucide-react"
import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "@/lib/utils"
import { useSpotPricesStore } from "@/store/useSpotPricesStore"
import { hyperliquid } from "@/services/hyperliquid"

const DROPDOWN_ITEMS = [
    { id: 'chart', label: 'Chart', icon: BarChart2 },
    { id: 'news', label: 'News', icon: Newspaper },
    { id: 'funding', label: 'Funding', icon: DollarSign },
    { id: 'performance', label: 'Performance', icon: Activity },
]

interface MarketStatsProps {
    activeView?: string
    onViewChange?: (view: string) => void
    selectedAsset?: { symbol: string; name: string; displayName?: string; price: string; leverage?: string; change24h?: number; volume?: string; openInterest?: string } | null
    onOpenSearch?: () => void
    showQuickTrade?: boolean
    onToggleQuickTrade?: () => void
}

function formatStatPrice(price: number): string {
    if (price <= 0) return '...'
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    if (price >= 1) return `$${price.toFixed(2)}`
    return `$${price.toFixed(5)}`
}

function formatStatVolume(vol: number): string {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(1)}B`
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`
    if (vol >= 1e3) return `$${(vol / 1e3).toFixed(1)}K`
    if (vol > 0) return `$${vol.toFixed(0)}`
    return '-'
}

export function MarketStats({
    activeView = 'chart',
    onViewChange,
    selectedAsset,
    onOpenSearch,
    showQuickTrade,
    onToggleQuickTrade
}: MarketStatsProps) {
    const [isDropdownOpen, setDropdownOpen] = useState(false)
    const [iconSrcIndex, setIconSrcIndex] = useState(0)
    const [iconFailed, setIconFailed] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const spotPrices = useSpotPricesStore(state => state.prices)

    // Self-managed market data state
    const [marketData, setMarketData] = useState<{
        change24h: number | undefined
        volume: string
        openInterest: string
    }>({ change24h: undefined, volume: '...', openInterest: '...' })

    // Fetch fresh market data whenever the asset changes
    useEffect(() => {
        const assetName = selectedAsset?.name
        if (!assetName) return

        // Immediately apply any props we already have from selection
        if (selectedAsset?.change24h !== undefined) {
            setMarketData({
                change24h: selectedAsset.change24h,
                volume: selectedAsset.volume || '...',
                openInterest: selectedAsset.openInterest || '...'
            })
        } else {
            setMarketData({ change24h: undefined, volume: '...', openInterest: '...' })
        }

        // Then fetch fresh data from API to ensure accuracy
        let cancelled = false
        const fetchData = async () => {
            try {
                const allAssets = await hyperliquid.getAllAssets()
                if (cancelled) return
                const found = allAssets.find(a => a.name === assetName)
                if (found) {
                    setMarketData({
                        change24h: found.change24h,
                        volume: formatStatVolume(found.volume24h),
                        openInterest: found.openInterest > 0 ? formatStatVolume(found.openInterest) : '-'
                    })
                }
            } catch (e) {
                // Keep whatever we have from props
            }
        }
        fetchData()
        return () => { cancelled = true }
    }, [selectedAsset?.name])

    // Reset icon state when asset changes
    useEffect(() => {
        setIconSrcIndex(0)
        setIconFailed(false)
    }, [selectedAsset?.name, selectedAsset?.displayName])

    const getHeaderIconSources = (name: string, isSpotAsset: boolean): string[] => {
        const sym = isSpotAsset ? name.split('/')[0] : name
        const symLower = sym?.toLowerCase() || ''
        const symUpper = sym?.toUpperCase() || ''
        return [
            `https://app.hyperliquid.xyz/coins/${symUpper}.svg`,
            `https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color/${symLower}.png`,
            `https://assets.coincap.io/assets/icons/${symLower}@2x.png`,
        ]
    }

    // Close dropdown on outside click - ONLY target dropdown
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false)
            }
        }
        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isDropdownOpen])

    const handleViewSelect = (viewId: string) => {
        onViewChange?.(viewId)
        setDropdownOpen(false)
    }

    // Map of common assets to full names for display
    const ASSET_NAMES: Record<string, string> = {
        'BTC': 'Bitcoin',
        'ETH': 'Ethereum',
        'SOL': 'Solana',
        'HYPE': 'Hype Token',
        'XRP': 'Ripple',
        'ADA': 'Cardano',
        'AVAX': 'Avalanche',
        'DOGE': 'Dogecoin',
        'DOT': 'Polkadot',
        'MATIC': 'Polygon'
    };

    const currentView = DROPDOWN_ITEMS.find(item => item.id === activeView) || DROPDOWN_ITEMS[0]
    const assetName = selectedAsset?.name || "BTC"
    const uiName = selectedAsset?.displayName || assetName
    const isSpot = assetName.startsWith('@')
    const iconLookup = isSpot ? uiName.split('/')[0]?.toLowerCase() : uiName.toLowerCase()
    const displayName = ASSET_NAMES[uiName] ? `${uiName} - ${ASSET_NAMES[uiName]}` : uiName;
    // Live mark price: prefer spotPrices store (real-time), fall back to props
    const livePx = spotPrices[assetName]
    const assetPrice = livePx && livePx > 0 ? formatStatPrice(livePx) : (selectedAsset?.price || '...')

    return (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card text-sm">
            {/* Left: Asset Info */}
            <div className="flex items-center gap-8">
                {/* Asset Selector Container - Grouped with unified hover */}
                <div className="flex items-center bg-secondary/50 rounded-lg border border-border/50">
                    {/* Asset Button */}
                    <motion.button
                        onClick={onOpenSearch}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors group"
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                    >
                        <div key={uiName} className="h-5 w-5 rounded-full bg-white/5 flex items-center justify-center shrink-0 overflow-hidden relative">
                            {uiName === "HYPE" ? (
                                <img src="/HYPE.svg" alt="HYPE" className="w-full h-full object-cover p-[2px]" />
                            ) : (() => {
                                const srcs = getHeaderIconSources(uiName, isSpot)
                                return !iconFailed ? (
                                    <img
                                        key={`${uiName}-${iconSrcIndex}`}
                                        src={srcs[iconSrcIndex] || srcs[0]}
                                        alt={uiName}
                                        className="w-full h-full object-cover"
                                        onError={() => {
                                            if (iconSrcIndex + 1 < srcs.length) setIconSrcIndex(prev => prev + 1)
                                            else setIconFailed(true)
                                        }}
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[9px] font-bold bg-primary/20 text-primary">
                                        {uiName[0]}
                                    </div>
                                )
                            })()}
                        </div>

                        <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-sm text-foreground">{uiName}{!isSpot && 'USD'}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground border border-white/5 font-medium">
                                {selectedAsset?.leverage || '20x'}
                            </span>
                        </div>
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                    </motion.button>

                    {/* Divider */}
                    <div className="w-px h-6 bg-border/50" />

                    {/* View Dropdown Trigger */}
                    <div className="relative" ref={dropdownRef}>
                        <motion.button
                            onClick={() => setDropdownOpen(!isDropdownOpen)}
                            className="flex items-center gap-1.5 px-3 py-2 hover:bg-white/5 transition-colors text-muted-foreground hover:text-foreground"
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                        >
                            <currentView.icon className="h-4 w-4" />
                            <ChevronDown className="h-3.5 w-3.5" />
                        </motion.button>

                        <AnimatePresence>
                        {isDropdownOpen && (
                            <motion.div 
                                className="absolute top-full left-0 mt-1 w-44 bg-card border border-border rounded-lg shadow-xl z-50 py-1 overflow-hidden"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.15 }}
                            >
                                {DROPDOWN_ITEMS.map((item) => (
                                    <motion.button
                                        key={item.id}
                                        onClick={() => handleViewSelect(item.id)}
                                        className={cn(
                                            "w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors font-medium",
                                            activeView === item.id
                                                ? "text-foreground bg-primary/10 border-l-2 border-primary"
                                                : "text-muted-foreground hover:text-foreground hover:bg-white/5 border-l-2 border-transparent"
                                        )}
                                        whileHover={{ x: 2 }}
                                        transition={{ duration: 0.1 }}
                                    >
                                        <item.icon className="h-4 w-4" />
                                        {item.label}
                                    </motion.button>
                                ))}
                            </motion.div>
                        )}
                        </AnimatePresence>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Mark</span>
                        <span className="text-sm font-mono font-semibold text-foreground">{assetPrice}</span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">24h Change</span>
                        <span className={cn("text-sm font-mono font-semibold", (marketData.change24h ?? 0) >= 0 ? "text-primary" : "text-destructive")}>
                            {marketData.change24h !== undefined ? `${marketData.change24h > 0 ? '+' : ''}${marketData.change24h.toFixed(2)}%` : '...'}
                        </span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">24h Volume</span>
                        <span className="text-sm font-mono font-semibold text-foreground">{marketData.volume}</span>
                    </div>

                    <div className="flex flex-col">
                        <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Open Interest</span>
                        <span className="text-sm font-mono font-semibold text-foreground">{marketData.openInterest}</span>
                    </div>
                </div>
            </div>

            {/* Right: Quick Trade Toggle */}
            <div className="flex items-center gap-2">
                <button
                    onClick={onToggleQuickTrade}
                    className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border",
                        showQuickTrade
                            ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/15"
                            : "bg-secondary/50 text-muted-foreground border-border/50 hover:text-foreground hover:bg-white/5"
                    )}
                    title={showQuickTrade ? "Hide Quick Trade" : "Show Quick Trade"}
                >
                    <Zap className="h-3.5 w-3.5" />
                    Quick Trade
                </button>
            </div>
        </div>
    )
}
