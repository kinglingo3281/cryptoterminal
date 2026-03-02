import { useState, useEffect, useCallback } from 'react'
import { createWalletClient, custom, type WalletClient } from 'viem'
import { arbitrum } from 'viem/chains'
import { HYPERLIQUID_CONSTANTS } from '@/constants/hyperliquid'

declare global {
  interface Window {
    ethereum?: any
  }
}

export function useWalletConnection() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialize wallet client when address changes
  useEffect(() => {
    if (walletAddress && window.ethereum && !walletClient) {
      try {
        const client = createWalletClient({
          account: walletAddress as `0x${string}`,
          chain: arbitrum,
          transport: custom(window.ethereum)
        })
        setWalletClient(client)
        setIsConnected(true)
      } catch (err) {
        console.error('[Wallet] Failed to create wallet client:', err)
        setError('Failed to initialize wallet')
      }
    }
  }, [walletAddress, walletClient])

  // Listen for account changes
  useEffect(() => {
    if (!window.ethereum) return

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        // User disconnected
        setWalletAddress(null)
        setWalletClient(null)
        setIsConnected(false)
      } else {
        setWalletAddress(accounts[0])
      }
    }

    const handleChainChanged = () => {
      // Reload the page when chain changes (recommended by MetaMask)
      window.location.reload()
    }

    window.ethereum.on('accountsChanged', handleAccountsChanged)
    window.ethereum.on('chainChanged', handleChainChanged)

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged)
        window.ethereum.removeListener('chainChanged', handleChainChanged)
      }
    }
  }, [])

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected. Please install MetaMask.')
      return false
    }

    setIsConnecting(true)
    setError(null)

    try {
      // Request account access
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts'
      })

      if (accounts && accounts.length > 0) {
        setWalletAddress(accounts[0])
        return true
      } else {
        setError('No accounts found')
        return false
      }
    } catch (err: any) {
      console.error('[Wallet] Connection error:', err)
      if (err.code === 4001) {
        setError('Connection rejected by user')
      } else {
        setError('Failed to connect wallet')
      }
      return false
    } finally {
      setIsConnecting(false)
    }
  }, [])

  const disconnectWallet = useCallback(() => {
    setWalletAddress(null)
    setWalletClient(null)
    setIsConnected(false)
  }, [])

  const checkChainId = useCallback(async () => {
    if (!window.ethereum) return false

    try {
      const chainId = await window.ethereum.request({ method: 'eth_chainId' })
      return chainId === HYPERLIQUID_CONSTANTS.ARBITRUM_CHAIN_ID
    } catch (err) {
      console.error('[Wallet] Failed to check chain:', err)
      return false
    }
  }, [])

  const switchToArbitrum = useCallback(async () => {
    if (!window.ethereum) {
      setError('MetaMask not detected')
      return false
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: HYPERLIQUID_CONSTANTS.ARBITRUM_CHAIN_ID }]
      })
      return true
    } catch (err: any) {
      console.error('[Wallet] Failed to switch chain:', err)
      
      // Chain not added to MetaMask
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: HYPERLIQUID_CONSTANTS.ARBITRUM_CHAIN_ID,
              chainName: HYPERLIQUID_CONSTANTS.CHAIN_NAME,
              rpcUrls: HYPERLIQUID_CONSTANTS.RPC_URLS,
              blockExplorerUrls: [HYPERLIQUID_CONSTANTS.BLOCK_EXPLORER]
            }]
          })
          return true
        } catch (addError) {
          console.error('[Wallet] Failed to add chain:', addError)
          setError('Failed to add Arbitrum network')
          return false
        }
      }
      
      setError('Failed to switch to Arbitrum network')
      return false
    }
  }, [])

  return {
    walletAddress,
    walletClient,
    isConnected,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    checkChainId,
    switchToArbitrum
  }
}
