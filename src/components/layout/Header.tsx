"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Search, Wallet, ArrowDownToLine, ArrowRightLeft, LayoutDashboard, Zap, XCircle, Target, TrendingUp, ChevronDown, ArrowUpDown } from "lucide-react"
import { useState } from "react"
import { usePrivy } from '@privy-io/react-auth'
import { AssetSearchModal } from "@/components/trading/AssetSearchModal"
import { LoginButton } from "@/components/auth/LoginButton"
import { cn } from "@/lib/utils"
import { useWalletConnection } from "@/hooks/useWalletConnection"
import { DepositService } from "@/services/DepositService"
import { DepositModal } from "@/components/modals/DepositModal"
import { WithdrawModal } from "@/components/modals/WithdrawModal"
import { WithdrawService } from "@/services/WithdrawService"
import { TransferService } from "@/services/TransferService"
import { TransferModal } from "@/components/modals/TransferModal"
import { TradingSetupWizard } from "@/components/modals/TradingSetupWizard"

export function Header() {
    const [isAssetModalOpen, setAssetModalOpen] = useState(false)
    const [isDepositModalOpen, setDepositModalOpen] = useState(false)
    const [isWithdrawModalOpen, setWithdrawModalOpen] = useState(false)
    const [isTransferModalOpen, setTransferModalOpen] = useState(false)
    const [isDepositing, setIsDepositing] = useState(false)
    const [isWithdrawing, setIsWithdrawing] = useState(false)
    const [isTransferring, setIsTransferring] = useState(false)
    const pathname = usePathname()
    const { walletClient, isConnected, connectWallet, checkChainId, switchToArbitrum } = useWalletConnection()
    const { authenticated, login: privyLogin } = usePrivy()

    const handleDeposit = async (amount: number) => {
        if (!walletClient) {
            throw new Error('Wallet not connected')
        }

        // Ensure on Arbitrum
        const isCorrectChain = await checkChainId()
        if (!isCorrectChain) {
            const switched = await switchToArbitrum()
            if (!switched) {
                throw new Error('Please switch to Arbitrum network')
            }
        }

        setIsDepositing(true)
        try {
            const result = await DepositService.depositToHyperliquid(walletClient, amount)
            
            if (!result.success) {
                throw new Error(result.error || 'Deposit failed')
            }
            
            console.log('[Header] Deposit successful:', result.depositTxHash)
        } finally {
            setIsDepositing(false)
        }
    }

    const handleWithdraw = async (amount: number) => {
        if (!walletClient) {
            throw new Error('Wallet not connected')
        }

        // Ensure on Arbitrum for signing
        const isCorrectChain = await checkChainId()
        if (!isCorrectChain) {
            const switched = await switchToArbitrum()
            if (!switched) {
                throw new Error('Please switch to Arbitrum network')
            }
        }

        setIsWithdrawing(true)
        try {
            const result = await WithdrawService.withdrawFromHyperliquid(walletClient, amount)
            
            if (!result.success) {
                throw new Error(result.error || 'Withdrawal failed')
            }
            
            console.log('[Header] Withdrawal successful')
        } finally {
            setIsWithdrawing(false)
        }
    }

    const handleTransfer = async (amount: number, toPerp: boolean) => {
        if (!walletClient) {
            throw new Error('Wallet not connected')
        }

        const isCorrectChain = await checkChainId()
        if (!isCorrectChain) {
            const switched = await switchToArbitrum()
            if (!switched) {
                throw new Error('Please switch to Arbitrum network')
            }
        }

        setIsTransferring(true)
        try {
            const result = await TransferService.transfer(walletClient, amount, toPerp)
            
            if (!result.success) {
                throw new Error(result.error || 'Transfer failed')
            }
            
            console.log('[Header] Transfer successful')
        } finally {
            setIsTransferring(false)
        }
    }

    return (
        <>
            <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-border bg-background px-4">
                <div className="flex items-center gap-8">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="relative h-8 w-20">
                            <img src="/globe.svg" alt="Logo" className="absolute top-1/2 -translate-y-1/2 left-0 h-20 w-auto max-w-none" />
                        </div>
                    </Link>

                    <nav className="flex items-center gap-6 text-xs font-medium">
                        <Link
                            href="/"
                            className={cn(
                                "transition-colors",
                                pathname === "/"
                                    ? "text-trade-green"
                                    : "text-muted-foreground hover:text-primary"
                            )}
                        >
                            TRADE
                        </Link>
                        <Link
                            href="/explore"
                            className={cn(
                                "transition-colors",
                                pathname === "/explore"
                                    ? "text-trade-green"
                                    : "text-muted-foreground hover:text-primary"
                            )}
                        >
                            EXPLORE
                        </Link>
                        <Link
                            href="/profile"
                            className={cn(
                                "transition-colors",
                                pathname === "/profile"
                                    ? "text-trade-green"
                                    : "text-muted-foreground hover:text-primary"
                            )}
                        >
                            PROFILE
                        </Link>
                        {/* AUTOMATION with Dropdown */}
                        <div className="relative group">
                            <Link
                                href="/automation"
                                className={cn(
                                    "flex items-center gap-1 transition-colors",
                                    pathname?.startsWith("/automation")
                                        ? "text-trade-green"
                                        : "text-muted-foreground hover:text-primary"
                                )}
                            >
                                AUTOMATION
                                <ChevronDown className="w-3 h-3 transition-transform group-hover:rotate-180" />
                            </Link>
                            {/* Dropdown Menu */}
                            <div className="absolute top-full left-0 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                                <div className="bg-card border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                                    <Link
                                        href="/automation?tab=dashboard"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <LayoutDashboard className="w-3.5 h-3.5" />
                                        Dashboard
                                    </Link>
                                    <Link
                                        href="/automation?tab=autotrade"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <Zap className="w-3.5 h-3.5" />
                                        Auto Trade
                                    </Link>
                                    <Link
                                        href="/automation?tab=cancel"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <XCircle className="w-3.5 h-3.5" />
                                        Cancel Bot
                                    </Link>
                                    <Link
                                        href="/automation?tab=sltp"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <Target className="w-3.5 h-3.5" />
                                        SL/TP Bot
                                    </Link>
                                    <Link
                                        href="/automation?tab=trailing"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <ArrowUpDown className="w-3.5 h-3.5" />
                                        Trailing SL
                                    </Link>
                                    <Link
                                        href="/automation?tab=mm"
                                        className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted transition-colors"
                                    >
                                        <TrendingUp className="w-3.5 h-3.5" />
                                        MM Bot
                                    </Link>
                                </div>
                            </div>
                        </div>
                        <Link
                            href="/alpha"
                            className={cn(
                                "transition-colors",
                                pathname === "/alpha"
                                    ? "text-trade-green"
                                    : "text-muted-foreground hover:text-primary"
                            )}
                        >
                            ALPHA
                        </Link>
                    </nav>
                </div>

                <div className="flex items-center gap-4">
                    <div
                        className="relative cursor-pointer"
                        onClick={() => setAssetModalOpen(true)}
                    >
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <div
                            className="h-9 w-64 rounded-md border border-input bg-secondary pl-9 pr-8 text-sm text-muted-foreground flex items-center"
                        >
                            Search
                        </div>
                        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-50">
                            <kbd className="hidden rounded bg-muted px-1.5 font-mono text-[10px] font-medium sm:inline-block">
                                ⌘K
                            </kbd>
                        </div>
                    </div>

                    <button 
                        onClick={async () => {
                            if (!authenticated) { privyLogin(); return }
                            if (!isConnected || !walletClient) {
                                const connected = await connectWallet()
                                if (!connected) return
                                await new Promise(resolve => setTimeout(resolve, 500))
                            }
                            setDepositModalOpen(true)
                        }}
                        className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
                    >
                        <Wallet className="h-4 w-4" />
                        Deposit
                    </button>

                    <button 
                        onClick={async () => {
                            if (!authenticated) { privyLogin(); return }
                            if (!isConnected || !walletClient) {
                                const connected = await connectWallet()
                                if (!connected) return
                                await new Promise(resolve => setTimeout(resolve, 500))
                            }
                            setTransferModalOpen(true)
                        }}
                        className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
                    >
                        <ArrowRightLeft className="h-4 w-4" />
                        Transfer
                    </button>

                    <button 
                        onClick={async () => {
                            if (!authenticated) { privyLogin(); return }
                            if (!isConnected || !walletClient) {
                                const connected = await connectWallet()
                                if (!connected) return
                                await new Promise(resolve => setTimeout(resolve, 500))
                            }
                            setWithdrawModalOpen(true)
                        }}
                        className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium hover:bg-secondary/80"
                    >
                        <ArrowDownToLine className="h-4 w-4" />
                        Withdraw
                    </button>

                    <LoginButton />
                </div>
            </header>

            <AssetSearchModal isOpen={isAssetModalOpen} onClose={() => setAssetModalOpen(false)} />
            <DepositModal 
                isOpen={isDepositModalOpen} 
                onClose={() => setDepositModalOpen(false)}
                onDeposit={handleDeposit}
                isProcessing={isDepositing}
                walletClient={walletClient}
            />
            <WithdrawModal
                isOpen={isWithdrawModalOpen}
                onClose={() => setWithdrawModalOpen(false)}
                onWithdraw={handleWithdraw}
                isProcessing={isWithdrawing}
            />
            <TransferModal
                isOpen={isTransferModalOpen}
                onClose={() => setTransferModalOpen(false)}
                onTransfer={handleTransfer}
                isProcessing={isTransferring}
            />
            <TradingSetupWizard />
        </>
    )
}
