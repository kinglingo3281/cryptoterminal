'use client';

import { useEffect } from 'react';
import { exploreService } from '@/services/ExploreService';
import { trackerService } from '@/services/TrackerService';
import { ethers } from 'ethers';

/**
 * Try to derive wallet address from localStorage (same sources as useTrackerSSE)
 */
function getStoredWalletAddress(): string | null {
  if (typeof window === 'undefined') return null;
  
  // Check for stored addresses (multiple sources)
  const storedAddress = localStorage.getItem('userWalletAddress') || localStorage.getItem('trackerWalletAddress');
  if (storedAddress && storedAddress.startsWith('0x') && storedAddress.length === 42) {
    return storedAddress;
  }
  
  // Try to derive from private key
  const privateKey = localStorage.getItem('hl_agent_key') || localStorage.getItem('hl_private_key');
  if (privateKey) {
    try {
      const wallet = new ethers.Wallet(privateKey);
      return wallet.address;
    } catch (e) {
      console.warn('[AppInitializer] Failed to derive wallet from private key');
    }
  }
  
  return null;
}

/**
 * AppInitializer - Sets up remote node configuration on app startup
 * Sets up remote node URL in localStorage
 * Also starts ExploreService for background wallet aggregation
 */
export function AppInitializer() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Configure remote Hyperliquid node
    const currentNodeUrl = localStorage.getItem('remoteNodeUrl');
    const targetNodeUrl = process.env.NEXT_PUBLIC_PRIVATE_NODE_URL || 'https://api.hyperliquid.xyz';
    
    if (currentNodeUrl !== targetNodeUrl) {
      console.log(`🔄 Updating node URL: ${currentNodeUrl} → ${targetNodeUrl}`);
      localStorage.setItem('remoteNodeUrl', targetNodeUrl);
      localStorage.setItem('useRemoteNode', 'true');
    }
    
    console.log('🌐 Using remote node:', localStorage.getItem('remoteNodeUrl'));
    
    // Try to get wallet address from localStorage
    // Only connect if we have a real address - zero address gets CORS/402 errors
    const walletAddress = getStoredWalletAddress();
    if (walletAddress) {
      trackerService.setWalletAddress(walletAddress);
      trackerService.connect();
      console.log('📡 TrackerService SSE started with stored wallet');
    } else {
      console.log('📡 TrackerService SSE deferred - no wallet address yet (will connect on Alpha page)');
    }
    
    // Start ExploreService background aggregation
    // Will retry until TrackerService has data
    exploreService.start();
    console.log('🔍 ExploreService started for background wallet aggregation');
    
    return () => {
      exploreService.stop();
    };
  }, []);

  return null;
}
