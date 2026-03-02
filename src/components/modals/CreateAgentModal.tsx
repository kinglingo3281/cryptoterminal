'use client';

import { useState, useEffect } from 'react';
import { X, Key, AlertCircle, Copy, Check, Loader2, Eye, EyeOff } from 'lucide-react';
import { useWalletConnection } from '@/hooks/useWalletConnection';
import { AgentService, AgentCreationResult } from '@/services/AgentService';

interface CreateAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CreateAgentModal({ isOpen, onClose }: CreateAgentModalProps) {
  const { walletClient, isConnected, connectWallet, checkChainId, switchToArbitrum } = useWalletConnection();
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AgentCreationResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [pendingCreation, setPendingCreation] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  
  // Handle pending agent creation when walletClient becomes available
  useEffect(() => {
    if (pendingCreation && walletClient && isConnected) {
      setPendingCreation(false);
      performAgentCreation();
    }
  }, [walletClient, isConnected, pendingCreation]);
  
  if (!isOpen) return null;
  
  async function performAgentCreation() {
    try {
      // Check chain before creating
      const isCorrectChain = await checkChainId();
      if (!isCorrectChain) {
        const switched = await switchToArbitrum();
        if (!switched) {
          setError('Please switch to Arbitrum network');
          setIsProcessing(false);
          return;
        }
      }
      
      if (!walletClient) {
        setError('Wallet not ready. Please try again.');
        setIsProcessing(false);
        return;
      }
      
      const agentResult = await AgentService.createAgent(walletClient);
      
      if (agentResult.success) {
        setResult(agentResult);
      } else {
        setError(agentResult.error || 'Failed to create agent');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsProcessing(false);
    }
  }
  
  async function handleCreateAgent() {
    setError('');
    setIsProcessing(true);
    
    try {
      // If wallet not connected, connect first and wait for re-render
      if (!isConnected || !walletClient) {
        const connected = await connectWallet();
        if (!connected) {
          setError('Failed to connect wallet');
          setIsProcessing(false);
          return;
        }
        // Set pending flag - useEffect will trigger creation when walletClient is ready
        setPendingCreation(true);
        return;
      }
      
      // Wallet already connected, proceed directly
      await performAgentCreation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsProcessing(false);
    }
  }
  
  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
  
  function handleClose() {
    if (!isProcessing) {
      setError('');
      setResult(null);
      setCopiedField(null);
      setShowSecret(false);
      onClose();
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-card border border-border rounded-lg w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Create API Key</h2>
              <p className="text-xs text-muted-foreground">Generate a trading agent wallet</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          {!result ? (
            <>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>This will create a new trading agent wallet for Hyperliquid.</p>
                <p>You will need to:</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Connect your wallet (if not connected)</li>
                  <li>Sign a transaction to approve the agent</li>
                  <li>Save your API credentials securely</li>
                </ol>
              </div>
              
              {error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive">{error}</p>
                </div>
              )}
              
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateAgent}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Agent'
                  )}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-md">
                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-3 w-3 text-primary-foreground" />
                </div>
                <p className="text-sm text-primary font-medium">Agent created successfully!</p>
              </div>
              
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                <p className="text-sm text-destructive font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  Save your API Secret now! It cannot be recovered.
                </p>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    API Key (Your Wallet Address)
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-xs font-mono truncate">
                      {result.apiKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(result.apiKey!, 'apiKey')}
                      className="h-8 w-8 rounded-md bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors"
                    >
                      {copiedField === 'apiKey' ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    API Secret (Agent Private Key)
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-secondary border border-border rounded-md text-xs font-mono truncate">
                      {showSecret ? result.apiSecret : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                    </code>
                    <button
                      onClick={() => setShowSecret(!showSecret)}
                      className="h-8 w-8 rounded-md bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors"
                    >
                      {showSecret ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => copyToClipboard(result.apiSecret!, 'apiSecret')}
                      className="h-8 w-8 rounded-md bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors"
                    >
                      {copiedField === 'apiSecret' ? (
                        <Check className="h-4 w-4 text-primary" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
              <button
                type="button"
                onClick={handleClose}
                className="w-full px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors mt-4"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
