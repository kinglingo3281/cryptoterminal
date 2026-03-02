import * as hl from '@nktkas/hyperliquid'
import type { WalletClient } from 'viem'
import { Wallet } from 'ethers'

export interface AgentCreationResult {
  success: boolean
  apiKey?: string        // User's L1 wallet address
  apiSecret?: string     // Generated agent private key
  agentAddress?: string  // Generated agent wallet address
  error?: string
}

export class AgentService {
  /**
   * Create a new Hyperliquid trading agent
   * This generates a new keypair and approves it as an agent for the user's wallet
   * @param walletClient - Viem wallet client (connected MetaMask/wallet)
   * @returns Agent credentials or error
   */
  static async createAgent(walletClient: WalletClient): Promise<AgentCreationResult> {
    try {
      console.log('[AgentService] Starting agent creation...')

      if (!walletClient.account) {
        return { success: false, error: 'No wallet account found' }
      }

      const userAddress = walletClient.account.address
      console.log('[AgentService] User address:', userAddress)

      // Step 1: Generate a new random wallet for the agent
      const agentWallet = Wallet.createRandom()
      console.log('[AgentService] Generated agent address:', agentWallet.address)

      // Step 2: Create HTTP transport for Hyperliquid
      const transport = new hl.HttpTransport({ isTestnet: false })

      // Step 3: Create ExchangeClient with user's wallet
      const hlClient = new hl.ExchangeClient({
        transport,
        wallet: walletClient as any // Type compatibility - viem WalletClient works with hl.ExchangeClient
      })

      // Step 4: Approve the agent on Hyperliquid (user signs this TX)
      console.log('[AgentService] Approving agent...')
      const response = await hlClient.approveAgent({
        agentAddress: agentWallet.address as `0x${string}`,
        agentName: 'Trading Agent'
      })

      console.log('[AgentService] Approval response:', response)

      // Type-safe response handling
      const responseData = response as any

      if (responseData && responseData.status === 'ok') {
        console.log('[AgentService] Agent created successfully!')
        return {
          success: true,
          apiKey: userAddress,
          apiSecret: agentWallet.privateKey,
          agentAddress: agentWallet.address
        }
      } else {
        const errorMsg = responseData?.response?.data?.statuses?.[0]?.error || 'Agent approval failed'
        console.error('[AgentService] Approval failed:', errorMsg)
        return {
          success: false,
          error: errorMsg
        }
      }
    } catch (error: any) {
      console.error('[AgentService] Error:', error)
      
      // Handle user rejection
      if (error.message?.includes('User rejected') || error.code === 4001) {
        return {
          success: false,
          error: 'Transaction rejected by user'
        }
      }
      
      return {
        success: false,
        error: error.message || 'Unknown error occurred'
      }
    }
  }
}
