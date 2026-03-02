/**
 * Bot API - Get Account
 * GET /api/bot/account - Returns user's account summary
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import * as hl from '@nktkas/hyperliquid'
import type { BotApiResponse, AccountResponse } from '@/types/bot-api'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<AccountResponse>>> {
  try {
    // Validate bot token
    const authHeader = request.headers.get('authorization')
    const user = await BotAuthService.validateToken(authHeader)
    
    // Check permission
    if (!BotAuthService.hasPermission(user.permissions, 'read_account')) {
      return NextResponse.json(
        { success: false, error: 'Token does not have read_account permission' },
        { status: 403 }
      )
    }
    
    // Get user's wallet address (public, for read-only operations)
    const userAddress = await BotAuthService.getUserWalletAddress(user.user_id)
    
    // Fetch account state from Hyperliquid
    const transport = new hl.HttpTransport({ isTestnet: false })
    const infoClient = new hl.InfoClient({ transport })
    
    const userState = await infoClient.clearinghouseState({ user: userAddress })
    
    // Parse account data
    const accountValue = parseFloat(userState?.marginSummary?.accountValue || '0')
    const marginUsed = parseFloat(userState?.marginSummary?.totalMarginUsed || '0')
    const totalNtlPos = parseFloat(userState?.marginSummary?.totalNtlPos || '0')
    const withdrawable = parseFloat(userState?.withdrawable || '0')
    
    // Calculate unrealized PnL from positions
    let unrealizedPnl = 0
    if (userState?.assetPositions) {
      for (const assetPos of userState.assetPositions) {
        const pos = assetPos.position
        if (pos && Math.abs(parseFloat(pos.szi)) > 0) {
          unrealizedPnl += parseFloat(pos.unrealizedPnl || '0')
        }
      }
    }
    
    // Calculate cross leverage
    const crossLeverage = accountValue > 0 ? totalNtlPos / accountValue : 0
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    return NextResponse.json({
      success: true,
      data: {
        account: {
          account_value: accountValue,
          available_balance: accountValue - marginUsed,
          margin_used: marginUsed,
          unrealized_pnl: unrealizedPnl,
          cross_leverage: crossLeverage,
          withdrawable: withdrawable
        }
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /account error:', error)
    
    let statusCode = 500
    if (error.message.includes('Authorization') || error.message.includes('token')) {
      statusCode = 401
    }
    
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: statusCode }
    )
  }
}
