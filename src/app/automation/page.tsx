"use client"

import { useState, useMemo, useEffect, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { HelpCircle, LayoutDashboard, Zap, XCircle, Target, TrendingUp, Activity, Power, Settings, Ban, Terminal, Trash2, ArrowUpDown, Filter, Download, Search, Radio } from "lucide-react"
import { AISignals } from "@/components/trading/AISignals"
import { cn } from "@/lib/utils"
import { useAutomationStore, LogEntry } from "@/store/useAutomationStore"
import { useSpotPricesStore } from "@/store/useSpotPricesStore"

type MainTab = "dashboard" | "autotrade" | "cancel" | "sltp" | "trailing" | "mm"
type AutoTradeSubTab = "volume" | "advanced" | "blacklist"

function AutomationPageInner() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const tabParam = searchParams.get('tab') as MainTab | null
    const mainTab: MainTab = tabParam && ['dashboard', 'autotrade', 'cancel', 'sltp', 'trailing', 'mm'].includes(tabParam) ? tabParam : 'dashboard'
    const [autoTradeSubTab, setAutoTradeSubTab] = useState<AutoTradeSubTab>("volume")
    
    // Activity Log filters
    const [logBotFilter, setLogBotFilter] = useState<string>('all')
    const [logSearch, setLogSearch] = useState('')
    const [logExpanded, setLogExpanded] = useState(false)
    const [terminalView, setTerminalView] = useState<'logs' | 'signals'>('logs')
    
    // Navigate to a specific tab
    const navigateToTab = (tab: MainTab) => {
        router.push(`/automation?tab=${tab}`)
    }
    const [searchTerm, setSearchTerm] = useState("")
    
    // Get all settings from store
    const {
        autoTradeEnabled, setAutoTradeEnabled,
        activeMode, setActiveMode,
        positionSize, setPositionSize,
        riskLevel, setRiskLevel,
        confidenceEnabled, setConfidenceEnabled,
        minConfidence, setMinConfidence,
        rrEnabled, setRrEnabled,
        minRR, setMinRR,
        maxRR, setMaxRR,
        tpDistanceEnabled, setTpDistanceEnabled,
        slDistanceEnabled, setSlDistanceEnabled,
        entryDistanceEnabled, setEntryDistanceEnabled,
        minTpDistance, setMinTpDistance,
        maxTpDistance, setMaxTpDistance,
        minSlDistance, setMinSlDistance,
        maxSlDistance, setMaxSlDistance,
        minEntryDistance, setMinEntryDistance,
        maxEntryDistance, setMaxEntryDistance,
        maxLongs, setMaxLongs,
        maxShorts, setMaxShorts,
        longBiasEnabled, setLongBiasEnabled,
        shortBiasEnabled, setShortBiasEnabled,
        longBias, setLongBias,
        shortBias, setShortBias,
        rangingEnabled, setRangingEnabled,
        liquidityEnabled, setLiquidityEnabled,
        enhancedEnabled, setEnhancedEnabled,
        v3Enabled, setV3Enabled,
        scaleUpSize, setScaleUpSize,
        orderLayering, setOrderLayering,
        crossOrder, setCrossOrder,
        blacklistedAssets,
        addToBlacklist,
        removeFromBlacklist,
        clearBlacklist,
        setBlacklist,
        // Cancel Bot
        cancelBotEnabled, setCancelBotEnabled,
        cancelTimeout, setCancelTimeout,
        cancelLimitOnly, setCancelLimitOnly,
        // SL/TP Bot (Position Defense)
        sltpBotEnabled, setSltpBotEnabled,
        autoSlEnabled, setAutoSlEnabled,
        autoTpEnabled, setAutoTpEnabled,
        defaultSlPercent, setDefaultSlPercent,
        defaultTpPercent, setDefaultTpPercent,
        // Trailing SL Bot
        trailingSLEnabled, setTrailingSLEnabled,
        trailingProfitTrigger, setTrailingProfitTrigger,
        trailingMode, setTrailingMode,
        // MM Bot
        mmBotEnabled, setMmBotEnabled,
        mmPricingMode, setMmPricingMode,
        mmPairSettings, setMmPairSetting, toggleMmPair,
        // Activity Log
        activityLog,
        addLog,
        clearLogs,
    } = useAutomationStore()
    
    // Add system log on mount
    useEffect(() => {
        addLog({ type: 'info', bot: 'system', message: 'Automation Center loaded' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    
    const { prices, isConnected } = useSpotPricesStore()
    
    const availableAssets = useMemo(() => Object.keys(prices).sort(), [prices])
    
    const filteredAssets = useMemo(() => {
        return availableAssets.filter(a => 
            !blacklistedAssets.includes(a) && 
            a.toLowerCase().includes(searchTerm.toLowerCase())
        )
    }, [availableAssets, blacklistedAssets, searchTerm])
    
    const handleBlacklistAll = () => {
        setBlacklist([...new Set([...blacklistedAssets, ...filteredAssets])])
    }

    const getRiskLabel = (level: number) => {
        const labels: Record<number, { name: string; description: string; color: string }> = {
            1: { name: "Safe", description: "Conservative Trading", color: "text-green-500" },
            2: { name: "Low", description: "Cautious Approach", color: "text-lime-500" },
            3: { name: "Balanced", description: "Moderate Risk", color: "text-yellow-500" },
            4: { name: "Aggressive", description: "High Risk Trading", color: "text-orange-500" },
            5: { name: "Maximum", description: "Extreme Risk", color: "text-red-500" },
        }
        return labels[level]
    }

    const riskInfo = getRiskLabel(riskLevel)
    const activeBots = [autoTradeEnabled, cancelBotEnabled, sltpBotEnabled, trailingSLEnabled, mmBotEnabled].filter(Boolean).length

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between py-4 px-6 border-b border-border">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Automation Center</h1>
                    <p className="text-sm text-muted-foreground">Configure and monitor all automated trading bots</p>
                </div>
                <div className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium",
                    activeBots > 0 ? "bg-green-500/10 text-green-500" : "bg-muted text-muted-foreground"
                )}>
                    <span className={cn("w-2 h-2 rounded-full", activeBots > 0 ? "bg-green-500 animate-pulse" : "bg-muted-foreground")} />
                    {activeBots} Bot{activeBots !== 1 ? "s" : ""} Active
                </div>
            </div>


            {/* Content */}
            <div className="flex-1 overflow-auto">
                {/* ========== DASHBOARD ========== */}
                {mainTab === "dashboard" && (
                    <div className="p-6">
                        <div className="grid grid-cols-5 gap-4 mb-6">
                            <BotCard 
                                title="Auto Trade" 
                                description="Signal-based automated trading"
                                icon={Zap}
                                active={autoTradeEnabled}
                                onToggle={() => setAutoTradeEnabled(!autoTradeEnabled)}
                                stats={[
                                    { label: "Mode", value: activeMode },
                                    { label: "Position", value: positionSize }
                                ]}
                                onClick={() => navigateToTab("autotrade")}
                            />
                            <BotCard 
                                title="Cancel Bot" 
                                description="Auto-cancel stale orders"
                                icon={XCircle}
                                active={cancelBotEnabled}
                                onToggle={() => setCancelBotEnabled(!cancelBotEnabled)}
                                stats={[
                                    { label: "Timeout", value: `${cancelTimeout} min` },
                                    { label: "Cancelled", value: "0 today" }
                                ]}
                                onClick={() => navigateToTab("cancel")}
                            />
                            <BotCard 
                                title="SL/TP Bot" 
                                description="Auto stop-loss & take-profit"
                                icon={Target}
                                active={sltpBotEnabled}
                                onToggle={() => setSltpBotEnabled(!sltpBotEnabled)}
                                stats={[
                                    { label: "Default SL", value: `${defaultSlPercent}%` },
                                    { label: "Default TP", value: `${defaultTpPercent}%` }
                                ]}
                                onClick={() => navigateToTab("sltp")}
                            />
                            <BotCard 
                                title="Trailing SL" 
                                description="Trail SL to breakeven"
                                icon={ArrowUpDown}
                                active={trailingSLEnabled}
                                onToggle={() => setTrailingSLEnabled(!trailingSLEnabled)}
                                stats={[
                                    { label: "Trigger", value: `${trailingProfitTrigger}%` },
                                    { label: "Mode", value: trailingMode }
                                ]}
                                onClick={() => navigateToTab("trailing")}
                            />
                            <BotCard 
                                title="MM Bot" 
                                description="StableCoin market making"
                                icon={TrendingUp}
                                active={mmBotEnabled}
                                onToggle={() => setMmBotEnabled(!mmBotEnabled)}
                                stats={[
                                    { label: "Mode", value: mmPricingMode === 'fixed' ? 'Fixed' : 'EVAlgo' },
                                    { label: "Pairs", value: `${Object.values(mmPairSettings).filter(p => p.enabled).length} active` }
                                ]}
                                onClick={() => navigateToTab("mm")}
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <StatCard icon={Activity} label="Today's Trades" value="0" color="primary" />
                            <StatCard icon={TrendingUp} label="Today's PnL" value="$0.00" color="green" />
                            <StatCard icon={Ban} label="Blacklisted" value={`${blacklistedAssets.length} assets`} color="muted" />
                        </div>

                        {/* Activity Terminal / AI Signals */}
                        <ActivityTerminal 
                            logs={activityLog}
                            botFilter={logBotFilter}
                            setBotFilter={setLogBotFilter}
                            search={logSearch}
                            setSearch={setLogSearch}
                            expanded={logExpanded}
                            setExpanded={setLogExpanded}
                            onClear={clearLogs}
                            terminalView={terminalView}
                            setTerminalView={setTerminalView}
                        />

                    </div>
                )}

                {/* ========== AUTO TRADE ========== */}
                {mainTab === "autotrade" && (
                    <div className="flex flex-col h-full">
                        <div className="flex items-center justify-between border-b border-border px-6 bg-card/30">
                            <div className="flex">
                                {["volume", "advanced", "blacklist"].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setAutoTradeSubTab(tab as AutoTradeSubTab)}
                                        className={cn(
                                            "px-5 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize",
                                            autoTradeSubTab === tab
                                                ? "text-primary border-primary bg-primary/5"
                                                : "text-muted-foreground border-transparent hover:text-foreground"
                                        )}
                                    >
                                        {tab === "volume" ? "Volume Mode" : tab === "advanced" ? "Advanced Mode" : "Blacklist"}
                                    </button>
                                ))}
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Active:</span>
                                    <div 
                                        className="relative flex items-center w-32 h-7 p-0.5 bg-secondary border border-border rounded cursor-pointer"
                                        onClick={() => setActiveMode(activeMode === "volume" ? "advanced" : "volume")}
                                    >
                                        <div className={cn(
                                            "absolute top-0.5 h-6 w-[calc(50%-2px)] bg-primary rounded transition-all",
                                            activeMode === "advanced" ? "left-[calc(50%+1px)]" : "left-0.5"
                                        )} />
                                        <span className={cn("flex-1 text-center text-xs font-medium z-10", activeMode === "volume" ? "text-primary-foreground" : "text-muted-foreground")}>Volume</span>
                                        <span className={cn("flex-1 text-center text-xs font-medium z-10", activeMode === "advanced" ? "text-primary-foreground" : "text-muted-foreground")}>Advanced</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Toggle checked={autoTradeEnabled} onChange={setAutoTradeEnabled} />
                                    <span className={cn("text-xs font-medium", autoTradeEnabled ? "text-green-500" : "text-muted-foreground")}>
                                        {autoTradeEnabled ? "Active" : "Inactive"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-6">
                            {autoTradeSubTab === "volume" && <VolumeMode positionSize={positionSize} setPositionSize={setPositionSize} riskLevel={riskLevel} setRiskLevel={setRiskLevel} riskInfo={riskInfo} />}
                            {autoTradeSubTab === "advanced" && <AdvancedMode {...{ positionSize, setPositionSize, confidenceEnabled, setConfidenceEnabled, minConfidence, setMinConfidence, rrEnabled, setRrEnabled, minRR, setMinRR, maxRR, setMaxRR, tpDistanceEnabled, setTpDistanceEnabled, slDistanceEnabled, setSlDistanceEnabled, entryDistanceEnabled, setEntryDistanceEnabled, minTpDistance, setMinTpDistance, maxTpDistance, setMaxTpDistance, minSlDistance, setMinSlDistance, maxSlDistance, setMaxSlDistance, minEntryDistance, setMinEntryDistance, maxEntryDistance, setMaxEntryDistance, maxLongs, setMaxLongs, maxShorts, setMaxShorts, longBiasEnabled, setLongBiasEnabled, shortBiasEnabled, setShortBiasEnabled, longBias, setLongBias, shortBias, setShortBias, rangingEnabled, setRangingEnabled, liquidityEnabled, setLiquidityEnabled, enhancedEnabled, setEnhancedEnabled, v3Enabled, setV3Enabled, scaleUpSize, setScaleUpSize, orderLayering, setOrderLayering, crossOrder, setCrossOrder }} />}
                            {autoTradeSubTab === "blacklist" && <BlacklistMode {...{ availableAssets, filteredAssets, blacklistedAssets, searchTerm, setSearchTerm, addToBlacklist, removeFromBlacklist, clearBlacklist, handleBlacklistAll, isConnected }} />}
                        </div>
                    </div>
                )}

                {/* ========== CANCEL BOT ========== */}
                {mainTab === "cancel" && (
                    <div className="p-6">
                        <div className="flex items-center justify-end mb-6">
                            <div className="flex items-center gap-2">
                                <Toggle checked={cancelBotEnabled} onChange={setCancelBotEnabled} />
                                <span className={cn("text-sm font-medium", cancelBotEnabled ? "text-green-500" : "text-muted-foreground")}>
                                    {cancelBotEnabled ? "Active" : "Inactive"}
                                </span>
                            </div>
                        </div>
                        <div className="bg-card border border-border rounded-lg p-5 max-w-xl">
                            <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">Settings</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-medium text-foreground mb-1.5 block">Cancel Timeout (minutes)</label>
                                    <input 
                                        type="number" 
                                        value={cancelTimeout} 
                                        onChange={(e) => setCancelTimeout(parseInt(e.target.value) || 5)}
                                        min={1} 
                                        max={60} 
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" 
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">Cancel limit orders only</span>
                                    <Toggle checked={cancelLimitOnly} onChange={setCancelLimitOnly} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ========== SL/TP BOT ========== */}
                {mainTab === "sltp" && (
                    <div className="p-6">
                        <div className="flex items-center justify-end mb-6">
                            <div className="flex items-center gap-2">
                                <Toggle checked={sltpBotEnabled} onChange={setSltpBotEnabled} />
                                <span className={cn("text-sm font-medium", sltpBotEnabled ? "text-green-500" : "text-muted-foreground")}>
                                    {sltpBotEnabled ? "Active" : "Inactive"}
                                </span>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4 max-w-3xl">
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">Stop Loss</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">Enable Auto SL</span>
                                        <Toggle checked={autoSlEnabled} onChange={setAutoSlEnabled} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-foreground mb-1.5 block">Default SL %</label>
                                        <input 
                                            type="number" 
                                            value={defaultSlPercent} 
                                            onChange={(e) => setDefaultSlPercent(parseFloat(e.target.value) || 2.0)}
                                            step={0.1} 
                                            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" 
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="bg-card border border-border rounded-lg p-5">
                                <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">Take Profit</h3>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-muted-foreground">Enable Auto TP</span>
                                        <Toggle checked={autoTpEnabled} onChange={setAutoTpEnabled} />
                                    </div>
                                    <div>
                                        <label className="text-xs font-medium text-foreground mb-1.5 block">Default TP %</label>
                                        <input 
                                            type="number" 
                                            value={defaultTpPercent} 
                                            onChange={(e) => setDefaultTpPercent(parseFloat(e.target.value) || 4.0)}
                                            step={0.1} 
                                            className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" 
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* ========== TRAILING SL BOT ========== */}
                {mainTab === "trailing" && (
                    <div className="p-6">
                        <div className="flex items-center justify-end mb-6">
                            <div className="flex items-center gap-2">
                                <Toggle checked={trailingSLEnabled} onChange={setTrailingSLEnabled} />
                                <span className={cn("text-sm font-medium", trailingSLEnabled ? "text-green-500" : "text-muted-foreground")}>
                                    {trailingSLEnabled ? "Active" : "Inactive"}
                                </span>
                            </div>
                        </div>
                        <div className="bg-card border border-border rounded-lg p-5 max-w-xl">
                            <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">Settings</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-medium text-foreground mb-1.5 block">Profit Trigger %</label>
                                    <p className="text-xs text-muted-foreground mb-2">Move SL to breakeven when position reaches this profit %</p>
                                    <input 
                                        type="number" 
                                        value={trailingProfitTrigger} 
                                        onChange={(e) => setTrailingProfitTrigger(parseFloat(e.target.value) || 2.0)}
                                        step={0.1}
                                        min={0.1}
                                        max={20}
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" 
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-foreground mb-1.5 block">Trailing Mode</label>
                                    <select 
                                        value={trailingMode}
                                        onChange={(e) => setTrailingMode(e.target.value as 'breakeven' | 'atr' | 'percent')}
                                        className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                                    >
                                        <option value="breakeven">Breakeven (Move SL to entry)</option>
                                        <option value="percent">Percent Trail (Trail by %)</option>
                                        <option value="atr">ATR Trail (Trail by ATR)</option>
                                    </select>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
                                When a position reaches {trailingProfitTrigger}% profit, the stop-loss will be moved to entry price (breakeven) to protect gains.
                            </p>
                        </div>
                    </div>
                )}

                {/* ========== MM BOT (StableCoin Market Maker) ========== */}
                {mainTab === "mm" && (
                    <div className="p-6">
                        <div className="flex items-center justify-end mb-6">
                            <div className="flex items-center gap-2">
                                <Toggle checked={mmBotEnabled} onChange={setMmBotEnabled} />
                                <span className={cn("text-sm font-medium", mmBotEnabled ? "text-green-500" : "text-muted-foreground")}>
                                    {mmBotEnabled ? "Active" : "Inactive"}
                                </span>
                            </div>
                        </div>
                        
                        <div className="bg-card border border-border rounded-lg p-5 max-w-2xl">
                            {/* Pricing Mode */}
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground">Pricing Mode</h3>
                                    <p className="text-xs text-muted-foreground">How bid/ask prices are determined</p>
                                </div>
                                <select 
                                    value={mmPricingMode}
                                    onChange={(e) => setMmPricingMode(e.target.value as 'fixed' | 'evalgo')}
                                    className="px-3 py-1.5 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary"
                                >
                                    <option value="fixed">Fixed Prices</option>
                                    <option value="evalgo">EVAlgo (Dynamic)</option>
                                </select>
                            </div>

                            {/* Stablecoin Pairs */}
                            <h3 className="text-sm font-semibold text-foreground mb-3">Stablecoin Pairs</h3>
                            <div className="space-y-3">
                                {[
                                    { symbol: '@230', name: 'USDH/USDC', description: 'Best pair - lowest fees' },
                                    { symbol: '@150', name: 'USDE/USDC', description: 'Ethena stablecoin' },
                                    { symbol: '@166', name: 'USDT0/USDC', description: 'Tether bridged' },
                                ].map(pair => {
                                    const settings = mmPairSettings[pair.symbol] || { enabled: false, balancePct: 100, fixedValue: null, maxBid: 0.9999, minAsk: 1.0001 }
                                    const sizeDisplay = settings.fixedValue ? `$${settings.fixedValue}` : `${settings.balancePct || 100}%`
                                    
                                    return (
                                        <div key={pair.symbol} className="p-3 bg-secondary/50 border border-border rounded-lg">
                                            <div className="flex items-center justify-between mb-2">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input 
                                                        type="checkbox"
                                                        checked={settings.enabled}
                                                        onChange={() => toggleMmPair(pair.symbol)}
                                                        className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
                                                    />
                                                    <span className="font-medium text-sm text-foreground">{pair.name}</span>
                                                    <span className="text-xs text-muted-foreground">({pair.description})</span>
                                                </label>
                                            </div>
                                            
                                            {settings.enabled && (
                                                <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/50">
                                                    <div>
                                                        <label className="text-xs text-muted-foreground mb-1 block">Size</label>
                                                        <input 
                                                            type="text"
                                                            value={sizeDisplay}
                                                            onChange={(e) => {
                                                                const val = e.target.value.trim()
                                                                if (val.endsWith('%')) {
                                                                    const pct = parseInt(val.replace('%', ''))
                                                                    if (!isNaN(pct) && pct > 0 && pct <= 100) {
                                                                        setMmPairSetting(pair.symbol, { balancePct: pct, fixedValue: null })
                                                                    }
                                                                } else {
                                                                    const usd = parseFloat(val.replace('$', ''))
                                                                    if (!isNaN(usd) && usd >= 10) {
                                                                        setMmPairSetting(pair.symbol, { fixedValue: Math.round(usd), balancePct: null })
                                                                    }
                                                                }
                                                            }}
                                                            placeholder="50% or $100"
                                                            className="w-full px-2 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none focus:border-primary"
                                                        />
                                                    </div>
                                                    {mmPricingMode === 'fixed' && (
                                                        <>
                                                            <div>
                                                                <label className="text-xs text-muted-foreground mb-1 block">Max Bid</label>
                                                                <input 
                                                                    type="number"
                                                                    value={settings.maxBid}
                                                                    onChange={(e) => setMmPairSetting(pair.symbol, { maxBid: parseFloat(e.target.value) || 0.9999 })}
                                                                    step={0.0001}
                                                                    min={0.9}
                                                                    max={1.1}
                                                                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none focus:border-primary"
                                                                />
                                                            </div>
                                                            <div>
                                                                <label className="text-xs text-muted-foreground mb-1 block">Min Ask</label>
                                                                <input 
                                                                    type="number"
                                                                    value={settings.minAsk}
                                                                    onChange={(e) => setMmPairSetting(pair.symbol, { minAsk: parseFloat(e.target.value) || 1.0001 })}
                                                                    step={0.0001}
                                                                    min={0.9}
                                                                    max={1.1}
                                                                    className="w-full px-2 py-1 bg-background border border-border rounded text-xs text-foreground focus:outline-none focus:border-primary"
                                                                />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                            
                            <p className="text-xs text-muted-foreground mt-4">
                                Size: Use % for balance percentage (e.g., 50%) or fixed USD amount (e.g., $100). 
                                Min $10 for fixed amounts.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function AutomationPage() {
    return (
        <Suspense>
            <AutomationPageInner />
        </Suspense>
    )
}

// ==================== COMPONENTS ====================

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="relative inline-flex cursor-pointer">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
            <div className="w-9 h-5 bg-secondary border border-border rounded-full peer peer-checked:bg-primary peer-checked:border-primary transition-all">
                <div className={cn("absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
            </div>
        </label>
    )
}

function BotCard({ title, description, icon: Icon, active, onToggle, stats, onClick }: { 
    title: string
    description: string
    icon: any
    active: boolean
    onToggle: () => void
    stats: { label: string; value: string }[]
    onClick: () => void 
}) {
    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation()
        onToggle()
    }
    
    return (
        <div onClick={onClick} className={cn("bg-card border rounded-lg p-4 cursor-pointer transition-all hover:border-primary/50", active ? "border-green-500/50" : "border-border")}>
            <div className="flex items-center justify-between mb-3">
                <div className={cn("p-2 rounded-lg", active ? "bg-green-500/10" : "bg-muted")}>
                    <Icon className={cn("h-5 w-5", active ? "text-green-500" : "text-muted-foreground")} />
                </div>
                <button
                    onClick={handleToggle}
                    className={cn(
                        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        active ? "bg-green-500" : "bg-muted"
                    )}
                    role="switch"
                    aria-checked={active}
                >
                    <span
                        className={cn(
                            "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform",
                            active ? "translate-x-4" : "translate-x-0"
                        )}
                    />
                </button>
            </div>
            <h3 className="font-semibold text-foreground mb-1">{title}</h3>
            <p className="text-xs text-muted-foreground mb-1">{description}</p>
            <span className={cn("text-xs font-medium", active ? "text-green-500" : "text-muted-foreground")}>
                {active ? "Running" : "Stopped"}
            </span>
            <div className="mt-3 pt-3 border-t border-border">
                {stats.map((s, i) => (
                    <div key={i} className="flex justify-between text-xs mt-1 first:mt-0">
                        <span className="text-muted-foreground">{s.label}</span>
                        <span className="text-foreground capitalize">{s.value}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
    const colors: Record<string, string> = { primary: "bg-primary/10 text-primary", green: "bg-green-500/10 text-green-500", muted: "bg-muted text-muted-foreground" }
    return (
        <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg", colors[color]?.split(" ")[0] || "bg-muted")}>
                    <Icon className={cn("h-5 w-5", colors[color]?.split(" ")[1] || "text-muted-foreground")} />
                </div>
                <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-semibold text-foreground">{value}</p>
                </div>
            </div>
        </div>
    )
}

function VolumeMode({ positionSize, setPositionSize, riskLevel, setRiskLevel, riskInfo }: any) {
    return (
        <div className="max-w-2xl mx-auto">
            <div className="bg-card border border-border rounded-lg p-5 mb-4">
                <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">Position & Risk</h3>
                <div className="mb-5">
                    <label className="text-sm font-medium text-foreground mb-2 block">Position Size</label>
                    <input type="text" value={positionSize} onChange={(e) => setPositionSize(e.target.value)} placeholder="2.5% or $50" className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" />
                    <select value={positionSize} onChange={(e) => e.target.value && setPositionSize(e.target.value)} className="mt-2 w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary">
                        <option value="">Select Preset</option>
                        <option value="$10">Micro ($10)</option>
                        <option value="$25">Small ($25)</option>
                        <option value="$50">Medium ($50)</option>
                        <option value="$100">Large ($100)</option>
                        <option value="$250">X-Large ($250)</option>
                        <option value="0.5%">Conservative (0.5%)</option>
                        <option value="1.0%">Low (1.0%)</option>
                        <option value="2.5%">Medium (2.5%)</option>
                        <option value="5.0%">High (5.0%)</option>
                        <option value="10.0%">Aggressive (10.0%)</option>
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-foreground mb-2 block">Risk Level</label>
                    <div className="flex items-center justify-center p-3 bg-secondary border border-border rounded-lg mb-3">
                        <div className="text-center">
                            <span className={cn("text-sm font-semibold", riskInfo.color)}>{riskInfo.name}</span>
                            <p className="text-xs text-muted-foreground">{riskInfo.description}</p>
                        </div>
                    </div>
                    <input type="range" min={1} max={5} value={riskLevel} onChange={(e) => setRiskLevel(parseInt(e.target.value))} className="w-full h-1.5 bg-border rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:rounded-full" />
                    <div className="flex justify-between text-xs text-muted-foreground mt-1">
                        <span>Safe</span>
                        <span>Maximum</span>
                    </div>
                </div>
            </div>
        </div>
    )
}

function AdvancedMode(props: any) {
    const { positionSize, setPositionSize, confidenceEnabled, setConfidenceEnabled, minConfidence, setMinConfidence, rrEnabled, setRrEnabled, minRR, setMinRR, maxRR, setMaxRR, tpDistanceEnabled, setTpDistanceEnabled, slDistanceEnabled, setSlDistanceEnabled, entryDistanceEnabled, setEntryDistanceEnabled, minTpDistance, setMinTpDistance, maxTpDistance, setMaxTpDistance, minSlDistance, setMinSlDistance, maxSlDistance, setMaxSlDistance, minEntryDistance, setMinEntryDistance, maxEntryDistance, setMaxEntryDistance, maxLongs, setMaxLongs, maxShorts, setMaxShorts, longBiasEnabled, setLongBiasEnabled, shortBiasEnabled, setShortBiasEnabled, longBias, setLongBias, shortBias, setShortBias, rangingEnabled, setRangingEnabled, liquidityEnabled, setLiquidityEnabled, enhancedEnabled, setEnhancedEnabled, v3Enabled, setV3Enabled, scaleUpSize, setScaleUpSize, orderLayering, setOrderLayering, crossOrder, setCrossOrder } = props
    
    return (
        <div className="grid grid-cols-3 gap-4">
            <div className="space-y-4">
                <Card title="Position & Risk">
                    <label className="text-xs font-medium text-foreground mb-1.5 block">Position Size</label>
                    <input type="text" value={positionSize} onChange={(e) => setPositionSize(e.target.value)} className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary" />
                    <select value={positionSize} onChange={(e) => e.target.value && setPositionSize(e.target.value)} className="mt-2 w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary">
                        <option value="">Select Preset</option>
                        <option value="$10">Micro ($10)</option>
                        <option value="$25">Small ($25)</option>
                        <option value="$50">Medium ($50)</option>
                        <option value="$100">Large ($100)</option>
                        <option value="$250">X-Large ($250)</option>
                        <option value="0.5%">Conservative (0.5%)</option>
                        <option value="1.0%">Low (1.0%)</option>
                        <option value="2.5%">Medium (2.5%)</option>
                        <option value="5.0%">High (5.0%)</option>
                        <option value="10.0%">Aggressive (10.0%)</option>
                    </select>
                </Card>
                <Card title="Confidence Filter">
                    <Row label="Enable" toggle checked={confidenceEnabled} onChange={setConfidenceEnabled} />
                    <Input label="Min Confidence" type="number" value={minConfidence} onChange={(v) => setMinConfidence(parseFloat(v))} step={0.01} />
                </Card>
                <Card title="Reward/Risk Filters">
                    <Row label="Enable R/R" toggle checked={rrEnabled} onChange={setRrEnabled} />
                    <Input label="Min R/R" type="number" value={minRR} onChange={(v) => setMinRR(parseFloat(v))} step={0.1} />
                    <Input label="Max R/R" type="number" value={maxRR} onChange={(v) => setMaxRR(parseFloat(v))} step={0.1} />
                </Card>
            </div>
            <div className="space-y-4">
                <Card title="Distance Filters">
                    <Row label="TP Distance" toggle checked={tpDistanceEnabled} onChange={setTpDistanceEnabled} />
                    <Row label="SL Distance" toggle checked={slDistanceEnabled} onChange={setSlDistanceEnabled} />
                    <Row label="Entry Distance" toggle checked={entryDistanceEnabled} onChange={setEntryDistanceEnabled} />
                    <div className="grid grid-cols-2 gap-2 mt-3">
                        <Input label="Min TP %" type="number" value={minTpDistance} onChange={(v) => setMinTpDistance(parseFloat(v))} step={0.1} small />
                        <Input label="Max TP %" type="number" value={maxTpDistance} onChange={(v) => setMaxTpDistance(parseFloat(v))} step={0.1} small />
                        <Input label="Min SL %" type="number" value={minSlDistance} onChange={(v) => setMinSlDistance(parseFloat(v))} step={0.1} small />
                        <Input label="Max SL %" type="number" value={maxSlDistance} onChange={(v) => setMaxSlDistance(parseFloat(v))} step={0.1} small />
                        <Input label="Min Entry %" type="number" value={minEntryDistance} onChange={(v) => setMinEntryDistance(parseFloat(v))} step={0.1} small />
                        <Input label="Max Entry %" type="number" value={maxEntryDistance} onChange={(v) => setMaxEntryDistance(parseFloat(v))} step={0.1} small />
                    </div>
                </Card>
                <Card title="Position Limits">
                    <Input label="Max Longs" type="number" value={maxLongs} onChange={(v) => setMaxLongs(parseInt(v))} />
                    <Input label="Max Shorts" type="number" value={maxShorts} onChange={(v) => setMaxShorts(parseInt(v))} />
                </Card>
            </div>
            <div className="space-y-4">
                <Card title="Market Bias">
                    <Row label="Enable Long Bias" toggle checked={longBiasEnabled} onChange={setLongBiasEnabled} />
                    <Input label="Long Adjust %" type="number" value={longBias} onChange={(v) => setLongBias(parseInt(v))} />
                    <Row label="Enable Short Bias" toggle checked={shortBiasEnabled} onChange={setShortBiasEnabled} />
                    <Input label="Short Adjust %" type="number" value={shortBias} onChange={(v) => setShortBias(parseInt(v))} />
                </Card>
                <Card title="Signal Types">
                    <Row label="Ranging" toggle checked={rangingEnabled} onChange={setRangingEnabled} />
                    <Row label="Liquidity" toggle checked={liquidityEnabled} onChange={setLiquidityEnabled} />
                    <Row label="Enhanced" toggle checked={enhancedEnabled} onChange={setEnhancedEnabled} />
                    <Row label="V3" toggle checked={v3Enabled} onChange={setV3Enabled} />
                </Card>
                <Card title="Order Sizing">
                    <Row label="Scale Up Size" toggle checked={scaleUpSize} onChange={setScaleUpSize} />
                    <Row label="Order Layering" toggle checked={orderLayering} onChange={setOrderLayering} />
                    <Row label="Prevent Duplicates" toggle checked={crossOrder} onChange={setCrossOrder} />
                </Card>
            </div>
        </div>
    )
}

function BlacklistMode({ availableAssets, filteredAssets, blacklistedAssets, searchTerm, setSearchTerm, addToBlacklist, removeFromBlacklist, clearBlacklist, handleBlacklistAll, isConnected }: any) {
    return (
        <div>
            <div className="flex gap-4 mb-6">
                <div className="flex-1 bg-card border border-border rounded-lg p-4">
                    <span className="text-xs text-muted-foreground block mb-1">Available Assets</span>
                    <span className="text-xl font-semibold text-foreground">{availableAssets.length - blacklistedAssets.length}</span>
                </div>
                <div className="flex-1 bg-card border border-primary/30 rounded-lg p-4">
                    <span className="text-xs text-muted-foreground block mb-1">Blacklisted</span>
                    <span className="text-xl font-semibold text-primary">{blacklistedAssets.length}</span>
                </div>
            </div>
            {!isConnected && <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive">⚠️ WebSocket disconnected</div>}
            <div className="grid grid-cols-2 gap-6">
                <div className="bg-card border border-border rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-foreground">Available Assets</h3>
                            {isConnected && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />}
                        </div>
                        <button onClick={handleBlacklistAll} disabled={filteredAssets.length === 0} className="px-3 py-1.5 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors disabled:opacity-50">Blacklist All</button>
                    </div>
                    <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Search assets..." className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground mb-4 focus:outline-none focus:border-primary" />
                    <div className="grid grid-cols-4 gap-2 max-h-80 overflow-auto">
                        {filteredAssets.length === 0 ? (
                            <div className="col-span-4 text-center py-8 text-muted-foreground text-sm">No assets</div>
                        ) : filteredAssets.map((asset: string) => (
                            <div key={asset} onClick={() => addToBlacklist(asset)} className="flex items-center justify-between px-3 py-2 bg-secondary rounded cursor-pointer hover:bg-secondary/80 group">
                                <span className="text-xs font-medium text-foreground">{asset}</span>
                                <span className="text-primary opacity-0 group-hover:opacity-100">+</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="bg-card border border-border rounded-lg p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-foreground">Blacklisted</h3>
                        <button onClick={clearBlacklist} disabled={blacklistedAssets.length === 0} className="px-3 py-1.5 text-xs bg-destructive/10 text-destructive rounded hover:bg-destructive/20 transition-colors disabled:opacity-50">Clear All</button>
                    </div>
                    <div className="space-y-2 max-h-96 overflow-auto">
                        {blacklistedAssets.length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground text-sm">No assets blacklisted</div>
                        ) : [...blacklistedAssets].sort().map((asset: string) => (
                            <div key={asset} className="flex items-center justify-between px-3 py-2 bg-secondary rounded group">
                                <span className="text-sm font-medium text-foreground">{asset}</span>
                                <button onClick={() => removeFromBlacklist(asset)} className="text-destructive opacity-50 group-hover:opacity-100">✕</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 pb-3 border-b border-border">{title}</h3>
            <div className="space-y-3">{children}</div>
        </div>
    )
}

function Row({ label, toggle, checked, onChange }: { label: string; toggle?: boolean; checked?: boolean; onChange?: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{label}</span>
            {toggle && <Toggle checked={checked!} onChange={onChange!} />}
        </div>
    )
}

function Input({ label, type, value, onChange, step, small }: { label: string; type: string; value: any; onChange: (v: string) => void; step?: number; small?: boolean }) {
    return (
        <div>
            <label className="text-xs font-medium text-foreground mb-1 block">{label}</label>
            <input type={type} value={value} onChange={(e) => onChange(e.target.value)} step={step} className={cn("w-full bg-secondary border border-border rounded text-foreground focus:outline-none focus:border-primary", small ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm")} />
        </div>
    )
}

const BOT_FILTERS = [
    { id: 'all', label: 'All', color: 'text-terminal-text' },
    { id: 'system', label: 'System', color: 'text-terminal-text-muted' },
    { id: 'autotrade', label: 'Auto Trade', color: 'text-terminal-success' },
    { id: 'cancel', label: 'Cancel', color: 'text-terminal-error' },
    { id: 'sltp', label: 'SL/TP', color: 'text-terminal-info' },
    { id: 'trailing', label: 'Trailing', color: 'text-terminal-warning' },
    { id: 'mm', label: 'MM', color: 'text-terminal-purple' },
] as const

function ActivityTerminal({ 
    logs, 
    botFilter, 
    setBotFilter, 
    search, 
    setSearch, 
    expanded, 
    setExpanded,
    onClear,
    terminalView,
    setTerminalView
}: {
    logs: LogEntry[]
    botFilter: string
    setBotFilter: (filter: string) => void
    search: string
    setSearch: (search: string) => void
    expanded: boolean
    setExpanded: (expanded: boolean) => void
    onClear: () => void
    terminalView: 'logs' | 'signals'
    setTerminalView: (view: 'logs' | 'signals') => void
}) {
    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (botFilter !== 'all' && log.bot !== botFilter) return false
            if (search && !log.message.toLowerCase().includes(search.toLowerCase())) return false
            return true
        })
    }, [logs, botFilter, search])

    const exportLogs = () => {
        const content = filteredLogs.map(log => {
            const time = new Date(log.timestamp).toISOString()
            return `[${time}] [${log.bot.toUpperCase()}] [${log.type.toUpperCase()}] ${log.message}`
        }).join('\n')
        const blob = new Blob([content], { type: 'text/plain' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `bot-logs-${new Date().toISOString().slice(0, 10)}.txt`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className={cn(
            "bg-terminal-bg border border-terminal-border rounded-lg overflow-hidden mb-6 transition-all",
            expanded ? "fixed inset-4 z-50" : ""
        )}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-terminal-header border-b border-terminal-border">
                <div className="flex items-center gap-3">
                    {/* View Toggle */}
                    <div className="flex items-center bg-terminal-bg rounded border border-terminal-border">
                        <button
                            onClick={() => setTerminalView('logs')}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1 text-xs transition-colors rounded-l",
                                terminalView === 'logs' 
                                    ? "bg-terminal-border text-terminal-text" 
                                    : "text-terminal-text-muted hover:text-terminal-text"
                            )}
                        >
                            <Terminal className="h-3 w-3" />
                            Logs
                        </button>
                        <button
                            onClick={() => setTerminalView('signals')}
                            className={cn(
                                "flex items-center gap-1.5 px-2 py-1 text-xs transition-colors rounded-r",
                                terminalView === 'signals' 
                                    ? "bg-terminal-border text-terminal-text" 
                                    : "text-terminal-text-muted hover:text-terminal-text"
                            )}
                        >
                            <Radio className="h-3 w-3" />
                            AI Signals
                        </button>
                    </div>
                    {terminalView === 'logs' && (
                        <span className="text-xs text-terminal-text-muted">
                            {filteredLogs.length === logs.length 
                                ? `${logs.length} entries` 
                                : `${filteredLogs.length}/${logs.length} entries`}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {terminalView === 'logs' && (
                        <button 
                            onClick={exportLogs}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-terminal-text-muted hover:text-terminal-text transition-colors"
                            title="Export logs"
                        >
                            <Download className="h-3 w-3" />
                        </button>
                    )}
                    <button 
                        onClick={() => setExpanded(!expanded)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-terminal-text-muted hover:text-terminal-text transition-colors"
                        title={expanded ? "Collapse" : "Expand"}
                    >
                        <ArrowUpDown className="h-3 w-3" />
                    </button>
                    {terminalView === 'logs' && (
                        <button 
                            onClick={onClear}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-terminal-text-muted hover:text-terminal-error transition-colors"
                            title="Clear logs"
                        >
                            <Trash2 className="h-3 w-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* Content based on view */}
            {terminalView === 'logs' ? (
                <>
                    {/* Filters Bar */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-terminal-header/50 border-b border-terminal-border">
                        <Filter className="h-3 w-3 text-terminal-text-muted" />
                        <div className="flex items-center gap-1">
                            {BOT_FILTERS.map(filter => (
                                <button
                                    key={filter.id}
                                    onClick={() => setBotFilter(filter.id)}
                                    className={cn(
                                        "px-2 py-0.5 text-xs rounded transition-colors",
                                        botFilter === filter.id 
                                            ? "bg-terminal-border text-terminal-text" 
                                            : "text-terminal-text-muted hover:text-terminal-text"
                                    )}
                                >
                                    <span className={botFilter === filter.id ? filter.color : ''}>{filter.label}</span>
                                </button>
                            ))}
                        </div>
                        <div className="flex-1" />
                        <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-terminal-text-muted" />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search logs..."
                                className="w-40 pl-7 pr-2 py-1 text-xs bg-terminal-bg border border-terminal-border rounded text-terminal-text placeholder:text-terminal-text-muted focus:outline-none focus:border-terminal-info"
                            />
                        </div>
                    </div>

                    {/* Log Content */}
                    <div className={cn(
                        "overflow-auto p-3 font-mono text-xs",
                        expanded ? "h-[calc(100%-88px)]" : "h-48"
                    )}>
                        {filteredLogs.length === 0 ? (
                            <div className="text-terminal-text-muted text-center py-8">
                                {logs.length === 0 ? "No activity yet" : "No matching logs"}
                            </div>
                        ) : (
                            filteredLogs.map((entry) => (
                                <LogLine key={entry.id} entry={entry} />
                            ))
                        )}
                    </div>
                </>
            ) : (
                /* AI Signals View */
                <div className={cn(
                    "overflow-hidden bg-terminal-bg",
                    expanded ? "h-[calc(100%-44px)]" : "h-64"
                )}>
                    <AISignals embedded />
                </div>
            )}
        </div>
    )
}

function LogLine({ entry }: { entry: LogEntry }) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })
    const date = new Date(entry.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const typeColors: Record<string, string> = {
        info: 'text-terminal-info',
        success: 'text-terminal-success',
        warning: 'text-terminal-warning',
        error: 'text-terminal-error',
        trade: 'text-terminal-purple',
    }
    const botColors: Record<string, string> = {
        system: 'text-terminal-text-muted',
        autotrade: 'text-terminal-success',
        cancel: 'text-terminal-error',
        sltp: 'text-terminal-info',
        trailing: 'text-terminal-warning',
        mm: 'text-terminal-purple',
    }
    return (
        <div className="flex items-start gap-2 py-1 border-b border-terminal-border-dim last:border-0 hover:bg-terminal-header/30">
            <span className="text-terminal-text-dim shrink-0 tabular-nums">[{date} {time}]</span>
            <span className={cn("shrink-0 uppercase font-medium w-20", botColors[entry.bot])}>[{entry.bot}]</span>
            <span className={cn("flex-1", typeColors[entry.type])}>{entry.message}</span>
        </div>
    )
}
