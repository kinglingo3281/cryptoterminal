"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { User, Copy, Key, Plus, Eye, EyeOff, Trash2, Check, Bot, Shield, Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { AddAPIKeyModal } from "@/components/auth/AddAPIKeyModal"
import { CreateAgentModal } from "@/components/modals/CreateAgentModal"
import { Modal } from "@/components/ui/Modal"
import { usePositionsStore } from "@/store/usePositionsStore"
import { useUserStore } from "@/store/useUserStore"
import { useTradeHistory } from "@/hooks/useTradeHistory"
import { useWalletConnection } from "@/hooks/useWalletConnection"
import { BuilderFeeService } from "@/services/BuilderFeeService"
// import { BotApiSettings } from "@/components/settings/BotApiSettings"

function ProfilePageInner() {
    const { isAuthenticated, user, apiKeys, login, deleteAPIKey, isLoading } = useAuth()
    const searchParams = useSearchParams()
    const [activeTab, setActiveTab] = useState("overview")
    const accountSummary = usePositionsStore(state => state.accountSummary)
    const walletAddress = user?.wallet_address || null
    const { fills, stats: tradeStats, isLoading: historyLoading, refresh: refreshHistory } = useTradeHistory(walletAddress)

    // Fetch trade history when wallet address becomes available (e.g. after adding API key)
    useEffect(() => {
        if (walletAddress && fills.length === 0 && !historyLoading) {
            refreshHistory()
        }
    }, [walletAddress, fills.length, historyLoading, refreshHistory])

    // Calculate win rate from closing trades
    const winRate = (() => {
        const closingTrades = fills.filter(f => f.closedPnl !== 0)
        if (closingTrades.length === 0) return 0
        const wins = closingTrades.filter(f => f.closedPnl > 0).length
        return Math.round((wins / closingTrades.length) * 100)
    })()

    const formatUsd = (val: number) => {
        const prefix = val >= 0 ? '$' : '-$'
        return `${prefix}${Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }

    const formatTime = (ts: number) => {
        return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    }
    
    // Handle URL parameters for direct tab access
    useEffect(() => {
        const tab = searchParams.get('tab')
        if (tab && ['overview', 'api-keys' /* , 'bot-api' */].includes(tab)) {
            setActiveTab(tab)
        }
    }, [searchParams])
    const [showAddKeyModal, setShowAddKeyModal] = useState(false)
    const [showCreateAgentModal, setShowCreateAgentModal] = useState(false)
    const [showSecrets, setShowSecrets] = useState<{ [key: string]: boolean }>({})
    const [copiedKey, setCopiedKey] = useState<string | null>(null)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [providerToDelete, setProviderToDelete] = useState<string | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const [deleteError, setDeleteError] = useState<string | null>(null)
    const [isApprovingFee, setIsApprovingFee] = useState(false)
    const [feeStatus, setFeeStatus] = useState<string | null>(null)
    const { walletClient, isConnected, connectWallet, checkChainId, switchToArbitrum } = useWalletConnection()

    const handleApproveBuilderFee = async () => {
        if (isApprovingFee) return
        setFeeStatus(null)

        if (!isConnected || !walletClient) {
            const connected = await connectWallet()
            if (!connected) { setFeeStatus('Failed to connect wallet'); return }
            await new Promise(resolve => setTimeout(resolve, 500))
        }

        const isCorrectChain = await checkChainId()
        if (!isCorrectChain) {
            const switched = await switchToArbitrum()
            if (!switched) { setFeeStatus('Please switch to Arbitrum network'); return }
        }

        if (!walletClient) { setFeeStatus('Wallet not ready'); return }

        setIsApprovingFee(true)
        try {
            const result = await BuilderFeeService.approveBuilderFee(walletClient)
            if (result.success) {
                setFeeStatus('Builder fee approved!')
            } else {
                setFeeStatus(result.error || 'Approval failed')
            }
        } catch (err: any) {
            setFeeStatus(err.message || 'Approval failed')
        } finally {
            setIsApprovingFee(false)
        }
    }

    const copyToClipboard = (text: string, key: string) => {
        navigator.clipboard.writeText(text)
        setCopiedKey(key)
        setTimeout(() => setCopiedKey(null), 2000)
    }

    const formatAddress = (address: string | null) => {
        if (!address) return "Not connected"
        return `${address.slice(0, 6)}...${address.slice(-4)}`
    }

    const handleDeleteClick = (provider: string) => {
        setProviderToDelete(provider)
        setDeleteModalOpen(true)
        setDeleteError(null)
    }

    const handleConfirmDelete = async () => {
        if (!providerToDelete) return
        
        setIsDeleting(true)
        setDeleteError(null)
        
        try {
            await deleteAPIKey(providerToDelete)
            
            // Immediately remove from UI store (in case refresh fails due to 429)
            useUserStore.getState().removeAPIKey(providerToDelete)
            
            // Clear all trading state from memory (positions, orders, account data)
            usePositionsStore.getState().reset()
            
            setDeleteModalOpen(false)
            setProviderToDelete(null)
        } catch (error) {
            console.error('Delete failed:', error)
            setDeleteError(error instanceof Error ? error.message : 'Failed to delete API key')
        } finally {
            setIsDeleting(false)
        }
    }

    const handleCancelDelete = () => {
        setDeleteModalOpen(false)
        setProviderToDelete(null)
        setDeleteError(null)
    }

    if (!isAuthenticated || !user) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-4">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                        <User className="h-8 w-8 text-primary" />
                    </div>
                    <h2 className="text-xl font-bold">Login Required</h2>
                    <p className="text-muted-foreground text-sm">Please login to view your profile</p>
                    <button
                        onClick={login}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                    >
                        Login
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* Sidebar */}
            <div className="w-64 border-r border-border bg-card shrink-0 p-4">
                <nav className="space-y-1">
                    {[
                        { icon: User, label: "Overview", value: "overview" },
                        { icon: Key, label: "API Keys", value: "api-keys" },
                        // { icon: Bot, label: "Bot API", value: "bot-api" },
                    ].map(item => (
                        <button
                            key={item.value}
                            onClick={() => setActiveTab(item.value)}
                            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeTab === item.value
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                                }`}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-6 overflow-auto">
                {activeTab === "overview" && (
                    <>
                        {/* Profile Header */}
                        <div className="mb-8">
                            <div className="flex items-center gap-4 mb-4">
                                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-primary/20 to-primary/50 flex items-center justify-center">
                                    <User className="h-8 w-8 text-primary" />
                                </div>
                                <div>
                                    <h1 className="text-2xl font-bold">
                                        {user.email || "Your Profile"}
                                    </h1>
                                    {user.wallet_address && (
                                        <div className="flex items-center gap-2 text-muted-foreground text-sm">
                                            <span className="font-mono">{formatAddress(user.wallet_address)}</span>
                                            <button
                                                onClick={() => copyToClipboard(user.wallet_address!, "wallet")}
                                                className="hover:text-foreground transition-colors"
                                            >
                                                {copiedKey === "wallet" ? (
                                                    <Check className="h-3.5 w-3.5 text-primary" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5" />
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Stats Grid */}
                        <div className="grid grid-cols-4 gap-4 mb-8">
                            {[
                                { label: "Account Equity", value: formatUsd(accountSummary?.accountValue || 0), color: '' },
                                { label: "Open PNL", value: formatUsd(accountSummary?.totalUnrealizedPnl || 0), color: (accountSummary?.totalUnrealizedPnl || 0) >= 0 ? 'text-trade-green' : 'text-trade-red' },
                                { label: "Realized PNL", value: formatUsd(tradeStats?.realizedPnl || 0), color: (tradeStats?.realizedPnl || 0) >= 0 ? 'text-trade-green' : 'text-trade-red' },
                                { label: "Win Rate", value: `${winRate}%`, color: winRate >= 50 ? 'text-trade-green' : winRate > 0 ? 'text-trade-red' : '' },
                            ].map(stat => (
                                <div key={stat.label} className="bg-card border border-border rounded-lg p-4">
                                    <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                                    <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                                </div>
                            ))}
                        </div>

                        {/* API Keys Quick View */}
                        <div className="bg-card border border-border rounded-lg p-6 mb-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold">Connected Exchanges</h2>
                                <button
                                    onClick={() => setActiveTab("api-keys")}
                                    className="text-sm text-primary hover:underline"
                                >
                                    View All
                                </button>
                            </div>
                            {apiKeys && Object.keys(apiKeys).length > 0 ? (
                                <div className="space-y-2">
                                    {Object.keys(apiKeys).slice(0, 3).map(provider => (
                                        <div key={provider} className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                                            <div className="flex items-center gap-3">
                                                <Key className="h-4 w-4 text-primary" />
                                                <span className="font-medium capitalize">{provider}</span>
                                            </div>
                                            <span className="text-xs text-primary">Connected</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    <Key className="h-12 w-12 mx-auto mb-4 opacity-30" />
                                    <p className="text-sm">No API keys configured</p>
                                </div>
                            )}
                        </div>

                        {/* Recent Activity */}
                        <div className="bg-card border border-border rounded-lg p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-lg font-bold">Recent Activity</h2>
                                {walletAddress && (
                                    <button
                                        onClick={refreshHistory}
                                        disabled={historyLoading}
                                        className="text-xs text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                                    >
                                        {historyLoading ? "Loading..." : "Refresh"}
                                    </button>
                                )}
                            </div>
                            {historyLoading && fills.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                    <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
                                    <p className="text-sm">Loading trade history...</p>
                                </div>
                            ) : fills.length > 0 ? (
                                <div className="space-y-2">
                                    {fills.slice(0, 8).map(fill => (
                                        <div key={fill.tid} className="flex items-center justify-between p-3 bg-secondary rounded-lg text-sm">
                                            <div className="flex items-center gap-3">
                                                <span className={`font-bold text-xs px-1.5 py-0.5 rounded ${fill.side === 'BUY' ? 'bg-trade-green/10 text-trade-green' : 'bg-trade-red/10 text-trade-red'}`}>
                                                    {fill.side}
                                                </span>
                                                <span className="font-medium">{fill.coin}</span>
                                                <span className="text-muted-foreground text-xs">{fill.direction}</span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-xs text-muted-foreground">{fill.size} @ ${fill.price.toLocaleString()}</span>
                                                {fill.closedPnl !== 0 && (
                                                    <span className={`text-xs font-medium ${fill.closedPnl > 0 ? 'text-trade-green' : 'text-trade-red'}`}>
                                                        {formatUsd(fill.closedPnl)}
                                                    </span>
                                                )}
                                                <span className="text-xs text-muted-foreground">{formatTime(fill.time)}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                    <User className="h-12 w-12 mb-4 opacity-30" />
                                    <p className="text-sm">{walletAddress ? "No trades yet" : "Add an API key to view trade history"}</p>
                                </div>
                            )}
                        </div>
                    </>
                )}

                {activeTab === "api-keys" && (
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h1 className="text-2xl font-bold mb-2">API Keys</h1>
                                <p className="text-sm text-muted-foreground">
                                    Manage your exchange API keys securely
                                </p>
                            </div>
                            <button
                                onClick={() => setShowAddKeyModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
                            >
                                <Plus className="h-4 w-4" />
                                Add API Key
                            </button>
                        </div>

                        {apiKeys && Object.keys(apiKeys).length > 0 ? (
                            <div className="space-y-4">
                                {Object.entries(apiKeys).map(([provider, credentials]: [string, any]) => (
                                    <div key={provider} className="bg-card border border-border rounded-lg p-6">
                                        <div className="flex items-start justify-between mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                                                    <Key className="h-5 w-5 text-primary" />
                                                </div>
                                                <div>
                                                    <h3 className="font-semibold capitalize">{provider}</h3>
                                                    <p className="text-xs text-muted-foreground">Connected & Active</p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteClick(provider)}
                                                disabled={isLoading}
                                                className="p-2 hover:bg-destructive/10 rounded-lg text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                                                title="Remove API Key"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>

                                        <div className="space-y-3">
                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">
                                                    {provider === 'hyperliquid' ? 'Private Key' : 'API Key'}
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <code className="flex-1 px-3 py-2 bg-secondary rounded-md text-sm font-mono">
                                                        {"•".repeat(32)}
                                                    </code>
                                                    <button
                                                        onClick={() => copyToClipboard(credentials.apiKey, `${provider}-key`)}
                                                        className="p-2 hover:bg-secondary rounded-lg transition-colors"
                                                    >
                                                        {copiedKey === `${provider}-key` ? (
                                                            <Check className="h-4 w-4 text-primary" />
                                                        ) : (
                                                            <Copy className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-xs text-muted-foreground block mb-1">
                                                    {provider === 'hyperliquid' ? 'Public Key (Wallet Address)' : 'API Secret'}
                                                </label>
                                                <div className="flex items-center gap-2">
                                                    <code className="flex-1 px-3 py-2 bg-secondary rounded-md text-sm font-mono">
                                                        {showSecrets[`${provider}-secret`]
                                                            ? (credentials.apiSecret || '(not set)')
                                                            : (credentials.apiSecret ? `${credentials.apiSecret.slice(0, 16)}${"•".repeat(20)}` : '•'.repeat(32))
                                                        }
                                                    </code>
                                                    <button
                                                        onClick={() => setShowSecrets(prev => ({
                                                            ...prev,
                                                            [`${provider}-secret`]: !prev[`${provider}-secret`]
                                                        }))}
                                                        className="p-2 hover:bg-secondary rounded-lg transition-colors"
                                                    >
                                                        {showSecrets[`${provider}-secret`] ? (
                                                            <EyeOff className="h-4 w-4" />
                                                        ) : (
                                                            <Eye className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                    <button
                                                        onClick={() => copyToClipboard(credentials.apiSecret, `${provider}-secret`)}
                                                        className="p-2 hover:bg-secondary rounded-lg transition-colors"
                                                    >
                                                        {copiedKey === `${provider}-secret` ? (
                                                            <Check className="h-4 w-4 text-primary" />
                                                        ) : (
                                                            <Copy className="h-4 w-4" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="bg-card border border-border rounded-lg p-12">
                                <div className="flex flex-col items-center justify-center text-center">
                                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                                        <Key className="h-8 w-8 text-primary" />
                                    </div>
                                    <h3 className="text-lg font-semibold mb-2">No API Keys Yet</h3>
                                    <p className="text-sm text-muted-foreground mb-6 max-w-md">
                                        Connect your exchange accounts to start trading. Your keys are encrypted and stored securely.
                                    </p>
                                    <button
                                        onClick={() => setShowAddKeyModal(true)}
                                        className="flex items-center gap-2 px-6 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Add Your First API Key
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Trading Setup - Backup Actions */}
                        <div className="bg-card border border-border rounded-lg p-6 mt-6">
                            <h3 className="text-sm font-semibold mb-1">Trading Setup</h3>
                            <p className="text-xs text-muted-foreground mb-4">
                                Generate a new trading agent or re-approve the builder fee manually.
                            </p>
                            <div className="flex flex-wrap gap-3">
                                <button
                                    onClick={() => setShowCreateAgentModal(true)}
                                    className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium transition-colors"
                                >
                                    <Key className="h-4 w-4" />
                                    Create API Key
                                </button>
                                <button
                                    onClick={handleApproveBuilderFee}
                                    disabled={isApprovingFee}
                                    className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                                >
                                    {isApprovingFee ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Shield className="h-4 w-4" />
                                    )}
                                    {isApprovingFee ? 'Approving...' : 'Approve Builder Fee'}
                                </button>
                            </div>
                            {feeStatus && (
                                <p className={`text-xs mt-3 ${feeStatus.includes('approved') ? 'text-primary' : 'text-destructive'}`}>
                                    {feeStatus}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                {/* Bot API tab - commented out, replaced by external solution
                {activeTab === "bot-api" && (
                    <div>
                        <div className="mb-6">
                            <h1 className="text-2xl font-bold mb-2">Bot API</h1>
                            <p className="text-sm text-muted-foreground">
                                Connect external trading bots like Moltbot or Clawdbot to your account
                            </p>
                        </div>
                        <BotApiSettings />
                    </div>
                )}
                */}

            </div>

            <AddAPIKeyModal
                isOpen={showAddKeyModal}
                onClose={() => setShowAddKeyModal(false)}
            />
            <CreateAgentModal
                isOpen={showCreateAgentModal}
                onClose={() => setShowCreateAgentModal(false)}
            />

            <Modal
                isOpen={deleteModalOpen}
                onClose={handleCancelDelete}
                title="Delete API Key"
                className="max-w-md"
            >
                <div className="space-y-4">
                    <div className="space-y-2">
                        <p className="text-sm text-foreground">
                            Are you sure you want to delete your{' '}
                            <span className="font-semibold text-primary capitalize">
                                {providerToDelete}
                            </span>{' '}
                            API key?
                        </p>
                        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                            <p className="text-xs text-destructive font-medium">
                                ⚠️ This action cannot be undone
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                                Your encrypted credentials will be permanently deleted from the database.
                            </p>
                        </div>
                    </div>
                    
                    {deleteError && (
                        <div className="p-3 bg-destructive/20 border border-destructive rounded-lg">
                            <p className="text-xs text-destructive">{deleteError}</p>
                        </div>
                    )}
                    
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={handleCancelDelete}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirmDelete}
                            disabled={isDeleting}
                            className="flex-1 px-4 py-2 bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                        >
                            {isDeleting ? 'Deleting...' : 'Delete Key'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    )
}

export default function ProfilePage() {
    return (
        <Suspense>
            <ProfilePageInner />
        </Suspense>
    )
}
