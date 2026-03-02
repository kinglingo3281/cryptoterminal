"use client"

import { useState, useEffect } from 'react';
import { usePositionsPolling } from '@/hooks/usePositionsPolling';
import { useUserStore } from '@/store/useUserStore';

interface PositionsProviderProps {
  children: React.ReactNode;
}

export function PositionsProvider({ children }: PositionsProviderProps) {
  const { user, apiKeys } = useUserStore();
  const [remoteNodeUrl, setRemoteNodeUrl] = useState<string | null>(null);
  
  // Extract user wallet address
  const userAddress = user?.wallet_address || null;
  
  // Check if user has any API keys (trading credentials)
  const hasApiKeys = !!(apiKeys && Object.keys(apiKeys).length > 0);
  
  // Read remote node URL from localStorage after mount
  useEffect(() => {
    const useRemote = localStorage.getItem('useRemoteNode') === 'true';
    const nodeUrl = localStorage.getItem('remoteNodeUrl');
    setRemoteNodeUrl(useRemote ? nodeUrl : null);
  }, []);
  
  // Start polling only when user has wallet address AND API keys
  usePositionsPolling({
    userAddress,
    remoteNodeUrl,
    enabled: !!userAddress && hasApiKeys
  });
  
  return <>{children}</>;
}
