import * as hl from '@nktkas/hyperliquid'
import type { WalletClient } from 'viem'

export class WithdrawService {
  /**
   * Withdraw USDC from Hyperliquid to Arbitrum
   * Uses the HL exchange API withdraw3 (L1 signed action)
   * @param walletClient - Viem wallet client
   * @param amount - Amount in USD (e.g., 100.5 for $100.50)
   * @returns Success status
   */
  static async withdrawFromHyperliquid(
    walletClient: WalletClient,
    amount: number
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      console.log('[Withdraw] Starting withdrawal for:', amount, 'USDC')

      if (!walletClient.account) {
        return { success: false, error: 'No wallet account found' }
      }

      const userAddress = walletClient.account.address
      console.log('[Withdraw] Destination:', userAddress)

      // Create HTTP transport for Hyperliquid
      const transport = new hl.HttpTransport({ isTestnet: false })

      // Create ExchangeClient with user's wallet (signs the EIP-712 withdrawal request)
      const hlClient = new hl.ExchangeClient({
        transport,
        wallet: walletClient as any
      })

      // Initiate withdrawal - sends USDC back to user's Arbitrum address
      const response = await hlClient.withdraw3({
        destination: userAddress,
        amount: amount.toString()
      })

      console.log('[Withdraw] Response:', response)

      const responseData = response as any

      if (responseData && responseData.status === 'ok') {
        return { success: true }
      } else {
        return {
          success: false,
          error: responseData?.response || 'Withdrawal failed'
        }
      }
    } catch (error: any) {
      console.error('[Withdraw] Error:', error)

      let errorMsg = 'Withdrawal failed'

      if (error.message?.includes('User rejected') || error.code === 4001) {
        errorMsg = 'Transaction rejected by user'
      } else if (error.message?.includes('insufficient')) {
        errorMsg = 'Insufficient balance for withdrawal'
      } else if (error.message) {
        errorMsg = error.message
      }

      return {
        success: false,
        error: errorMsg
      }
    }
  }
}
