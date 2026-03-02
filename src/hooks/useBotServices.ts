/**
 * Hook to wire up bot services to the Zustand store
 * Syncs store state with actual bot service instances
 */
'use client'

import { useEffect, useRef } from 'react'
import { useAutomationStore } from '@/store/useAutomationStore'
import { CancelBotService } from '@/services/CancelBotService'
import { TrailingSLBotService } from '@/services/TrailingSLBotService'
import { SLTPBotService } from '@/services/SLTPBotService'
import { MMBotService } from '@/services/MMBotService'
import * as hl from '@nktkas/hyperliquid'
import { ethers } from 'ethers'

export function useBotServices(privateKey: string | null, userAddress: string | null) {
    const initialized = useRef(false)
    const exchClientRef = useRef<hl.ExchangeClient | null>(null)
    
    const {
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
        // Logger
        addLog
    } = useAutomationStore()

    // Initialize bot services when we have credentials
    useEffect(() => {
        if (!privateKey || !userAddress || initialized.current) return

        const initializeBots = async () => {
            try {
                const transport = new hl.HttpTransport({ isTestnet: false })
                const wallet = new ethers.Wallet(privateKey)
                const exchClient = new hl.ExchangeClient({ wallet, transport })
                exchClientRef.current = exchClient

                // Set up logging callback
                const logCallback = (message: string, type: 'info' | 'success' | 'error') => {
                    addLog({ type, bot: 'system', message })
                }

                // Initialize all bot services
                CancelBotService.setLogCallback(logCallback)
                CancelBotService.initialize(exchClient, userAddress)

                TrailingSLBotService.setLogCallback(logCallback)
                TrailingSLBotService.initialize(exchClient, userAddress)

                SLTPBotService.setLogCallback(logCallback)
                SLTPBotService.initialize(exchClient, userAddress)

                MMBotService.setLogCallback(logCallback)
                await MMBotService.initialize(exchClient, userAddress)

                initialized.current = true
                addLog({ type: 'success', bot: 'system', message: 'Bot services initialized' })
            } catch (error) {
                console.error('[useBotServices] Failed to initialize:', error)
                addLog({ type: 'error', bot: 'system', message: 'Failed to initialize bot services' })
            }
        }

        initializeBots()
    }, [privateKey, userAddress, addLog])

    // Sync Cancel Bot state
    useEffect(() => {
        if (!initialized.current) return
        
        if (cancelBotEnabled) {
            CancelBotService.enable()
        } else {
            CancelBotService.disable()
        }
        CancelBotService.updateSettings({
            cancelTimeoutMinutes: cancelTimeout,
            limitOnly: cancelLimitOnly
        })
    }, [cancelBotEnabled, cancelTimeout, cancelLimitOnly])

    // Sync SL/TP Bot state
    useEffect(() => {
        if (!initialized.current) return
        
        if (sltpBotEnabled) {
            SLTPBotService.enable()
        } else {
            SLTPBotService.disable()
        }
        SLTPBotService.updateSettings({
            autoSlEnabled,
            autoTpEnabled,
            defaultSlPct: defaultSlPercent,
            defaultTpPct: defaultTpPercent
        })
    }, [sltpBotEnabled, autoSlEnabled, autoTpEnabled, defaultSlPercent, defaultTpPercent])

    // Sync Trailing SL Bot state
    useEffect(() => {
        if (!initialized.current) return
        
        if (trailingSLEnabled) {
            TrailingSLBotService.enable()
        } else {
            TrailingSLBotService.disable()
        }
        TrailingSLBotService.updateSettings({
            profitTriggerPct: trailingProfitTrigger,
            trailingMode
        })
    }, [trailingSLEnabled, trailingProfitTrigger, trailingMode])

    // Sync MM Bot state
    useEffect(() => {
        if (!initialized.current) return
        
        if (mmBotEnabled) {
            MMBotService.enable()
        } else {
            MMBotService.disable()
        }
        MMBotService.updateSettings({
            pricingMode: mmPricingMode,
            pairSettings: mmPairSettings
        })
    }, [mmBotEnabled, mmPricingMode, mmPairSettings])

    return {
        isInitialized: initialized.current,
        getStatus: () => ({
            cancelBot: CancelBotService.getStatus(),
            sltpBot: SLTPBotService.getStatus(),
            trailingSL: TrailingSLBotService.getStatus(),
            mmBot: MMBotService.getStatus()
        })
    }
}
