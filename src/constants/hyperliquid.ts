/**
 * Hyperliquid Protocol Constants
 */

export const HYPERLIQUID_CONSTANTS = {
  // Builder Fee Configuration
  BUILDER_ADDRESS: '0xC1A2f762F67aF72FD05e79afa23F8358A4d7dbaF',
  BUILDER_FEE_MAX: '0.02%', // 2% max builder fee
  
  // Network Configuration
  ARBITRUM_CHAIN_ID: '0xa4b1', // Arbitrum One
  ARBITRUM_CHAIN_ID_DECIMAL: 42161,
  CHAIN_NAME: 'Arbitrum One',
  
  // RPC URLs
  RPC_URLS: ['https://arb1.arbitrum.io/rpc'],
  
  // Explorer
  BLOCK_EXPLORER: 'https://arbiscan.io'
} as const
