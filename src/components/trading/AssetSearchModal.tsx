"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Download, Upload, RefreshCw, X, Settings, Expand, Globe } from "lucide-react"
import { cn } from "@/lib/utils"
import { hyperliquid, UnifiedAsset } from "@/services/hyperliquid"

export interface Asset {
    symbol: string
    name: string
    coin: string
    displayName: string
    category: 'perps' | 'equities' | 'spot'
    leverage: string
    price: string
    priceNum: number
    change24h: number
    volume: string
    volumeNum: number
    openInterest: string
    openInterestNum: number
    quoteToken?: string
    baseToken?: string
}

type CategoryFilter = 'all' | 'perps' | 'equities' | 'spot'

type SortKey = 'symbol' | 'priceNum' | 'change24h' | 'volumeNum' | 'openInterestNum'
type SortDir = 'asc' | 'desc'

export type CommandAction = 'deposit' | 'withdraw' | 'transfer' | 'close_all' | 'close_longs' | 'close_shorts' | 'reverse_all' | 'reverse_longs' | 'reverse_shorts' | 'expand_book' | 'settings' | 'explore'

interface Command {
    id: CommandAction
    label: string
    subLabel?: string
    icon: React.ElementType
}

const COMMANDS: Command[] = [
    { id: 'deposit', label: 'Deposit', subLabel: 'Deposit funds to your account', icon: Download },
    { id: 'withdraw', label: 'Withdraw', subLabel: 'Withdraw funds from your account', icon: Upload },
    { id: 'transfer', label: 'Transfer', subLabel: 'Transfer between spot and perps', icon: RefreshCw },
    { id: 'close_all', label: 'Close All Positions', subLabel: 'Close all open positions', icon: X },
    { id: 'close_longs', label: 'Close Longs', subLabel: 'Close all long positions', icon: ArrowUp },
    { id: 'close_shorts', label: 'Close Shorts', subLabel: 'Close all short positions', icon: ArrowDown },
    { id: 'reverse_all', label: 'Reverse All Positions', subLabel: 'Reverse all open positions', icon: RefreshCw },
    { id: 'expand_book', label: 'Expand Orderbook', subLabel: 'Expand orderbook to full height', icon: Expand },
    { id: 'settings', label: 'Open Settings', icon: Settings },
    { id: 'explore', label: 'Go to Explore', icon: Globe },
]

interface AssetSearchModalProps {
    isOpen: boolean
    onClose: () => void
    onSelect?: (asset: Asset) => void
    onCommand?: (command: CommandAction) => void
}

function formatPrice(price: number): string {
    if (price <= 0) return '$0.00'
    if (price >= 1000) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    if (price >= 1) return `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    return `$${price.toFixed(5)}`
}

function formatVolume(vol: number): string {
    if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(1)}B`
    if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`
    if (vol >= 1_000) return `$${(vol / 1_000).toFixed(1)}K`
    if (vol > 0) return `$${vol.toFixed(0)}`
    return '-'
}

export function AssetSearchModal({ isOpen, onClose, onSelect, onCommand }: AssetSearchModalProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [activeTab, setActiveTab] = useState<'assets' | 'wallets'>('assets')
    const [sortKey, setSortKey] = useState<SortKey>('volumeNum')
    const [sortDir, setSortDir] = useState<SortDir>('desc')
    const [assets, setAssets] = useState<Asset[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
    const listRef = useRef<HTMLDivElement>(null)

    // Derived state for mode
    const isCommandMode = searchTerm.startsWith("/") || searchTerm === "/"
    const effectiveSearchTerm = isCommandMode ? searchTerm.slice(1) : searchTerm

    // Fetch all assets from Hyperliquid (perps + equities + spot)
    // getAllAssets() returns from 24h cache instantly after first load
    useEffect(() => {
        if (!isOpen) return

        const fetchAssets = async () => {
            // Only show loading spinner if we don't have assets yet (cold start)
            if (assets.length === 0) setLoading(true)
            try {
                const data = await hyperliquid.getAllAssets()
                const transformedAssets: Asset[] = data
                    .filter((a: UnifiedAsset) => {
                        // Filter out blank/broken entries: no display name, or @-prefixed raw names that didn't resolve
                        if (!a.displayName || a.displayName.startsWith('@')) return false
                        // Filter out zero-price assets (delisted or broken)
                        if (a.price <= 0 && a.volume24h <= 0) return false
                        return true
                    })
                    .map((a: UnifiedAsset) => ({
                        symbol: a.category === 'spot' ? `${a.displayName}` : `${a.name}-USD`,
                        name: a.name,
                        coin: a.coin,
                        displayName: a.displayName,
                        category: a.category,
                        leverage: a.maxLeverage > 0 ? `${a.maxLeverage}X` : '-',
                        price: formatPrice(a.price),
                        priceNum: a.price,
                        change24h: a.change24h,
                        volume: formatVolume(a.volume24h),
                        volumeNum: a.volume24h,
                        openInterest: a.openInterest > 0 ? formatVolume(a.openInterest) : '-',
                        openInterestNum: a.openInterest,
                        quoteToken: a.quoteToken,
                        baseToken: a.baseToken
                    }))

                transformedAssets.sort((a, b) => b.volumeNum - a.volumeNum)
                setAssets(transformedAssets)
            } catch (error) {
                console.error("Failed to fetch assets:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchAssets()
    }, [isOpen])

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
        } else {
            setSortKey(key)
            setSortDir('desc')
        }
    }

    // Filtering Logic
    const filteredItems = isCommandMode
        ? COMMANDS.filter(c =>
            c.label.toLowerCase().includes(effectiveSearchTerm.toLowerCase()) ||
            (c.subLabel && c.subLabel.toLowerCase().includes(effectiveSearchTerm.toLowerCase()))
        )
        : assets
            .filter(a => {
                if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
                if (!searchTerm) return true
                const term = searchTerm.toLowerCase()
                return a.displayName.toLowerCase().includes(term) ||
                    a.name.toLowerCase().includes(term) ||
                    a.symbol.toLowerCase().includes(term)
            })
            .sort((a, b) => {
                const aVal = a[sortKey]
                const bVal = b[sortKey]
                if (typeof aVal === 'string' && typeof bVal === 'string') {
                    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
                }
                return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number)
            })

    // Handle inputs
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose()
            return
        }
        if (e.key === 'Tab') {
            e.preventDefault()
            return
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1))
            return
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelectedIndex(prev => Math.max(prev - 1, 0))
            return
        }
        if (e.key === 'Enter' && filteredItems[selectedIndex]) {
            e.preventDefault()
            if (isCommandMode) {
                onCommand?.((filteredItems[selectedIndex] as Command).id)
            } else {
                onSelect?.(filteredItems[selectedIndex] as Asset)
            }
            onClose()
            return
        }
        if (e.key === '/') {
            // Let specific handling occur in onChange unless it's just a trigger
        }
    }, [onClose, filteredItems, selectedIndex, onSelect, onCommand, isCommandMode])

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedEl = listRef.current.children[selectedIndex] as HTMLElement
            selectedEl?.scrollIntoView({ block: 'nearest' })
        }
    }, [selectedIndex])

    // Reset selection when search or filter changes
    useEffect(() => {
        setSelectedIndex(0)
    }, [searchTerm, categoryFilter])

    useEffect(() => {
        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown)
            return () => window.removeEventListener('keydown', handleKeyDown)
        }
    }, [isOpen, handleKeyDown])

    if (!isOpen) return null

    const SortIcon = ({ active, dir }: { active: boolean, dir: SortDir }) => {
        if (!active) return <ArrowUpDown className="h-3 w-3 opacity-30" />
        return dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
    }

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 font-sans antialiased"
            onClick={onClose}
        >
            <div
                className="w-full max-w-2xl bg-[#0E0F11] border border-white/10 rounded-xl shadow-2xl flex flex-col overflow-hidden text-sm animate-in fade-in zoom-in-95 duration-100"
                onClick={(e) => e.stopPropagation()}
            >

                {/* Header Section */}
                <div className="flex flex-col gap-3 p-4 pb-0">
                    <div className="text-[#888888] text-[11px] font-medium tracking-wide">
                        {isCommandMode ? "/" : "Search assets, addresses, or type / for commands"}
                    </div>

                    {/* Tabs / Breadcrumbs when in command mode */}
                    <div className="flex items-center gap-6 border-b border-white/5">
                        {!isCommandMode ? (
                            <div className="pb-2.5 text-sm font-bold text-white border-b-2 border-white">
                                ASSETS
                            </div>
                        ) : (
                            <div className="pb-2.5 text-sm font-bold text-white border-b-2 border-white">
                                COMMANDS
                            </div>
                        )}
                    </div>

                    {/* Search Bar */}
                    <div className="relative group mt-2">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888] group-focus-within:text-white transition-colors" />
                        <input
                            autoFocus
                            type="text"
                            placeholder={isCommandMode ? "Type command..." : "Search..."}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-[#18191C] border border-white/5 rounded-lg pl-10 pr-12 py-2.5 text-white placeholder:text-[#555] focus:outline-none focus:border-white/20 transition-all font-medium"
                        />
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <kbd className="h-5 flex items-center gap-1 rounded border border-white/10 bg-[#222] px-1.5 font-mono text-[10px] font-medium text-[#888]">
                                ESC
                            </kbd>
                        </div>
                    </div>

                    {/* Filters - only show if not in command mode */}
                    {!isCommandMode && (
                        <div className="flex gap-2 py-3 overflow-x-auto no-scrollbar">
                            <FilterChip label="All" active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')} />
                            <FilterChip label="Perps" active={categoryFilter === 'perps'} onClick={() => setCategoryFilter('perps')} />
                            <FilterChip label="Equities / HIP3" active={categoryFilter === 'equities'} onClick={() => setCategoryFilter('equities')} />
                            <FilterChip label="Spot" active={categoryFilter === 'spot'} onClick={() => setCategoryFilter('spot')} />
                        </div>
                    )}
                </div>

                {/* Table Header (Assets only) */}
                {!isCommandMode && (
                    <div className="flex items-center px-4 py-2 text-[11px] font-medium text-[#666] uppercase tracking-wider border-b border-white/5 bg-[#0E0F11]">
                        <button onClick={() => handleSort('symbol')} className="flex-[2] flex items-center gap-1 hover:text-white text-left">
                            Asset <SortIcon active={sortKey === 'symbol'} dir={sortDir} />
                        </button>
                        <button onClick={() => handleSort('priceNum')} className="flex-1 flex items-center justify-end gap-1 hover:text-white">
                            Price <SortIcon active={sortKey === 'priceNum'} dir={sortDir} />
                        </button>
                        <button onClick={() => handleSort('change24h')} className="flex-1 flex items-center justify-end gap-1 hover:text-white">
                            24h Change <SortIcon active={sortKey === 'change24h'} dir={sortDir} />
                        </button>
                        <button onClick={() => handleSort('volumeNum')} className="flex-1 flex items-center justify-end gap-1 hover:text-white">
                            24h Volume <SortIcon active={sortKey === 'volumeNum'} dir={sortDir} />
                        </button>
                        <button onClick={() => handleSort('openInterestNum')} className="flex-1 flex items-center justify-end gap-1 hover:text-white">
                            Open Interest <SortIcon active={sortKey === 'openInterestNum'} dir={sortDir} />
                        </button>
                    </div>
                )}

                {/* List */}
                <div ref={listRef} className="flex-1 overflow-y-auto max-h-[400px] bg-[#0E0F11]">
                    {loading && !isCommandMode ? (
                        <div className="flex items-center justify-center py-12 text-[#666]">
                            Loading assets...
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div className="flex items-center justify-center py-12 text-[#666]">
                            No results found
                        </div>
                    ) : (
                        isCommandMode ? (
                            // Command List
                            (filteredItems as Command[]).map((cmd, index) => (
                                <div
                                    key={cmd.id}
                                    onClick={() => { onCommand?.(cmd.id); onClose(); }}
                                    className={cn(
                                        "flex items-center px-4 py-3 cursor-pointer transition-colors border-b border-white/5 last:border-0",
                                        index === selectedIndex ? "bg-white/[0.08]" : "hover:bg-white/[0.03]"
                                    )}
                                >
                                    <div className="h-8 w-8 rounded-lg bg-white/5 flex items-center justify-center mr-4 text-[#888]">
                                        <cmd.icon className="h-4 w-4" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium text-white">{cmd.label}</span>
                                        {cmd.subLabel && (
                                            <span className="text-xs text-[#666]">{cmd.subLabel}</span>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            // Asset List
                            (filteredItems as Asset[]).map((asset, index) => (
                                <AssetItem
                                    key={asset.symbol}
                                    asset={asset}
                                    isSelected={index === selectedIndex}
                                    onClick={() => { onSelect?.(asset); onClose(); }}
                                />
                            ))
                        )
                    )}
                </div>

                {/* Footer */}
                <div className="p-2.5 border-t border-white/5 text-[10px] text-[#666] flex justify-between px-4 bg-[#111] items-center">
                    <div className="flex gap-4">
                        <Shortcut label="Navigate" keys={['↑', '↓']} />
                        <Shortcut label="Select" keys={['↵']} />
                        <Shortcut label="Quick Open" keys={['⌘', 'K']} />
                    </div>
                    <div className="flex items-center opacity-80 hover:opacity-100 transition-opacity">
                        <img src="/evlogo-short-green.svg" alt="EV Logo" className="h-6 w-auto" />
                    </div>
                </div>
            </div>
        </div>
    )
}

function getIconSources(displayName: string, category: string): string[] {
    // Extract clean token name: "DEX:TOKEN" → TOKEN, "BTC/USDC" → BTC, "BTC" → BTC
    let sym = displayName
    if (sym.includes(':')) sym = sym.split(':').pop() || sym
    if (sym.includes('/')) sym = sym.split('/')[0] || sym
    const symLower = sym.toLowerCase()
    const symUpper = sym.toUpperCase()
    const sources: string[] = []

    if (category === 'equities') {
        sources.push(`https://logo.clearbit.com/${symLower}.com`)
        sources.push(`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color/${symLower}.png`)
    } else {
        // Hyperliquid's own CDN — covers ALL listed tokens (PURR, HYPE, spot pairs, etc.)
        sources.push(`https://app.hyperliquid.xyz/coins/${symUpper}.svg`)
        sources.push(`https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa5/128/color/${symLower}.png`)
        sources.push(`https://assets.coincap.io/assets/icons/${symLower}@2x.png`)
    }
    return sources
}

function AssetItem({ asset, isSelected, onClick }: { asset: Asset, isSelected: boolean, onClick: () => void }) {
    const [srcIndex, setSrcIndex] = useState(0)
    const [allFailed, setAllFailed] = useState(false)
    const sources = getIconSources(asset.displayName, asset.category)

    const categoryBadge = asset.category === 'equities'
        ? { bg: 'bg-purple-500/15', text: 'text-purple-400', border: 'border-purple-500/20', label: 'HIP3' }
        : asset.category === 'spot'
            ? { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/20', label: 'SPOT' }
            : null

    // DEX source badge for HIP-3 assets (e.g. "xyz", "lighter")
    const dexSource = asset.name.includes(':') ? asset.name.split(':')[0] : null

    const handleImgError = () => {
        if (srcIndex + 1 < sources.length) {
            setSrcIndex(prev => prev + 1)
        } else {
            setAllFailed(true)
        }
    }

    return (
        <div
            onClick={onClick}
            className={cn(
                "flex items-center px-4 py-3 cursor-pointer transition-colors border-b border-white/5 last:border-0",
                isSelected ? "bg-white/[0.08]" : "hover:bg-white/[0.03]"
            )}
        >
            {/* Asset Column */}
            <div className="flex-[2] flex items-center gap-3">
                <div className="h-7 w-7 rounded-full bg-white/5 flex items-center justify-center shrink-0 overflow-hidden relative">
                    {asset.displayName === "HYPE" ? (
                        <img src="/HYPE.svg" alt="HYPE" className="w-full h-full object-cover p-[3px]" />
                    ) : (
                        <>
                            {!allFailed && (
                                <img
                                    src={sources[srcIndex]}
                                    alt={asset.displayName}
                                    className="w-full h-full object-cover"
                                    onError={handleImgError}
                                />
                            )}
                            {allFailed && (
                                <div className="w-full h-full flex items-center justify-center font-bold text-[10px] bg-primary/20 text-white">
                                    {asset.displayName[0]}
                                </div>
                            )}
                        </>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white tracking-tight">
                        {asset.displayName}
                        {asset.category !== 'spot' && <span className="text-[#666] text-xs font-normal ml-0.5">USD</span>}
                    </span>
                    {asset.leverage !== '-' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-[3px] bg-blue-500/15 text-blue-400 font-bold border border-blue-500/20">
                            {asset.leverage}
                        </span>
                    )}
                    {categoryBadge && (
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold border", categoryBadge.bg, categoryBadge.text, categoryBadge.border)}>
                            {categoryBadge.label}
                        </span>
                    )}
                    {dexSource && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-[3px] font-medium border bg-violet-500/10 text-violet-400 border-violet-500/20">
                            {dexSource}
                        </span>
                    )}
                    {asset.category === 'spot' && asset.quoteToken && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-[3px] font-bold border bg-cyan-500/10 text-cyan-400 border-cyan-500/20">
                            {asset.quoteToken}
                        </span>
                    )}
                </div>
            </div>

            {/* Price */}
            <div className="flex-1 text-right text-sm font-medium text-white tracking-tight">
                {asset.price}
            </div>

            {/* 24h Change */}
            <div className={cn("flex-1 text-right text-sm font-medium tracking-tight", asset.change24h >= 0 ? "text-[#00C896]" : "text-[#FF4D4D]")}>
                {asset.change24h > 0 ? "+" : ""}{asset.change24h.toFixed(2)}%
            </div>

            {/* Volume */}
            <div className="flex-1 text-right text-sm text-[#888] font-medium tracking-tight">
                {asset.volume}
            </div>

            {/* Open Interest */}
            <div className="flex-1 text-right text-sm text-[#888] font-medium tracking-tight">
                {asset.openInterest}
            </div>
        </div>
    )
}

function FilterChip({ label, active, onClick }: { label: string, active?: boolean, onClick?: () => void }) {
    return (
        <button 
            onClick={onClick}
            className={cn("px-3 py-1 rounded-md text-[11px] font-bold transition-all border",
                active
                    ? "bg-white/10 text-white border-white/10"
                    : "bg-transparent text-[#666] border-transparent hover:bg-white/5 hover:text-white"
            )}
        >
            {label}
        </button>
    )
}

function Shortcut({ label, keys }: { label: string, keys: string[] }) {
    return (
        <span className="flex items-center gap-1.5">
            {label}
            <div className="flex gap-0.5">
                {keys.map(k => (
                    <kbd key={k} className="bg-white/5 px-1.5 py-0.5 rounded-[3px] text-white/70 min-w-[16px] text-center border border-white/5">
                        {k}
                    </kbd>
                ))}
            </div>
        </span>
    )
}
