import type { WalletClient } from 'viem'
import { parseUnits, type Hash, createPublicClient, http } from 'viem'
import { arbitrum } from 'viem/chains'

/**
 * Hyperliquid Bridge and USDC Contract Addresses on Arbitrum
 */
const ARBITRUM_ADDRESSES = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Native USDC on Arbitrum
  HYPERLIQUID_BRIDGE: '0x2Df1c51E09aECF9cacB7bc98cB1742757f163dF7' // Hyperliquid L1 Bridge
} as const

/**
 * USDC ERC20 ABI (minimal for approve)
 */
const USDC_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const

/**
 * Hyperliquid Bridge ABI (minimal for deposit)
 */
const BRIDGE_ABI = [
  {
    inputs: [
      { name: 'destination', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'depositUsdc',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  }
] as const

export class DepositService {
  /**
   * Deposit USDC from Arbitrum to Hyperliquid
   * @param walletClient - Viem wallet client
   * @param amount - Amount in USDC (e.g., 100.5 for $100.50)
   * @returns Transaction hash and success status
   */
  static async depositToHyperliquid(
    walletClient: WalletClient,
    amount: number
  ): Promise<{
    success: boolean
    approvalTxHash?: Hash
    depositTxHash?: Hash
    error?: string
  }> {
    try {
      console.log('[Deposit] Starting deposit for:', amount, 'USDC')

      if (!walletClient.account) {
        return { success: false, error: 'No wallet account found' }
      }

      const userAddress = walletClient.account.address

      // Convert amount to USDC units (6 decimals)
      const amountWei = parseUnits(amount.toString(), 6)
      console.log('[Deposit] Amount in wei:', amountWei.toString())

      // Create public client for reading contract state
      const publicClient = createPublicClient({
        chain: arbitrum,
        transport: http()
      })

      // Step 0: Check USDC balance
      console.log('[Deposit] Checking USDC balance...')
      const balance = await publicClient.readContract({
        address: ARBITRUM_ADDRESSES.USDC,
        abi: [{
          inputs: [{ name: 'account', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function'
        }],
        functionName: 'balanceOf',
        args: [userAddress]
      }) as bigint

      console.log('[Deposit] USDC balance:', balance.toString())

      if (balance < amountWei) {
        return {
          success: false,
          error: `Insufficient USDC balance. You have ${(Number(balance) / 1e6).toFixed(2)} USDC`
        }
      }

      // Step 1: Check current allowance
      console.log('[Deposit] Checking USDC allowance...')
      const allowance = await publicClient.readContract({
        address: ARBITRUM_ADDRESSES.USDC,
        abi: USDC_ABI,
        functionName: 'allowance',
        args: [userAddress, ARBITRUM_ADDRESSES.HYPERLIQUID_BRIDGE]
      }) as bigint

      console.log('[Deposit] Current allowance:', allowance.toString())

      let approvalTxHash: Hash | undefined

      // Step 2: Approve if needed
      if (allowance < amountWei) {
        console.log('[Deposit] Approving USDC spend...')
        
        const approveTx = await walletClient.writeContract({
          address: ARBITRUM_ADDRESSES.USDC,
          abi: USDC_ABI,
          functionName: 'approve',
          args: [ARBITRUM_ADDRESSES.HYPERLIQUID_BRIDGE, amountWei],
          account: userAddress,
          chain: walletClient.chain
        })

        approvalTxHash = approveTx
        console.log('[Deposit] Approval tx:', approvalTxHash)

        // Wait a bit for approval to confirm
        await new Promise(resolve => setTimeout(resolve, 2000))
      } else {
        console.log('[Deposit] Sufficient allowance already exists')
      }

      // Step 3: Deposit to Hyperliquid
      console.log('[Deposit] Depositing to Hyperliquid bridge...')
      
      const depositTx = await walletClient.writeContract({
        address: ARBITRUM_ADDRESSES.HYPERLIQUID_BRIDGE,
        abi: BRIDGE_ABI,
        functionName: 'depositUsdc',
        args: [userAddress, amountWei],
        account: userAddress,
        chain: walletClient.chain
      })

      console.log('[Deposit] Deposit tx:', depositTx)

      return {
        success: true,
        approvalTxHash,
        depositTxHash: depositTx
      }
    } catch (error: any) {
      console.error('[Deposit] Error:', error)
      
      // Parse user-friendly error messages
      let errorMsg = 'Deposit failed'
      
      if (error.message?.includes('user rejected')) {
        errorMsg = 'Transaction rejected by user'
      } else if (error.message?.includes('insufficient funds')) {
        errorMsg = 'Insufficient funds for transaction'
      } else if (error.message) {
        errorMsg = error.message
      }

      return {
        success: false,
        error: errorMsg
      }
    }
  }

  /**
   * Get USDC contract address on Arbitrum
   */
  static getUsdcAddress(): string {
    return ARBITRUM_ADDRESSES.USDC
  }

  /**
   * Get Hyperliquid bridge contract address on Arbitrum
   */
  static getBridgeAddress(): string {
    return ARBITRUM_ADDRESSES.HYPERLIQUID_BRIDGE
  }

  /**
   * Estimate gas fees for deposit transaction
   * @param walletClient - Viem wallet client
   * @param amount - Amount in USDC
   * @returns Estimated gas in ETH
   */
  static async estimateDepositGas(
    walletClient: WalletClient,
    amount: number
  ): Promise<{
    success: boolean
    estimatedGasETH?: string
    error?: string
  }> {
    try {
      if (!walletClient.account) {
        return { success: false, error: 'No wallet account' }
      }

      const userAddress = walletClient.account.address
      const amountWei = parseUnits(amount.toString(), 6)

      // Create public client
      const publicClient = createPublicClient({
        chain: arbitrum,
        transport: http()
      })

      // Estimate gas for deposit (worst case: approval + deposit)
      // Arbitrum gas is very cheap, typically 0.1-0.5 gwei
      // Approval: ~50k gas, Deposit: ~100k gas = ~150k total
      // At 0.3 gwei: 150k * 0.3 = 45k gwei = 0.000045 ETH (~$0.10)
      
      const estimatedGasUnits = BigInt(150000) // Conservative estimate
      const gasPrice = await publicClient.getGasPrice()
      const estimatedGasCost = estimatedGasUnits * gasPrice
      
      // Convert to ETH
      const estimatedETH = Number(estimatedGasCost) / 1e18
      
      console.log('[Deposit] Gas estimate:', estimatedETH, 'ETH')
      
      return {
        success: true,
        estimatedGasETH: estimatedETH.toFixed(6)
      }
    } catch (error: any) {
      console.error('[Deposit] Gas estimation error:', error)
      return {
        success: false,
        error: 'Failed to estimate gas'
      }
    }
  }
}
