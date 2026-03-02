'use client'

/**
 * useTrackerSSE - React hook for managing TrackerService SSE connection
 * Connects wallet address from useUserStore to TrackerService
 */

import { useEffect, useRef, useMemo } from 'react'
import { trackerService } from '@/services/TrackerService'
import { useTrackerStore } from '@/store/useTrackerStore'
import { useUserStore } from '@/store/useUserStore'
import { ethers } from 'ethers'

export function useTrackerSSE() {
  const isConnectedRef = useRef(false)
  
  const { user, apiKeys } = useUserStore()
  const { 
    setConnectionState, 
    setError, 
    setSymbols, 
    setLastUpdate,
    connectionState,
    symbols,
    selectedSymbol,
    getSymbolData
  } = useTrackerStore()

  // Get wallet address from multiple sources:
  // 1. User store wallet_address
  // 2. API keys publicAddress
  // 3. Derive from stored private key (hl_agent_key or hl_private_key)
  const walletAddress = useMemo(() => {
    if (user?.wallet_address) return user.wallet_address
    if (apiKeys?.hyperliquid?.publicAddress) return apiKeys.hyperliquid.publicAddress
    
    // Try to derive from stored private key
    if (typeof window !== 'undefined') {
      const privateKey = localStorage.getItem('hl_agent_key') || localStorage.getItem('hl_private_key')
      if (privateKey) {
        try {
          const wallet = new ethers.Wallet(privateKey)
          return wallet.address
        } catch (e) {
          console.warn('[useTrackerSSE] Failed to derive wallet from private key')
        }
      }
    }
    return null
  }, [user?.wallet_address, apiKeys?.hyperliquid?.publicAddress])

  useEffect(() => {
    if (!walletAddress) {
      console.log('[useTrackerSSE] No wallet address available - checking sources...')
      console.log('[useTrackerSSE] user?.wallet_address:', user?.wallet_address)
      console.log('[useTrackerSSE] apiKeys?.hyperliquid:', apiKeys?.hyperliquid ? 'present' : 'missing')
      return
    }

    console.log('[useTrackerSSE] Wallet address found:', walletAddress.slice(0, 10) + '...')

    // Set up callbacks
    trackerService.setCallbacks({
      onStateChange: (state) => {
        console.log('[useTrackerSSE] Connection state:', state)
        setConnectionState(state)
      },
      onData: (data) => {
        console.log('[useTrackerSSE] Received data for', data.size, 'symbols')
        setSymbols(data)
        setLastUpdate(new Date())
      },
      onError: (error) => {
        console.error('[useTrackerSSE] Error:', error)
        setError(error)
      }
    })

    // Set wallet and connect
    trackerService.setWalletAddress(walletAddress)
    
    if (!isConnectedRef.current) {
      isConnectedRef.current = true
      console.log('[useTrackerSSE] Initiating connection...')
      trackerService.connect().catch(err => {
        console.error('[useTrackerSSE] Connection failed:', err)
      })
    }

    return () => {
      // Don't disconnect on unmount - keep connection alive for other components
      // trackerService.disconnect()
    }
  }, [walletAddress, setConnectionState, setError, setSymbols, setLastUpdate])

  // Manual reconnect function
  const reconnect = async () => {
    await trackerService.reconnect()
  }

  // Get current symbol data
  const currentData = getSymbolData(selectedSymbol)

  return {
    connectionState,
    symbols,
    selectedSymbol,
    currentData,
    reconnect,
    getTimeSinceUpdate: () => trackerService.getTimeSinceUpdate()
  }
}
