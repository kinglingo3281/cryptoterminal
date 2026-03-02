/**
 * Bot API - Get Trade History
 * GET /api/bot/history - Returns user's trade history (fills)
 */

import { NextRequest, NextResponse } from 'next/server'
import { BotAuthService } from '@/services/BotAuthService'
import * as hl from '@nktkas/hyperliquid'
import type { BotApiResponse } from '@/types/bot-api'

export const dynamic = 'force-dynamic'

interface BotFill {
  tid: number
  time: number
  asset: string
  side: 'BUY' | 'SELL'
  price: number
  size: number
  direction: string
  closed_pnl: number
  fee: number
  oid: number
}

interface TradeHistoryResponse {
  fills: BotFill[]
  count: number
}

export async function GET(request: NextRequest): Promise<NextResponse<BotApiResponse<TradeHistoryResponse>>> {
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
    
    // Fetch trade history from Hyperliquid
    const transport = new hl.HttpTransport({ isTestnet: false })
    const infoClient = new hl.InfoClient({ transport })
    
    // Get query params for filtering
    const searchParams = request.nextUrl.searchParams
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100
    const asset = searchParams.get('asset') || undefined
    
    const apiFills = await infoClient.userFills({
      user: userAddress,
      aggregateByTime: true
    })
    
    // Parse fills
    let fills: BotFill[] = []
    
    if (apiFills && Array.isArray(apiFills)) {
      fills = apiFills.map((fill: any) => {
        const side = fill.side === 'B' ? 'BUY' : 'SELL'
        const startPos = parseFloat(fill.startPosition || '0')
        const size = parseFloat(fill.sz || '0')
        
        let direction = 'Unknown'
        if (side === 'BUY') {
          direction = startPos >= 0 ? 'Open Long' : (Math.abs(startPos) >= size ? 'Close Short' : 'Flip to Long')
        } else {
          direction = startPos <= 0 ? 'Open Short' : (startPos >= size ? 'Close Long' : 'Flip to Short')
        }
        
        return {
          tid: fill.tid,
          time: fill.time,
          asset: fill.coin,
          side,
          price: parseFloat(fill.px || '0'),
          size,
          direction,
          closed_pnl: parseFloat(fill.closedPnl || '0'),
          fee: parseFloat(fill.fee || '0'),
          oid: fill.oid
        }
      })
      
      // Filter by asset if specified
      if (asset) {
        fills = fills.filter(f => f.asset === asset)
      }
      
      // Sort newest first and limit
      fills = fills
        .sort((a, b) => b.time - a.time)
        .slice(0, limit)
    }
    
    // Update last used timestamp
    BotAuthService.updateLastUsed(user.token_id)
    
    return NextResponse.json({
      success: true,
      data: {
        fills,
        count: fills.length
      }
    })
    
  } catch (error: any) {
    console.error('[Bot API] GET /history error:', error)
    
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
