'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useUserStore } from '@/store/useUserStore';
import { X, Key, AlertCircle, AlertTriangle } from 'lucide-react';

interface AddAPIKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddAPIKeyModal({ isOpen, onClose }: AddAPIKeyModalProps) {
  const { addAPIKey } = useAuth();
  const apiKeys = useUserStore(state => state.apiKeys);
  
  const provider = 'hyperliquid';
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  const hasExistingKey = useMemo(() => {
    return !!(apiKeys && apiKeys[provider]);
  }, [apiKeys, provider]);
  
  const walletWarning = useMemo(() => {
    if (!apiSecret) return null;
    const v = apiSecret.trim();
    if (!v.startsWith('0x')) return 'Wallet address should start with 0x';
    if (v.length !== 42) return `Wallet address should be 42 characters (got ${v.length})`;
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) return 'Wallet address contains invalid characters';
    return null;
  }, [apiSecret]);
  
  const keyWarning = useMemo(() => {
    if (!apiKey) return null;
    const v = apiKey.trim();
    if (!v.startsWith('0x')) return 'Private key should start with 0x';
    if (v.length !== 66) return `Private key should be 66 characters (got ${v.length})`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) return 'Private key contains invalid characters';
    return null;
  }, [apiKey]);
  
  if (!isOpen) return null;
  
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setIsSubmitting(true);
    
    try {
      await addAPIKey(provider, 'Main Account', {
        apiKey,
        apiSecret,
        ...(passphrase && { passphrase })
      });
      
      setSuccess(true);
      
      setTimeout(() => {
        setApiKey('');
        setApiSecret('');
        setPassphrase('');
        setSuccess(false);
        onClose();
      }, 1500);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add API key');
    } finally {
      setIsSubmitting(false);
    }
  }
  
  function handleClose() {
    if (!isSubmitting) {
      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      setError('');
      setSuccess(false);
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
              <h2 className="text-lg font-semibold">Add API Key</h2>
              <p className="text-xs text-muted-foreground">Connect your exchange account</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="h-8 w-8 rounded-md hover:bg-secondary flex items-center justify-center transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Private Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="0x... (66 characters)"
              required
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {keyWarning && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                <p className="text-[11px] text-yellow-500">{keyWarning}</p>
              </div>
            )}
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">Public Key (Wallet Address)</label>
            <input
              type="text"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="0x... (42 characters)"
              required
              className="w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            {walletWarning && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                <p className="text-[11px] text-yellow-500">{walletWarning}</p>
              </div>
            )}
          </div>
          
          
          {hasExistingKey && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
              <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-500">You already have a {provider} key saved. Adding a new one will replace it.</p>
            </div>
          )}
          
          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          
          {success && (
            <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-md">
              <div className="h-4 w-4 rounded-full bg-primary flex items-center justify-center">
                <svg className="h-3 w-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm text-primary">API key added successfully!</p>
            </div>
          )}
          
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || success}
              className="flex-1 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : success ? 'Added!' : 'Add Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
