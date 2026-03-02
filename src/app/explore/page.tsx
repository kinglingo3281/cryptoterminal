"use client"

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { ChevronUp, ChevronDown, ChevronRight, Star, Users, Copy, ExternalLink, LucideIcon, Loader2, Wallet, Clock, Target, AlertTriangle } from "lucide-react"
import { exploreService, type ExploreData, type ExploreWallet } from "@/services/ExploreService"
import { toast } from "sonner"

// Type for sidebar items
interface SidebarItem {
    id: string
    label: string
    icon?: LucideIcon
    count?: number
}

interface SidebarSection {
    title: string
    items: SidebarItem[]
    collapsible?: boolean
}

// Filter category to data mapping
type FilterCategory = 'alpha' | 'global' | 'whales' | 'tracked' | 
    'extremely-profitable' | 'very-profitable' | 'profitable' | 'slightly-profitable' |
    'slightly-unprofitable' | 'unprofitable' | 'very-unprofitable' | 'rekt' |
    'kraken' | 'large-whale' | 'whale' | 'small-whale' | 'apex-predator' | 'dolphin' | 'fish' | 'shrimp'

const formatVolume = (val: number) => {
    if (!val) return '$0'
    const abs = Math.abs(val)
    const sign = val < 0 ? '-' : ''
    if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`
    if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
    return `${sign}$${val.toFixed(0)}`
}

const truncateAddress = (addr: string) => {
    if (!addr || addr.length < 10) return addr
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

const formatPrice = (p: number) => {
    if (!p) return '$0.00'
    if (p >= 1000) return `$${p.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
    if (p >= 1) return `$${p.toFixed(4)}`
    return `$${p.toFixed(6)}`
}

const formatHoldingTime = (seconds?: number) => {
    if (!seconds) return '—'
    const hours = seconds / 3600
    if (hours < 1) return `${Math.round(seconds / 60)}m`
    if (hours < 24) return `${hours.toFixed(1)}h`
    return `${(hours / 24).toFixed(1)}d`
}

export default function ExplorePage() {
    const [activeFilter, setActiveFilter] = useState<FilterCategory>("alpha")
    const [exploreData, setExploreData] = useState<ExploreData | null>(null)
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
    const [expandedWallet, setExpandedWallet] = useState<string | null>(null)
    
    // Track previous wallet order for smooth transitions
    const prevWalletOrderRef = useRef<Map<string, number>>(new Map())
    const [newWallets, setNewWallets] = useState<Set<string>>(new Set())

    // Subscribe to ExploreService updates
    useEffect(() => {
        const unsubscribe = exploreService.subscribe((data) => {
            setExploreData(data)
        })
        return unsubscribe
    }, [])

    // Get wallets based on active filter - memoized to prevent unnecessary recalcs
    const wallets = useMemo((): ExploreWallet[] => {
        if (!exploreData) return []

        let result: ExploreWallet[]
        switch (activeFilter) {
            case 'alpha':
                result = exploreData.smartMoney
                break
            case 'global':
                result = exploreData.topTraders
                break
            case 'whales':
                result = exploreData.whales
                break
            // PNL cohorts
            case 'extremely-profitable':
            case 'very-profitable':
            case 'profitable':
            case 'slightly-profitable':
            case 'slightly-unprofitable':
            case 'unprofitable':
            case 'very-unprofitable':
            case 'rekt':
                result = exploreData.byCohort[activeFilter] || []
                break
            // Size tiers
            case 'kraken':
            case 'large-whale':
            case 'whale':
            case 'small-whale':
            case 'apex-predator':
            case 'dolphin':
            case 'fish':
            case 'shrimp':
                result = exploreData.bySize[activeFilter] || []
                break
            default:
                result = exploreData.topTraders
        }
        return result
    }, [activeFilter, exploreData])
    
    // Track new wallets for highlight animation
    useEffect(() => {
        if (wallets.length === 0) return
        
        const prevOrder = prevWalletOrderRef.current
        const currentAddresses = new Set(wallets.map(w => w.address))
        const newAddrs = new Set<string>()
        
        // Find wallets that weren't in previous list
        wallets.forEach((w, idx) => {
            if (!prevOrder.has(w.address)) {
                newAddrs.add(w.address)
            }
        })
        
        // Update previous order ref
        const newOrder = new Map<string, number>()
        wallets.forEach((w, idx) => newOrder.set(w.address, idx))
        prevWalletOrderRef.current = newOrder
        
        // Set new wallets for animation
        if (newAddrs.size > 0 && prevOrder.size > 0) {
            setNewWallets(newAddrs)
            // Clear highlight after animation
            const timer = setTimeout(() => setNewWallets(new Set()), 2000)
            return () => clearTimeout(timer)
        }
    }, [wallets])

    // Copy address to clipboard
    const handleCopy = async (address: string) => {
        try {
            await navigator.clipboard.writeText(address)
            toast.success('Address copied')
        } catch {
            toast.error('Failed to copy')
        }
    }

    // Open in Hypurrscan
    const handleExternalLink = (address: string) => {
        window.open(`https://hypurrscan.io/address/${address}`, '_blank')
    }

    // Toggle section collapse
    const toggleSection = (title: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev)
            if (next.has(title)) {
                next.delete(title)
            } else {
                next.add(title)
            }
            return next
        })
    }

    // Build sidebar sections with live counts
    const getSidebarSections = (): SidebarSection[] => {
        const getCohortCount = (id: string) => exploreData?.byCohort[id]?.length || 0
        const getSizeCount = (id: string) => exploreData?.bySize[id]?.length || 0

        return [
            {
                title: "EXPLORE",
                items: [
                    { id: "alpha", label: "Smart Money", icon: Star, count: exploreData?.smartMoney.length },
                    { id: "global", label: "Top Traders", icon: Users, count: exploreData?.topTraders.length },
                    { id: "whales", label: "Whales", icon: Wallet, count: exploreData?.whales.length },
                ]
            },
            {
                title: "PNL",
                collapsible: true,
                items: [
                    { id: "extremely-profitable", label: "Extremely Profitable", count: getCohortCount("extremely-profitable") },
                    { id: "very-profitable", label: "Very Profitable", count: getCohortCount("very-profitable") },
                    { id: "profitable", label: "Profitable", count: getCohortCount("profitable") },
                    { id: "slightly-profitable", label: "Slightly Profitable", count: getCohortCount("slightly-profitable") },
                    { id: "slightly-unprofitable", label: "Slightly Unprofitable", count: getCohortCount("slightly-unprofitable") },
                    { id: "unprofitable", label: "Unprofitable", count: getCohortCount("unprofitable") },
                    { id: "very-unprofitable", label: "Very Unprofitable", count: getCohortCount("very-unprofitable") },
                    { id: "rekt", label: "Rekt", count: getCohortCount("rekt") },
                ]
            },
            {
                title: "WALLET SIZE",
                collapsible: true,
                items: [
                    { id: "kraken", label: "Kraken (>$2.5M)", count: getSizeCount("kraken") },
                    { id: "large-whale", label: "Large Whale ($500K-$2.5M)", count: getSizeCount("large-whale") },
                    { id: "whale", label: "Whale ($250K-$500K)", count: getSizeCount("whale") },
                    { id: "small-whale", label: "Small Whale ($100K-$250K)", count: getSizeCount("small-whale") },
                    { id: "apex-predator", label: "Apex ($50K-$100K)", count: getSizeCount("apex-predator") },
                    { id: "dolphin", label: "Dolphin ($10K-$50K)", count: getSizeCount("dolphin") },
                    { id: "fish", label: "Fish ($1K-$10K)", count: getSizeCount("fish") },
                    { id: "shrimp", label: "Shrimp (<$1K)", count: getSizeCount("shrimp") },
                ]
            },
        ]
    }

    const sidebarSections = getSidebarSections()

    // Get filter display name
    const getFilterDisplayName = () => {
        for (const section of sidebarSections) {
            const item = section.items.find(i => i.id === activeFilter)
            if (item) return item.label
        }
        return "Traders"
    }

    // Get filter icon
    const getFilterIcon = () => {
        if (activeFilter === 'alpha') return <Star className="h-4 w-4" />
        if (activeFilter === 'global') return <Users className="h-4 w-4" />
        if (activeFilter === 'whales') return <Wallet className="h-4 w-4" />
        return null
    }

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <div className="w-64 border-r border-border bg-card shrink-0 overflow-y-auto">
                <div className="p-4 space-y-6">
                    {/* Status indicator */}
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs">
                        {exploreData?.isLoading ? (
                            <>
                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                <span className="text-muted-foreground">Aggregating wallets...</span>
                            </>
                        ) : exploreData?.error ? (
                            <>
                                <span className="text-destructive">⚠</span>
                                <span className="text-destructive">{exploreData.error}</span>
                            </>
                        ) : exploreData?.lastUpdate ? (
                            <>
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                <span className="text-muted-foreground">
                                    {exploreData.symbolsProcessed} symbols
                                </span>
                            </>
                        ) : (
                            <>
                                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                <span className="text-muted-foreground">Waiting for data...</span>
                            </>
                        )}
                    </div>

                    {sidebarSections.map(section => {
                        const isCollapsed = collapsedSections.has(section.title)
                        return (
                            <div key={section.title}>
                                <h3 
                                    className={cn(
                                        "text-[10px] font-bold text-muted-foreground mb-2 uppercase tracking-wider flex items-center justify-between",
                                        section.collapsible && "cursor-pointer hover:text-foreground"
                                    )}
                                    onClick={() => section.collapsible && toggleSection(section.title)}
                                >
                                    {section.title}
                                    {section.collapsible && (
                                        isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />
                                    )}
                                </h3>
                                {!isCollapsed && (
                                    <div className="space-y-0.5">
                                        {section.items.map(item => (
                                            <button
                                                key={item.id}
                                                onClick={() => setActiveFilter(item.id as FilterCategory)}
                                                className={cn(
                                                    "w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors",
                                                    activeFilter === item.id
                                                        ? "bg-primary/10 text-primary"
                                                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                                )}
                                            >
                                                <span className="flex items-center gap-2">
                                                    {item.icon && <item.icon className="h-3 w-3" />}
                                                    {item.label}
                                                </span>
                                                {item.count !== undefined && item.count > 0 && (
                                                    <span className="text-[10px] opacity-60">{item.count.toLocaleString()}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-4 border-b border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {getFilterIcon()}
                            <h1 className="text-lg font-bold">{getFilterDisplayName()}</h1>
                            <span className="text-sm text-muted-foreground">
                                ({wallets.length} wallets)
                            </span>
                        </div>
                        {exploreData?.lastUpdate && (
                            <span className="text-xs text-muted-foreground">
                                Updated {exploreData.lastUpdate.toLocaleTimeString()}
                            </span>
                        )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Categories based on historical performance. Pos PNL shows current position unrealized P&L.
                    </p>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-auto">
                    {!exploreData || exploreData.isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Loading wallet data...</p>
                        </div>
                    ) : wallets.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <Users className="h-8 w-8 text-muted-foreground" />
                            <p className="text-sm text-muted-foreground">No wallets found for this filter</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead className="sticky top-0 bg-card border-b border-border z-10">
                                <tr className="text-[10px] uppercase text-muted-foreground">
                                    <th className="text-left py-3 px-4 font-medium">Rank</th>
                                    <th className="text-left py-3 px-4 font-medium">Wallet</th>
                                    <th className="text-right py-3 px-4 font-medium" title="Current position unrealized PNL">Pos PNL</th>
                                    <th className="text-right py-3 px-4 font-medium">Equity</th>
                                    <th className="text-right py-3 px-4 font-medium">Notional</th>
                                    <th className="text-right py-3 px-4 font-medium">Leverage</th>
                                    <th className="text-left py-3 px-4 font-medium">Label</th>
                                    <th className="text-left py-3 px-4 font-medium">Symbols</th>
                                </tr>
                            </thead>
                            <tbody>
                                {wallets.map((wallet, i) => {
                                    const isExpanded = expandedWallet === wallet.address
                                    const isNew = newWallets.has(wallet.address)
                                    return (
                                        <React.Fragment key={wallet.address}>
                                            <tr 
                                                className={cn(
                                                    "border-b border-border/50 hover:bg-white/[0.02] cursor-pointer",
                                                    "transition-all duration-300 ease-out",
                                                    isNew && "animate-in slide-in-from-left-2 bg-primary/5"
                                                )}
                                                onClick={() => setExpandedWallet(isExpanded ? null : wallet.address)}
                                            >
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        {isExpanded ? (
                                                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                                        ) : (
                                                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                                        )}
                                                        <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary/20 to-primary/40 flex items-center justify-center">
                                                            <span className="text-[10px] font-bold">{i + 1}</span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-mono text-foreground">
                                                            {truncateAddress(wallet.address)}
                                                        </span>
                                                        <Copy 
                                                            className="h-3 w-3 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" 
                                                            onClick={(e) => { e.stopPropagation(); handleCopy(wallet.address) }}
                                                        />
                                                        <ExternalLink 
                                                            className="h-3 w-3 text-muted-foreground cursor-pointer hover:text-foreground transition-colors" 
                                                            onClick={(e) => { e.stopPropagation(); handleExternalLink(wallet.address) }}
                                                        />
                                                        {wallet.side && wallet.side !== 'MIXED' && (
                                                            <span className={cn(
                                                                "text-[10px] px-1.5 py-0.5 rounded",
                                                                wallet.side === 'LONG' ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"
                                                            )}>
                                                                {wallet.side}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-right">
                                                    <div className={cn(
                                                        "text-sm font-medium font-mono",
                                                        wallet.pnl >= 0 ? "text-green-500" : "text-red-500"
                                                    )}>
                                                        {wallet.pnl >= 0 ? '+' : ''}{formatVolume(wallet.pnl)}
                                                    </div>
                                                </td>
                                                <td className="py-3 px-4 text-right text-sm font-mono">
                                                    {formatVolume(wallet.equity)}
                                                </td>
                                                <td className="py-3 px-4 text-right text-sm font-mono text-muted-foreground">
                                                    {formatVolume(wallet.totalNotional)}
                                                </td>
                                                <td className="py-3 px-4 text-right text-sm font-mono text-muted-foreground">
                                                    {wallet.leverage.toFixed(1)}x
                                                </td>
                                                <td className="py-3 px-4">
                                                    {wallet.label && (
                                                        <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                                            {wallet.label}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4">
                                                    <div className="flex items-center gap-1 flex-wrap max-w-[200px]">
                                                        {wallet.symbols.slice(0, 3).map(sym => (
                                                            <span key={sym} className="text-[10px] px-1 py-0.5 rounded bg-muted/50 text-muted-foreground">
                                                                {sym}
                                                            </span>
                                                        ))}
                                                        {wallet.symbols.length > 3 && (
                                                            <span className="text-[10px] text-muted-foreground">
                                                                +{wallet.symbols.length - 3}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* Expanded Details Row */}
                                            {isExpanded && (
                                                <tr className="bg-muted/20 border-b border-border/50">
                                                    <td colSpan={8} className="py-3 px-4">
                                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                            <div className="space-y-2">
                                                                <h4 className="font-medium text-muted-foreground uppercase text-[10px]">Wallet Details</h4>
                                                                <div className="space-y-1">
                                                                    <div className="flex justify-between">
                                                                        <span className="text-muted-foreground">Full Address:</span>
                                                                        <span className="font-mono text-foreground">{truncateAddress(wallet.address)}</span>
                                                                    </div>
                                                                    {wallet.cohort && (
                                                                        <div className="flex justify-between">
                                                                            <span className="text-muted-foreground">Cohort:</span>
                                                                            <span className="text-foreground">{wallet.cohort}</span>
                                                                        </div>
                                                                    )}
                                                                    {wallet.sizeCohort && (
                                                                        <div className="flex justify-between">
                                                                            <span className="text-muted-foreground">Size Tier:</span>
                                                                            <span className="text-foreground">{wallet.sizeCohort}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <h4 className="font-medium text-muted-foreground uppercase text-[10px]">Position Info</h4>
                                                                <div className="space-y-1">
                                                                    {wallet.entry && wallet.entry > 0 && (
                                                                        <div className="flex justify-between">
                                                                            <span className="text-muted-foreground flex items-center gap-1"><Target className="h-3 w-3" /> Entry:</span>
                                                                            <span className="font-mono text-foreground">{formatPrice(wallet.entry)}</span>
                                                                        </div>
                                                                    )}
                                                                    {wallet.liq && wallet.liq > 0 && (
                                                                        <div className="flex justify-between">
                                                                            <span className="text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Liq:</span>
                                                                            <span className="font-mono text-destructive">{formatPrice(wallet.liq)}</span>
                                                                        </div>
                                                                    )}
                                                                    {wallet.holdingTime && wallet.holdingTime > 0 && (
                                                                        <div className="flex justify-between">
                                                                            <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Holding:</span>
                                                                            <span className="text-foreground">{formatHoldingTime(wallet.holdingTime)}</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <h4 className="font-medium text-muted-foreground uppercase text-[10px]">All Symbols</h4>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {wallet.symbols.map(sym => (
                                                                        <span key={sym} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                                                            {sym}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <h4 className="font-medium text-muted-foreground uppercase text-[10px]">Actions</h4>
                                                                <div className="flex flex-col gap-1">
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleExternalLink(wallet.address) }}
                                                                        className="flex items-center gap-1.5 text-primary hover:underline"
                                                                    >
                                                                        <ExternalLink className="h-3 w-3" />
                                                                        View on Hypurrscan
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleCopy(wallet.address) }}
                                                                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                                                                    >
                                                                        <Copy className="h-3 w-3" />
                                                                        Copy Address
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    )
}
