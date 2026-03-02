'use client'

import { useEffect, useRef, ReactNode } from 'react'
import { useAutomationStore } from '@/store/useAutomationStore'
import { usePositionsStore } from '@/store/usePositionsStore'
import { useSpotPricesStore } from '@/store/useSpotPricesStore'
import { useUserStore } from '@/store/useUserStore'
import { CancelBotService } from '@/services/CancelBotService'
import { TrailingSLBotService } from '@/services/TrailingSLBotService'
import { SLTPBotService } from '@/services/SLTPBotService'
import { MMBotService } from '@/services/MMBotService'
import { AutoTradeBotService } from '@/services/AutoTradeBotService'
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'

const LOG_BOT_PROVIDER = false

const log = (...args: unknown[]) => {
    if (LOG_BOT_PROVIDER) {
        console.log(...args)
    }
}

const logError = (...args: unknown[]) => {
    if (LOG_BOT_PROVIDER) {
        console.error(...args)
    }
}

interface BotProviderProps {
    children: ReactNode
}

const isHexValue = (value: string | null | undefined, length: number) =>
    typeof value === 'string' && new RegExp(`^(0x)?[0-9a-fA-F]{${length}}$`).test(value)

const normalizeHex = (value: string) => (value.startsWith('0x') ? value : `0x${value}`)

const parsePrivateKey = (value: string | null | undefined) =>
    isHexValue(value, 64) ? normalizeHex(value as string) : null

const parseAddress = (value: string | null | undefined) =>
    isHexValue(value, 40) ? normalizeHex(value as string) : null

const resolvePrivateKey = (credentials?: { apiKey?: string; apiSecret?: string }) =>
    parsePrivateKey(credentials?.apiKey) ?? parsePrivateKey(credentials?.apiSecret)

const resolvePublicAddress = (
    userWalletAddress: string | null | undefined,
    credentials?: { apiKey?: string; apiSecret?: string; publicAddress?: string }
) =>
    parseAddress(userWalletAddress) ??
    parseAddress(credentials?.apiSecret) ??
    parseAddress(credentials?.apiKey) ??
    parseAddress(credentials?.publicAddress)

export function BotProvider({ children }: BotProviderProps) {
    const initialized = useRef(false)
    const lastInitRef = useRef<{ privateKey: string | null; publicAddress: string | null } | null>(null)
    const exchClientRef = useRef<hl.ExchangeClient | null>(null)
    
    const {
        // Auto Trade
        autoTradeEnabled,
        // Cancel Bot
        cancelBotEnabled,
        cancelTimeout,
        cancelLimitOnly,
        // SL/TP Bot
        sltpBotEnabled,
        autoSlEnabled,
        autoTpEnabled,
        defaultSlPercent,
        defaultTpPercent,
        // Trailing SL Bot
        trailingSLEnabled,
        trailingProfitTrigger,
        trailingMode,
        // MM Bot
        mmBotEnabled,
        mmPricingMode,
        mmPairSettings,
        addLog
    } = useAutomationStore()

    // Get API key from user store (same source as QuickTrade)
    const { apiKeys, user } = useUserStore()
    const hyperliquidKeys = apiKeys?.hyperliquid as
        | { apiKey?: string; apiSecret?: string; publicAddress?: string }
        | undefined
    const privateKey = resolvePrivateKey(hyperliquidKeys)
    const publicAddress = resolvePublicAddress(user?.wallet_address, hyperliquidKeys)

    // Initialize bot services when private key is available
    useEffect(() => {
        if (
            initialized.current &&
            lastInitRef.current?.privateKey === (privateKey ?? null) &&
            lastInitRef.current?.publicAddress === (publicAddress ?? null)
        ) {
            return
        }

        let retryCount = 0
        const maxRetries = 30 // Retry for ~30 seconds
        let retryInterval: NodeJS.Timeout | null = null

        const initializeBots = async (): Promise<boolean> => {
            // Get private key from user store (same as QuickTrade uses)
            const { apiKeys: latestKeys, user: latestUser } = useUserStore.getState()
            const latestHyperliquidKeys = latestKeys?.hyperliquid as
                | { apiKey?: string; apiSecret?: string; publicAddress?: string }
                | undefined
            const resolvedPrivateKey = resolvePrivateKey(latestHyperliquidKeys)
            const resolvedPublicAddress = resolvePublicAddress(latestUser?.wallet_address, latestHyperliquidKeys)

            if (!resolvedPrivateKey) {
                return false // Signal to retry
            }

            try {
                const transport = new hl.HttpTransport({ isTestnet: false })
                const wallet = new ethers.Wallet(resolvedPrivateKey)
                const userAddress = resolvedPublicAddress || wallet.address
                const exchClient = new hl.ExchangeClient({ wallet, transport })
                exchClientRef.current = exchClient

                const createLogCallback = (bot: 'system' | 'cancel' | 'sltp' | 'trailing' | 'mm' | 'autotrade') => 
                    (message: string, type: 'info' | 'success' | 'error') => {
                        useAutomationStore.getState().addLog({ type, bot, message })
                    }

                CancelBotService.setLogCallback(createLogCallback('cancel'))
                CancelBotService.initialize(exchClient, userAddress)

                TrailingSLBotService.setLogCallback(createLogCallback('trailing'))
                TrailingSLBotService.initialize(exchClient, userAddress)

                SLTPBotService.setLogCallback(createLogCallback('sltp'))
                SLTPBotService.initialize(exchClient, userAddress)

                MMBotService.setLogCallback(createLogCallback('mm'))
                await MMBotService.initialize(exchClient, userAddress)

                AutoTradeBotService.setLogCallback(createLogCallback('autotrade'))
                AutoTradeBotService.initialize(exchClient, userAddress)

                initialized.current = true
                lastInitRef.current = {
                    privateKey: resolvedPrivateKey,
                    publicAddress: resolvedPublicAddress || null
                }
                log('[BotProvider] Bot services initialized for', userAddress.slice(0, 10) + '...')
                
                // Log initialization to activity log
                useAutomationStore.getState().addLog({
                    type: 'success',
                    bot: 'system',
                    message: `Bot services initialized for ${userAddress.slice(0, 8)}...`
                })
                
                // Re-sync current store state to services
                syncBotStates()
                return true // Success
            } catch (error) {
                logError('[BotProvider] Failed to initialize:', error)
                useAutomationStore.getState().addLog({
                    type: 'error',
                    bot: 'system',
                    message: `Init failed: ${(error as Error).message}`
                })
                return false
            }
        }

        // Start initialization with retry
        const startWithRetry = async () => {
            const success = await initializeBots()
            if (success) {
                if (retryInterval) clearInterval(retryInterval)
                return
            }
            
            // Log waiting message on first attempt
            if (retryCount === 0) {
                useAutomationStore.getState().addLog({
                    type: 'info',
                    bot: 'system',
                    message: 'Waiting for wallet/agent key... (will retry every 1s)'
                })
            }
            
            // Set up retry interval
            retryInterval = setInterval(async () => {
                retryCount++
                const success = await initializeBots()
                if (success || retryCount >= maxRetries) {
                    if (retryInterval) clearInterval(retryInterval)
                    if (!success && retryCount >= maxRetries) {
                        useAutomationStore.getState().addLog({
                            type: 'error',
                            bot: 'system',
                            message: 'Gave up waiting for private key. Please connect wallet and refresh.'
                        })
                    }
                }
            }, 1000)
        }

        const syncBotStates = () => {
            const state = useAutomationStore.getState()
            const addLog = useAutomationStore.getState().addLog
            
            // Cancel Bot
            if (state.cancelBotEnabled) {
                CancelBotService.enable()
                addLog({ type: 'info', bot: 'cancel', message: `Cancel Bot synced: ${state.cancelTimeout}min timeout` })
            }
            CancelBotService.updateSettings({
                cancelTimeoutMinutes: state.cancelTimeout,
                limitOnly: state.cancelLimitOnly
            })

            // SL/TP Bot
            if (state.sltpBotEnabled) {
                SLTPBotService.enable()
                addLog({ type: 'info', bot: 'sltp', message: `SL/TP Bot synced: SL=${state.defaultSlPercent}%, TP=${state.defaultTpPercent}%` })
            }
            SLTPBotService.updateSettings({
                autoSlEnabled: state.autoSlEnabled,
                autoTpEnabled: state.autoTpEnabled,
                defaultSlPct: state.defaultSlPercent,
                defaultTpPct: state.defaultTpPercent
            })

            // Trailing SL Bot
            if (state.trailingSLEnabled) {
                TrailingSLBotService.enable()
                addLog({ type: 'info', bot: 'trailing', message: `Trailing SL Bot synced: ${state.trailingProfitTrigger}% trigger, ${state.trailingMode} mode` })
            }
            TrailingSLBotService.updateSettings({
                profitTriggerPct: state.trailingProfitTrigger,
                trailingMode: state.trailingMode
            })

            // MM Bot
            if (state.mmBotEnabled) {
                MMBotService.enable()
                addLog({ type: 'info', bot: 'mm', message: `MM Bot synced: ${state.mmPricingMode} pricing mode` })
            }
            MMBotService.updateSettings({
                pricingMode: state.mmPricingMode,
                pairSettings: state.mmPairSettings
            })

            // Auto Trade Bot
            if (state.autoTradeEnabled) {
                AutoTradeBotService.enable()
                addLog({ type: 'info', bot: 'autotrade', message: `Auto Trade Bot synced: ${state.positionSize} position size` })
            }
        }

        // Start with retry mechanism
        startWithRetry()

        return () => {
            if (retryInterval) clearInterval(retryInterval)
        }
    }, [privateKey, publicAddress]) // Re-run when key/address becomes available

    // Sync Cancel Bot state changes
    useEffect(() => {
        if (!initialized.current) return
        const addLog = useAutomationStore.getState().addLog
        if (cancelBotEnabled) {
            CancelBotService.enable()
            addLog({ type: 'success', bot: 'cancel', message: `Enabled - ${cancelTimeout}min timeout` })
        } else {
            CancelBotService.disable()
            addLog({ type: 'info', bot: 'cancel', message: 'Disabled' })
        }
        CancelBotService.updateSettings({
            cancelTimeoutMinutes: cancelTimeout,
            limitOnly: cancelLimitOnly
        })
    }, [cancelBotEnabled, cancelTimeout, cancelLimitOnly])

    // Sync SL/TP Bot state changes
    useEffect(() => {
        if (!initialized.current) return
        const addLog = useAutomationStore.getState().addLog
        if (sltpBotEnabled) {
            SLTPBotService.enable()
            addLog({ type: 'success', bot: 'sltp', message: `Enabled - SL=${defaultSlPercent}%, TP=${defaultTpPercent}%` })
        } else {
            SLTPBotService.disable()
            addLog({ type: 'info', bot: 'sltp', message: 'Disabled' })
        }
        SLTPBotService.updateSettings({
            autoSlEnabled,
            autoTpEnabled,
            defaultSlPct: defaultSlPercent,
            defaultTpPct: defaultTpPercent
        })
    }, [sltpBotEnabled, autoSlEnabled, autoTpEnabled, defaultSlPercent, defaultTpPercent])

    // Sync Trailing SL Bot state changes
    useEffect(() => {
        if (!initialized.current) return
        const addLog = useAutomationStore.getState().addLog
        if (trailingSLEnabled) {
            TrailingSLBotService.enable()
            addLog({ type: 'success', bot: 'trailing', message: `Enabled - ${trailingProfitTrigger}% trigger, ${trailingMode} mode` })
        } else {
            TrailingSLBotService.disable()
            addLog({ type: 'info', bot: 'trailing', message: 'Disabled' })
        }
        TrailingSLBotService.updateSettings({
            profitTriggerPct: trailingProfitTrigger,
            trailingMode
        })
    }, [trailingSLEnabled, trailingProfitTrigger, trailingMode])

    // Sync MM Bot state changes
    useEffect(() => {
        const addLog = useAutomationStore.getState().addLog
        
        // Log state even if not initialized (for debugging)
        if (!initialized.current) {
            addLog({ type: 'info', bot: 'mm', message: `MM Bot toggle: enabled=${mmBotEnabled}, but services not initialized yet` })
            log('[BotProvider] MM Bot toggle but not initialized. Check if private key exists in localStorage.')
            return
        }
        
        if (mmBotEnabled) {
            MMBotService.enable()
            addLog({ type: 'success', bot: 'mm', message: `Enabled - ${mmPricingMode} pricing` })
        } else {
            MMBotService.disable()
            addLog({ type: 'info', bot: 'mm', message: 'Disabled' })
        }
        MMBotService.updateSettings({
            pricingMode: mmPricingMode,
            pairSettings: mmPairSettings
        })
    }, [mmBotEnabled, mmPricingMode, mmPairSettings])

    // Sync Auto Trade Bot state changes
    useEffect(() => {
        if (!initialized.current) return
        const addLog = useAutomationStore.getState().addLog
        const store = useAutomationStore.getState()
        if (autoTradeEnabled) {
            AutoTradeBotService.enable()
            addLog({ type: 'success', bot: 'autotrade', message: `Enabled - ${store.positionSize} position size` })
        } else {
            AutoTradeBotService.disable()
            addLog({ type: 'info', bot: 'autotrade', message: 'Disabled' })
        }
    }, [autoTradeEnabled])

    // Sync global store data to bot services
    const positions = usePositionsStore(state => state.positions)
    const orders = usePositionsStore(state => state.orders)
    const accountSummary = usePositionsStore(state => state.accountSummary)
    const prices = useSpotPricesStore(state => state.prices)

    // Pass global data to bot services when it updates
    useEffect(() => {
        if (!initialized.current) return
        
        // Map positions to AutoTradeBotService format (different field names)
        const mappedPositions = positions.map(p => ({
            asset: p.coin,
            side: (p.side === 'LONG' ? 'long' : 'short') as 'long' | 'short',
            size: Math.abs(p.size),
            entryPx: p.entryPrice
        }))
        AutoTradeBotService.updatePositions(mappedPositions)
        
        // Update TrailingSLBotService with positions and prices
        TrailingSLBotService.updateGlobalData({ positions, orders, prices })
        
        // Update SLTPBotService with positions and orders
        SLTPBotService.updateGlobalData({ positions, orders })
        
        // Update CancelBotService with orders
        CancelBotService.updateOrders(orders)
        
        // Update MMBotService with spot balances
        if (accountSummary?.spotBalances) {
            MMBotService.updateSpotBalances(accountSummary.spotBalances)
        }
        
        // Update AutoTradeBotService with account value for position sizing
        if (accountSummary?.accountValue) {
            AutoTradeBotService.updateAccountValue(accountSummary.accountValue)
        }
        
    }, [positions, orders, prices, accountSummary])

    // Note: Signal processing is now handled directly by AutoTradeBotService
    // via SSE subscription and 30-second polling cycle (matches reference implementation).
    // BotProvider no longer needs to push signals - AutoTradeBotService subscribes to SSE directly.

    return <>{children}</>
}
