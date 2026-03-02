"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { TrendingUp, TrendingDown, RefreshCw, BarChart3, DollarSign, Activity, Wallet, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { hyperliquid } from "@/services/hyperliquid"
import { useUserStore } from "@/store/useUserStore"

type TimePeriod = "day" | "week" | "month" | "allTime"
type PerpTimePeriod = "perpDay" | "perpWeek" | "perpMonth" | "perpAllTime"

interface PortfolioData {
    accountValueHistory: [number, string][]
    pnlHistory: [number, string][]
    vlm: string
}

interface EquityData {
    perpEquity: number
    spotEquity: number
    totalEquity: number
    withdrawable: number
    marginUsed: number
    totalNtlPos: number
}

interface FeeData {
    perpTaker: string
    perpMaker: string
    spotTaker: string
    spotMaker: string
    volume14d: number
    dailyVolumes: { date: string; volume: number }[]
}

const TIME_PERIODS: { key: TimePeriod; perpKey: PerpTimePeriod; label: string }[] = [
    { key: "day", perpKey: "perpDay", label: "1D" },
    { key: "week", perpKey: "perpWeek", label: "7D" },
    { key: "month", perpKey: "perpMonth", label: "30D" },
    { key: "allTime", perpKey: "perpAllTime", label: "All" },
]

function formatUsd(value: number, compact = false): string {
    if (compact) {
        const abs = Math.abs(value)
        if (abs >= 1e9) return `${value < 0 ? "-" : ""}$${(abs / 1e9).toFixed(1)}B`
        if (abs >= 1e6) return `${value < 0 ? "-" : ""}$${(abs / 1e6).toFixed(1)}M`
        if (abs >= 1e3) return `${value < 0 ? "-" : ""}$${(abs / 1e3).toFixed(1)}K`
    }
    const sign = value < 0 ? "-" : ""
    return `${sign}$${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPercent(value: number): string {
    return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function MiniAreaChart({
    data,
    width = 600,
    height = 180,
    positive,
}: {
    data: { t: number; v: number }[]
    width?: number
    height?: number
    positive?: boolean
}) {
    if (!data.length) return null

    const values = data.map((d) => d.v)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * width
        const y = height - ((d.v - min) / range) * (height - 20) - 10
        return `${x},${y}`
    })

    const linePath = `M${points.join(" L")}`
    const areaPath = `${linePath} L${width},${height} L0,${height} Z`

    const isPositive = positive ?? values[values.length - 1] >= values[0]
    const strokeColor = isPositive ? "var(--primary)" : "var(--destructive)"
    const fillId = `area-fill-${isPositive ? "pos" : "neg"}-${data.length}`

    return (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
            <defs>
                <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${fillId})`} />
            <path d={linePath} fill="none" stroke={strokeColor} strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
    )
}

function StatCard({
    label,
    value,
    subValue,
    icon: Icon,
    valueClass,
}: {
    label: string
    value: string
    subValue?: string
    icon?: React.ElementType
    valueClass?: string
}) {
    return (
        <div className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-secondary/30">
            <div className="flex items-center gap-1.5">
                {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{label}</span>
            </div>
            <span className={cn("text-sm font-mono font-semibold", valueClass || "text-foreground")}>{value}</span>
            {subValue && <span className="text-xs text-muted-foreground font-mono">{subValue}</span>}
        </div>
    )
}

function VolumeBarChart({ dailyVolumes }: { dailyVolumes: { date: string; volume: number }[] }) {
    if (!dailyVolumes.length) return null

    const last14 = dailyVolumes.slice(-14)
    const maxVol = Math.max(...last14.map((d) => d.volume), 1)
    const BAR_AREA_PX = 64

    return (
        <div className="flex items-end gap-0.5 w-full" style={{ height: `${BAR_AREA_PX}px` }}>
            {last14.map((d) => {
                const ratio = d.volume / maxVol
                const barH = Math.max(Math.round(ratio * BAR_AREA_PX), 2)
                return (
                    <div key={d.date} className="flex-1 relative group" style={{ height: `${BAR_AREA_PX}px` }}>
                        <div
                            className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-primary/60 group-hover:bg-primary transition-colors"
                            style={{ height: `${barH}px` }}
                        />
                        <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10">
                            <div className="bg-card border border-border rounded px-2 py-1 text-xs font-mono whitespace-nowrap shadow-lg">
                                <div className="text-foreground">{formatUsd(d.volume, true)}</div>
                                <div className="text-muted-foreground">{d.date}</div>
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

export function PerformancePanel() {
    const walletAddress = useUserStore((s) => s.user?.wallet_address)
    const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>("week")
    const [portfolioRaw, setPortfolioRaw] = useState<any>(null)
    const [equity, setEquity] = useState<EquityData | null>(null)
    const [fees, setFees] = useState<FeeData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchData = useCallback(async () => {
        if (!walletAddress) {
            setError("Connect wallet to view performance")
            setLoading(false)
            return
        }
        setLoading(true)
        setError(null)
        try {
            const [portfolioRes, perpState, spotState, feesRes] = await Promise.all([
                hyperliquid.getPortfolio(walletAddress),
                hyperliquid.getClearinghouseState(walletAddress),
                hyperliquid.getSpotClearinghouseState(walletAddress),
                hyperliquid.getUserFees(walletAddress),
            ])

            setPortfolioRaw(portfolioRes)

            // Parse equity
            const perpEquity = parseFloat(perpState?.crossMarginSummary?.accountValue || perpState?.marginSummary?.accountValue || "0")
            const marginUsed = parseFloat(perpState?.crossMarginSummary?.totalMarginUsed || perpState?.marginSummary?.totalMarginUsed || "0")
            const totalNtlPos = parseFloat(perpState?.crossMarginSummary?.totalNtlPos || perpState?.marginSummary?.totalNtlPos || "0")
            const withdrawable = parseFloat(perpState?.withdrawable || "0")

            // Spot equity: sum all balances * their mid prices
            let spotEquity = 0
            if (spotState?.balances) {
                const mids = await hyperliquid.getMarketData()
                for (const bal of spotState.balances) {
                    const total = parseFloat(bal.total || "0")
                    if (bal.coin === "USDC" || bal.coin === "USDT") {
                        spotEquity += total
                    } else {
                        const mid = parseFloat(mids[bal.coin] || "0")
                        spotEquity += total * mid
                    }
                }
            }

            setEquity({
                perpEquity,
                spotEquity,
                totalEquity: perpEquity + spotEquity,
                withdrawable,
                marginUsed,
                totalNtlPos,
            })

            // Parse fees
            const perpTaker = `${(parseFloat(feesRes?.userCrossRate || "0") * 100).toFixed(4)}%`
            const perpMaker = `${(parseFloat(feesRes?.userAddRate || "0") * 100).toFixed(4)}%`
            const spotTaker = `${(parseFloat(feesRes?.userSpotCrossRate || "0") * 100).toFixed(4)}%`
            const spotMaker = `${(parseFloat(feesRes?.userSpotAddRate || "0") * 100).toFixed(4)}%`

            // 14-day volume
            const dailyVlm = feesRes?.dailyUserVlm || []
            const now = new Date()
            const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
            let volume14d = 0
            const dailyVolumes: { date: string; volume: number }[] = []
            for (const d of dailyVlm) {
                const dateObj = new Date(d.date)
                const vol = parseFloat(d.userCross || "0") + parseFloat(d.userAdd || "0")
                if (dateObj >= fourteenDaysAgo) {
                    volume14d += vol
                }
                dailyVolumes.push({ date: d.date, volume: vol })
            }

            setFees({ perpTaker, perpMaker, spotTaker, spotMaker, volume14d, dailyVolumes })
        } catch (e: any) {
            console.error("[PerformancePanel] Error fetching data:", e)
            setError("Failed to load performance data")
        } finally {
            setLoading(false)
        }
    }, [walletAddress])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Parse portfolio data for selected period
    const periodData = useMemo(() => {
        if (!portfolioRaw) return null
        const periodConfig = TIME_PERIODS.find((p) => p.key === selectedPeriod)
        if (!periodConfig) return null

        // portfolioRaw is an array of [label, data] tuples
        let totalData: PortfolioData | null = null
        let perpData: PortfolioData | null = null

        for (const entry of portfolioRaw) {
            if (entry[0] === periodConfig.key) totalData = entry[1]
            if (entry[0] === periodConfig.perpKey) perpData = entry[1]
        }

        if (!totalData) return null

        const pnlHistory = totalData.pnlHistory.map(([t, v]: [number, string]) => ({ t, v: parseFloat(v) }))
        const accountHistory = totalData.accountValueHistory.map(([t, v]: [number, string]) => ({ t, v: parseFloat(v) }))
        const volume = parseFloat(totalData.vlm || "0")
        const perpVolume = perpData ? parseFloat(perpData.vlm || "0") : 0

        // Compute PnL
        const pnl = pnlHistory.length > 0 ? pnlHistory[pnlHistory.length - 1].v : 0

        // Compute max drawdown from account value history
        let maxDrawdown = 0
        let peak = 0
        for (const point of accountHistory) {
            if (point.v > peak) peak = point.v
            if (peak > 0) {
                const dd = ((peak - point.v) / peak) * 100
                if (dd > maxDrawdown) maxDrawdown = dd
            }
        }

        return { pnlHistory, accountHistory, volume, perpVolume, pnl, maxDrawdown }
    }, [portfolioRaw, selectedPeriod])

    // Not connected
    if (!walletAddress) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-card">
                <Wallet className="h-16 w-16 mb-4 opacity-30" />
                <p className="text-sm text-muted-foreground">Connect wallet to view performance</p>
            </div>
        )
    }

    // Loading
    if (loading && !portfolioRaw) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-card">
                <Activity className="h-16 w-16 mb-4 opacity-30 animate-pulse" />
                <p className="text-sm text-muted-foreground">Loading performance data...</p>
            </div>
        )
    }

    // Error
    if (error && !portfolioRaw) {
        return (
            <div className="h-full w-full flex flex-col items-center justify-center bg-card">
                <AlertTriangle className="h-16 w-16 mb-4 opacity-30 text-destructive" />
                <p className="text-sm text-muted-foreground">{error}</p>
                <button
                    onClick={fetchData}
                    className="mt-4 px-4 py-2 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-sm font-medium transition-colors"
                >
                    Retry
                </button>
            </div>
        )
    }

    const pnlPositive = (periodData?.pnl ?? 0) >= 0

    return (
        <div className="h-full w-full flex flex-col bg-card overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                <div className="flex items-center gap-3">
                    <BarChart3 className="h-4 w-4 text-foreground" />
                    <h2 className="text-sm font-semibold text-foreground">Portfolio Performance</h2>
                </div>
                <div className="flex items-center gap-2">
                    {/* Time Period Selector */}
                    <div className="flex items-center rounded-lg border border-border bg-secondary/30 overflow-hidden">
                        {TIME_PERIODS.map((p) => (
                            <button
                                key={p.key}
                                onClick={() => setSelectedPeriod(p.key)}
                                className={cn(
                                    "px-3 py-1.5 text-xs font-semibold transition-colors",
                                    selectedPeriod === p.key
                                        ? "bg-primary/15 text-primary"
                                        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                                )}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={fetchData}
                        disabled={loading}
                        className="p-2 rounded-lg border border-border bg-secondary/50 hover:bg-secondary transition-colors disabled:opacity-50"
                        title="Refresh"
                    >
                        <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    </button>
                </div>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-5">
                    {/* PnL Summary + Chart */}
                    <div className="rounded-lg border border-border bg-secondary/20 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                            <div className="flex items-center gap-2">
                                {pnlPositive ? (
                                    <TrendingUp className="h-4 w-4 text-primary" />
                                ) : (
                                    <TrendingDown className="h-4 w-4 text-destructive" />
                                )}
                                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    PnL ({TIME_PERIODS.find((p) => p.key === selectedPeriod)?.label})
                                </span>
                            </div>
                            <div className="text-right">
                                <span className={cn("text-lg font-mono font-bold", pnlPositive ? "text-primary" : "text-destructive")}>
                                    {periodData ? formatUsd(periodData.pnl) : "$0.00"}
                                </span>
                            </div>
                        </div>
                        <div className="h-40 px-2 py-1">
                            {periodData?.pnlHistory && periodData.pnlHistory.length > 1 ? (
                                <MiniAreaChart data={periodData.pnlHistory} positive={pnlPositive} />
                            ) : (
                                <div className="h-full flex items-center justify-center">
                                    <span className="text-xs text-muted-foreground">No PnL data for this period</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Account Value Chart */}
                    <div className="rounded-lg border border-border bg-secondary/20 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Account Value</span>
                            <span className="text-sm font-mono font-semibold text-foreground">
                                {equity ? formatUsd(equity.totalEquity) : "..."}
                            </span>
                        </div>
                        <div className="h-32 px-2 py-1">
                            {periodData?.accountHistory && periodData.accountHistory.length > 1 ? (
                                <MiniAreaChart data={periodData.accountHistory} />
                            ) : (
                                <div className="h-full flex items-center justify-center">
                                    <span className="text-xs text-muted-foreground">No account value data for this period</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                        <StatCard
                            label="PnL"
                            value={periodData ? formatUsd(periodData.pnl) : "$0.00"}
                            icon={pnlPositive ? TrendingUp : TrendingDown}
                            valueClass={pnlPositive ? "text-primary" : "text-destructive"}
                        />
                        <StatCard
                            label="Volume"
                            value={periodData ? formatUsd(periodData.volume, true) : "$0.00"}
                            icon={BarChart3}
                        />
                        <StatCard
                            label="Max Drawdown"
                            value={periodData ? `${periodData.maxDrawdown.toFixed(2)}%` : "0.00%"}
                            icon={AlertTriangle}
                            valueClass={periodData && periodData.maxDrawdown > 10 ? "text-destructive" : "text-foreground"}
                        />
                        <StatCard
                            label="Total Equity"
                            value={equity ? formatUsd(equity.totalEquity) : "..."}
                            icon={Wallet}
                        />
                    </div>

                    {/* Equity Breakdown */}
                    <div className="rounded-lg border border-border bg-secondary/20 p-4">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Equity Breakdown</h3>
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Perps Account Equity</span>
                                <span className="text-sm font-mono font-semibold text-foreground">
                                    {equity ? formatUsd(equity.perpEquity) : "..."}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Spot Account Equity</span>
                                <span className="text-sm font-mono font-semibold text-foreground">
                                    {equity ? formatUsd(equity.spotEquity) : "..."}
                                </span>
                            </div>
                            <div className="w-full h-px bg-border/50 my-1" />
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Total Equity</span>
                                <span className="text-sm font-mono font-bold text-foreground">
                                    {equity ? formatUsd(equity.totalEquity) : "..."}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Margin Used</span>
                                <span className="text-sm font-mono text-foreground">
                                    {equity ? formatUsd(equity.marginUsed) : "..."}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Total Notional</span>
                                <span className="text-sm font-mono text-foreground">
                                    {equity ? formatUsd(equity.totalNtlPos) : "..."}
                                </span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm text-muted-foreground">Withdrawable</span>
                                <span className="text-sm font-mono text-foreground">
                                    {equity ? formatUsd(equity.withdrawable) : "..."}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Fees & Volume */}
                    <div className="rounded-lg border border-border bg-secondary/20 p-4">
                        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Fees & Volume</h3>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-muted-foreground">Perps Fees (Taker / Maker)</span>
                                    <span className="text-sm font-mono font-semibold text-foreground">
                                        {fees ? `${fees.perpTaker} / ${fees.perpMaker}` : "..."}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs text-muted-foreground">Spot Fees (Taker / Maker)</span>
                                    <span className="text-sm font-mono font-semibold text-foreground">
                                        {fees ? `${fees.spotTaker} / ${fees.spotMaker}` : "..."}
                                    </span>
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-1">
                                <span className="text-sm text-muted-foreground">14-Day Volume</span>
                                <span className="text-sm font-mono font-bold text-foreground">
                                    {fees ? formatUsd(fees.volume14d, true) : "..."}
                                </span>
                            </div>

                            {/* Volume Bar Chart */}
                            {fees && fees.dailyVolumes.length > 0 && (
                                <div className="pt-2">
                                    <span className="text-xs text-muted-foreground font-medium mb-2 block">Daily Volume (last 14 days)</span>
                                    <VolumeBarChart dailyVolumes={fees.dailyVolumes} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
