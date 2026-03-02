import * as hl from '@nktkas/hyperliquid'
import type { WalletClient } from 'viem'

export class TransferService {
  /**
   * Transfer USDC between Spot and Perp accounts on Hyperliquid
   * Uses the HL exchange API usdClassTransfer (EIP-712 signed action)
   * @param walletClient - Viem wallet client
   * @param amount - Amount in USD (e.g., 100.5 for $100.50)
   * @param toPerp - true = Spot→Perp, false = Perp→Spot
   * @returns Success status
   */
  static async transfer(
    walletClient: WalletClient,
    amount: number,
    toPerp: boolean
  ): Promise<{
    success: boolean
    error?: string
  }> {
    try {
      const direction = toPerp ? 'Spot → Perp' : 'Perp → Spot'
      console.log(`[Transfer] Starting ${direction} transfer for: ${amount} USDC`)

      if (!walletClient.account) {
        return { success: false, error: 'No wallet account found' }
      }

      // Create HTTP transport for Hyperliquid
      const transport = new hl.HttpTransport({ isTestnet: false })

      // Create ExchangeClient with user's wallet (signs the EIP-712 transfer request)
      const hlClient = new hl.ExchangeClient({
        transport,
        wallet: walletClient as any
      })

      // Execute the transfer
      const response = await hlClient.usdClassTransfer({
        amount: amount.toString(),
        toPerp
      })

      console.log('[Transfer] Response:', response)

      const responseData = response as any

      if (responseData && responseData.status === 'ok') {
        return { success: true }
      } else {
        return {
          success: false,
          error: responseData?.response || 'Transfer failed'
        }
      }
    } catch (error: any) {
      console.error('[Transfer] Error:', error)

      let errorMsg = 'Transfer failed'

      if (error.message?.includes('User rejected') || error.code === 4001) {
        errorMsg = 'Transaction rejected by user'
      } else if (error.message?.includes('insufficient') || error.message?.includes('Insufficient')) {
        errorMsg = 'Insufficient balance for transfer'
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
