import { create } from 'zustand'
import { useCallback } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useUserStore } from '@/store/useUserStore'

export type TradingReadyState = 'not_logged_in' | 'needs_setup' | 'ready'

interface TradingReadinessStore {
  builderFeeApproved: boolean | null
  setupWizardOpen: boolean
  setBuilderFeeApproved: (v: boolean) => void
  setSetupWizardOpen: (v: boolean) => void
}

export const useTradingReadinessStore = create<TradingReadinessStore>((set) => ({
  builderFeeApproved: null,
  setupWizardOpen: false,
  setBuilderFeeApproved: (v) => set({ builderFeeApproved: v }),
  setSetupWizardOpen: (v) => set({ setupWizardOpen: v }),
}))

export function useTradingReadiness() {
  const { authenticated, login } = usePrivy()
  const { apiKeys } = useUserStore()
  const { setupWizardOpen, setSetupWizardOpen } = useTradingReadinessStore()

  const hasApiKey = !!(apiKeys?.hyperliquid?.apiKey)

  const readyState: TradingReadyState = !authenticated
    ? 'not_logged_in'
    : !hasApiKey
      ? 'needs_setup'
      : 'ready'

  const handleTradeAction = useCallback(() => {
    if (!authenticated) {
      login()
      return false
    }
    if (!hasApiKey) {
      setSetupWizardOpen(true)
      return false
    }
    return true
  }, [authenticated, hasApiKey, login, setSetupWizardOpen])

  const openSetupWizard = useCallback(() => {
    setSetupWizardOpen(true)
  }, [setSetupWizardOpen])

  const closeSetupWizard = useCallback(() => {
    setSetupWizardOpen(false)
  }, [setSetupWizardOpen])

  return {
    readyState,
    isLoggedIn: authenticated,
    hasApiKey,
    setupWizardOpen,
    handleTradeAction,
    openSetupWizard,
    closeSetupWizard,
    login,
  }
}
