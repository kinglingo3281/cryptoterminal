'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { X, Wallet, Shield, Key, Check, Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import { useWalletConnection } from '@/hooks/useWalletConnection'
import { BuilderFeeService } from '@/services/BuilderFeeService'
import { AgentService } from '@/services/AgentService'
import { useAuth } from '@/hooks/useAuth'
import { useTradingReadinessStore } from '@/hooks/useTradingReadiness'
import { cn } from '@/lib/utils'

type WizardStep = 'wallet' | 'builder_fee' | 'create_agent' | 'done'

interface StepStatus {
  wallet: 'pending' | 'active' | 'done' | 'error'
  builder_fee: 'pending' | 'active' | 'done' | 'error'
  create_agent: 'pending' | 'active' | 'done' | 'error'
}

export function TradingSetupWizard() {
  const { setupWizardOpen, setSetupWizardOpen, setBuilderFeeApproved } = useTradingReadinessStore()
  const { walletClient, isConnected, connectWallet, checkChainId, switchToArbitrum } = useWalletConnection()
  const { addAPIKey } = useAuth()

  const [currentStep, setCurrentStep] = useState<WizardStep>('wallet')
  const [stepStatus, setStepStatus] = useState<StepStatus>({
    wallet: 'active',
    builder_fee: 'pending',
    create_agent: 'pending',
  })
  const [error, setError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [pendingStep, setPendingStep] = useState<WizardStep | null>(null)

  // Refs for step functions so useEffect can call them without stale closures
  const doBuilderFeeRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const doCreateAgentRef = useRef<() => Promise<void>>(() => Promise.resolve())

  // When walletClient becomes available after connect, continue pending step
  useEffect(() => {
    if (pendingStep && walletClient && isConnected) {
      setPendingStep(null)
      if (pendingStep === 'builder_fee') {
        doBuilderFeeRef.current()
      } else if (pendingStep === 'create_agent') {
        doCreateAgentRef.current()
      }
    }
  }, [walletClient, isConnected, pendingStep])

  // Reset state when modal opens
  useEffect(() => {
    if (setupWizardOpen) {
      // If wallet is already connected, skip to builder fee
      if (isConnected && walletClient) {
        setCurrentStep('builder_fee')
        setStepStatus({ wallet: 'done', builder_fee: 'active', create_agent: 'pending' })
      } else {
        setCurrentStep('wallet')
        setStepStatus({ wallet: 'active', builder_fee: 'pending', create_agent: 'pending' })
      }
      setError('')
      setIsProcessing(false)
      setPendingStep(null)
    }
  }, [setupWizardOpen, isConnected, walletClient])

  const handleClose = () => {
    if (!isProcessing) {
      setSetupWizardOpen(false)
    }
  }

  // Ensure wallet is connected and on Arbitrum, returns true if ready
  const ensureWalletReady = useCallback(async (): Promise<boolean> => {
    if (!isConnected || !walletClient) {
      const connected = await connectWallet()
      if (!connected) {
        setError('Failed to connect wallet. Please try again.')
        return false
      }
      // walletClient may not be available yet — caller should set pendingStep
      return false
    }

    const isCorrectChain = await checkChainId()
    if (!isCorrectChain) {
      const switched = await switchToArbitrum()
      if (!switched) {
        setError('Please switch to Arbitrum network in your wallet.')
        return false
      }
    }

    if (!walletClient) {
      setError('Wallet not ready. Please try again.')
      return false
    }

    return true
  }, [isConnected, walletClient, connectWallet, checkChainId, switchToArbitrum])

  // Step 1: Connect wallet
  const handleConnectWallet = async () => {
    setError('')
    setIsProcessing(true)

    try {
      const connected = await connectWallet()
      if (!connected) {
        setError('Failed to connect wallet. Please try again.')
        setIsProcessing(false)
        return
      }

      // Check chain
      const isCorrectChain = await checkChainId()
      if (!isCorrectChain) {
        const switched = await switchToArbitrum()
        if (!switched) {
          setError('Please switch to Arbitrum network.')
          setIsProcessing(false)
          return
        }
      }

      // If walletClient is available immediately, advance
      if (walletClient) {
        setStepStatus(prev => ({ ...prev, wallet: 'done', builder_fee: 'active' }))
        setCurrentStep('builder_fee')
      } else {
        // Wait for walletClient via useEffect
        setPendingStep('builder_fee')
        setStepStatus(prev => ({ ...prev, wallet: 'done', builder_fee: 'active' }))
        setCurrentStep('builder_fee')
      }
    } catch (err: any) {
      setError(err.message || 'Connection failed')
      setStepStatus(prev => ({ ...prev, wallet: 'error' }))
    } finally {
      setIsProcessing(false)
    }
  }

  // Step 2: Approve builder fee
  const doBuilderFee = async () => {
    setError('')
    setIsProcessing(true)

    try {
      // Ensure wallet is still connected
      if (!walletClient) {
        const ready = await ensureWalletReady()
        if (!ready) {
          if (!walletClient) {
            setPendingStep('builder_fee')
            return
          }
        }
      }

      if (!walletClient) {
        setError('Wallet not ready. Please reconnect.')
        setIsProcessing(false)
        return
      }

      const result = await BuilderFeeService.approveBuilderFee(walletClient)

      if (result.success) {
        setBuilderFeeApproved(true)
        setStepStatus(prev => ({ ...prev, builder_fee: 'done', create_agent: 'active' }))
        setCurrentStep('create_agent')
      } else {
        setError(result.error || 'Builder fee approval failed')
        setStepStatus(prev => ({ ...prev, builder_fee: 'error' }))
      }
    } catch (err: any) {
      if (err.message?.includes('User rejected') || err.code === 4001) {
        setError('Transaction rejected. Please approve to continue.')
      } else {
        setError(err.message || 'Approval failed')
      }
      setStepStatus(prev => ({ ...prev, builder_fee: 'error' }))
    } finally {
      setIsProcessing(false)
    }
  }

  // Step 3: Create agent (API key)
  const doCreateAgent = async () => {
    setError('')
    setIsProcessing(true)

    try {
      if (!walletClient) {
        const ready = await ensureWalletReady()
        if (!ready) {
          if (!walletClient) {
            setPendingStep('create_agent')
            return
          }
        }
      }

      if (!walletClient) {
        setError('Wallet not ready. Please reconnect.')
        setIsProcessing(false)
        return
      }

      const agentResult = await AgentService.createAgent(walletClient)

      if (agentResult.success && agentResult.apiKey && agentResult.apiSecret) {
        // Auto-save to backend
        try {
          await addAPIKey('hyperliquid', 'Trading Agent', {
            apiKey: agentResult.apiSecret,
            apiSecret: agentResult.apiKey,
          })
        } catch (saveErr: any) {
          console.error('[SetupWizard] Failed to save API key:', saveErr)
          setError('Agent created but failed to save. Please add manually in Profile > API Keys.')
          setStepStatus(prev => ({ ...prev, create_agent: 'error' }))
          setIsProcessing(false)
          return
        }

        setStepStatus(prev => ({ ...prev, create_agent: 'done' }))
        setCurrentStep('done')
      } else {
        setError(agentResult.error || 'Failed to create agent')
        setStepStatus(prev => ({ ...prev, create_agent: 'error' }))
      }
    } catch (err: any) {
      if (err.message?.includes('User rejected') || err.code === 4001) {
        setError('Transaction rejected. Please approve to continue.')
      } else {
        setError(err.message || 'Agent creation failed')
      }
      setStepStatus(prev => ({ ...prev, create_agent: 'error' }))
    } finally {
      setIsProcessing(false)
    }
  }

  // Keep refs in sync with latest function versions
  doBuilderFeeRef.current = doBuilderFee
  doCreateAgentRef.current = doCreateAgent

  // Retry current step
  const handleRetry = () => {
    setError('')
    if (currentStep === 'wallet') {
      setStepStatus(prev => ({ ...prev, wallet: 'active' }))
      handleConnectWallet()
    } else if (currentStep === 'builder_fee') {
      setStepStatus(prev => ({ ...prev, builder_fee: 'active' }))
      doBuilderFee()
    } else if (currentStep === 'create_agent') {
      setStepStatus(prev => ({ ...prev, create_agent: 'active' }))
      doCreateAgent()
    }
  }

  if (!setupWizardOpen) return null

  const steps = [
    { key: 'wallet' as const, icon: Wallet, label: 'Connect Wallet', desc: 'Link your MetaMask wallet' },
    { key: 'builder_fee' as const, icon: Shield, label: 'Approve Fee', desc: 'One-time builder fee signature' },
    { key: 'create_agent' as const, icon: Key, label: 'Create Agent', desc: 'Generate trading API key' },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-bold">Enable Trading</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Complete setup to start trading</p>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            {steps.map((step, i) => (
              <div key={step.key} className="flex items-center flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-colors",
                    stepStatus[step.key] === 'done' && "bg-primary text-primary-foreground",
                    stepStatus[step.key] === 'active' && "bg-primary/20 text-primary border border-primary/50",
                    stepStatus[step.key] === 'pending' && "bg-secondary text-muted-foreground",
                    stepStatus[step.key] === 'error' && "bg-destructive/20 text-destructive border border-destructive/50",
                  )}>
                    {stepStatus[step.key] === 'done' ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <step.icon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className={cn(
                      "text-xs font-medium truncate",
                      stepStatus[step.key] === 'active' && "text-primary",
                      stepStatus[step.key] === 'done' && "text-foreground",
                      stepStatus[step.key] === 'pending' && "text-muted-foreground",
                      stepStatus[step.key] === 'error' && "text-destructive",
                    )}>
                      {step.label}
                    </div>
                  </div>
                </div>
                {i < steps.length - 1 && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0 mx-1" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="p-6 space-y-4">
          {currentStep === 'done' ? (
            <div className="text-center py-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-lg font-bold mb-1">Trading Enabled</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Your account is fully set up. You can now place trades.
              </p>
              <button
                onClick={handleClose}
                className="px-8 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors"
              >
                Start Trading
              </button>
            </div>
          ) : (
            <>
              {/* Current step description */}
              <div className="bg-secondary/50 rounded-lg p-4">
                {currentStep === 'wallet' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Wallet className="h-5 w-5 text-primary" />
                      <span className="font-medium text-sm">Connect Your Wallet</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Connect your MetaMask or browser wallet on the Arbitrum network. This is used to sign the required approvals.
                    </p>
                  </div>
                )}
                {currentStep === 'builder_fee' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      <span className="font-medium text-sm">Approve Builder Fee</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      One-time signature to authorize the platform fee structure. This is a gasless EIP-712 signature — no transaction cost.
                    </p>
                  </div>
                )}
                {currentStep === 'create_agent' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Key className="h-5 w-5 text-primary" />
                      <span className="font-medium text-sm">Create Trading Agent</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Generate a secure trading key linked to your wallet. This key is stored encrypted and used to execute trades on your behalf.
                    </p>
                  </div>
                )}
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              {/* Action button */}
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2.5 bg-secondary hover:bg-secondary/80 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (error) {
                      handleRetry()
                    } else if (currentStep === 'wallet') {
                      handleConnectWallet()
                    } else if (currentStep === 'builder_fee') {
                      doBuilderFee()
                    } else if (currentStep === 'create_agent') {
                      doCreateAgent()
                    }
                  }}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {currentStep === 'wallet' && 'Connecting...'}
                      {currentStep === 'builder_fee' && 'Awaiting Signature...'}
                      {currentStep === 'create_agent' && 'Creating Agent...'}
                    </>
                  ) : error ? (
                    'Retry'
                  ) : (
                    <>
                      {currentStep === 'wallet' && 'Connect Wallet'}
                      {currentStep === 'builder_fee' && 'Sign Approval'}
                      {currentStep === 'create_agent' && 'Create Agent'}
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
