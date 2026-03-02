import * as hl from '@nktkas/hyperliquid'
import type { WalletClient } from 'viem'
import { HYPERLIQUID_CONSTANTS } from '@/constants/hyperliquid'

export class BuilderFeeService {
  /**
   * Approve builder fee on Hyperliquid
   * @param walletClient - Viem wallet client
   * @returns Transaction result
   */
  static async approveBuilderFee(walletClient: WalletClient): Promise<{
    success: boolean
    txHash?: string
    error?: string
  }> {
    try {
      console.log('[BuilderFee] Starting approval...')
      console.log('[BuilderFee] Builder address:', HYPERLIQUID_CONSTANTS.BUILDER_ADDRESS)
      console.log('[BuilderFee] Max fee rate:', HYPERLIQUID_CONSTANTS.BUILDER_FEE_MAX)

      // Create HTTP transport for Hyperliquid
      const transport = new hl.HttpTransport({ isTestnet: false })

      // Create ExchangeClient with wallet
      const hlClient = new hl.ExchangeClient({
        transport,
        wallet: walletClient as any // Type compatibility - viem WalletClient works with hl.ExchangeClient
      })

      // Approve builder fee
      const response = await hlClient.approveBuilderFee({
        builder: HYPERLIQUID_CONSTANTS.BUILDER_ADDRESS,
        maxFeeRate: HYPERLIQUID_CONSTANTS.BUILDER_FEE_MAX
      })

      console.log('[BuilderFee] Approval response:', response)

      // Type-safe response handling
      const responseData = response as any
      
      if (responseData && responseData.status === 'ok') {
        return {
          success: true,
          txHash: responseData.response?.data?.statuses?.[0]?.tx?.hash
        }
      } else {
        return {
          success: false,
          error: responseData?.response?.data?.statuses?.[0]?.error || 'Approval failed'
        }
      }
    } catch (error: any) {
      console.error('[BuilderFee] Approval error:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      }
    }
  }
}
